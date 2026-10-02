//! Whole-machine filename search, backed by the WFSearch engine (`wfs.rs`):
//! an MFT/USN-driven index served over a loopback HTTP gateway, either the
//! bundled sidecar or a system-wide WFSearch service if one is already running.
//!
//! Query syntax is the engine's: whitespace-separated AND terms, each a
//! case-insensitive substring or `*`/`?` glob; a term containing `\` or `/`
//! matches against the full path, which is what the tree's "search inside
//! this folder" scope relies on. A `content:term` requests a document-content
//! scan instead (protocol v2): hits come back with a text snippet and a hit
//! count, plus scan bookkeeping (`truncated`/`timed_out`) for the status line.

use crate::wfs;
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    /// content-search context around the first hit; None on name searches
    pub snippet: Option<String>,
    /// content-search hit count in this file; None on name searches
    pub content_matches: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanInfo {
    /// candidates the engine read and matched against
    pub scanned: u32,
    /// the candidate window ran out — results may be incomplete
    pub truncated: bool,
    /// the engine's scan budget ran out — results are partial
    pub timed_out: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
    /// present only for `content:` queries
    pub content: Option<ScanInfo>,
    /// Failure reason when the engine was unreachable / the scan errored.
    /// Absent (`None` skipped by serde) on success, so the frontend can show
    /// "no results" and "search unavailable" apart instead of conflating them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatus {
    /// Engine answering and at least one volume fully indexed.
    pub ready: bool,
    /// Engine answering but still building an index.
    pub building: bool,
    pub files: u64,
    pub source: &'static str,
}

#[tauri::command]
pub async fn search_files(query: String, limit: usize, mode: String) -> SearchOutcome {
    // Pipe round-trips are blocking I/O — keep them off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let empty = |error: Option<String>| SearchOutcome {
            hits: vec![],
            truncated: false,
            content: None,
            error,
        };
        let query = query.trim();
        if query.is_empty() {
            return empty(None);
        }
        let limit = limit.clamp(1, 1000) as u32;
        // "content" mode rewrites word tokens into the engine's `content:`
        // terms; "name" mode sends the query verbatim.
        let engine_q = if mode == "content" {
            content_query(query)
        } else {
            query.to_string()
        };
        wfs::ensure_server();
        // Token missing, timeout, gateway down — all surface as this Err.
        // Never swallow it into an empty result: the UI must be able to tell
        // "engine unavailable" from "nothing found".
        match wfs::search(&engine_q, limit) {
            Err(e) => {
                eprintln!("全文搜索失败（query={engine_q:?}）：{e}");
                empty(Some(format!("全文搜索不可用：{e}")))
            }
            Ok(resp) => SearchOutcome {
                truncated: resp.total_matched > resp.results.len() as u64,
                content: resp.content.map(|c| ScanInfo {
                    scanned: c.scanned,
                    truncated: c.truncated,
                    timed_out: c.timed_out,
                }),
                error: None,
                hits: resp
                    .results
                    .into_iter()
                    .map(|r| SearchHit {
                        path: r.path,
                        name: r.name,
                        is_dir: r.is_dir,
                        snippet: r.snippet,
                        content_matches: r.content_matches,
                    })
                    .collect(),
            },
        }
    })
    .await
    .unwrap_or_else(|e| {
        eprintln!("全文搜索任务崩溃：{e}");
        SearchOutcome {
            hits: vec![],
            truncated: false,
            content: None,
            error: Some(format!("全文搜索不可用：{e}")),
        }
    })
}

/// Rewrites a plain query into the engine's content-search form. Word tokens
/// become `content:` terms (AND semantics). Path-like tokens stay path terms —
/// they are what narrows the candidate window the scan reads — but their
/// trailing segment ALSO joins the content terms: `D:\测` means "documents
/// under paths matching d:\测 containing 测". Pure scopes (`D:\`, `src\`) and
/// wildcard tails contribute no content term.
fn content_query(query: &str) -> String {
    query
        .split_whitespace()
        .flat_map(|tok| {
            let structural = tok.contains(['*', '?', '\\', '/'])
                || (tok.len() == 2 && tok.as_bytes()[1] == b':');
            if !structural {
                return vec![format!("content:{tok}")];
            }
            let mut out = vec![tok.to_string()];
            if let Some((_, tail)) = tok.rsplit_once(['\\', '/']) {
                if !tail.is_empty() && !tail.contains(['*', '?']) {
                    out.push(format!("content:{tail}"));
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub async fn search_status() -> SearchStatus {
    tauri::async_runtime::spawn_blocking(|| match wfs::status() {
        Ok(s) => SearchStatus {
            ready: s.ready,
            building: s.building,
            files: s.files,
            source: "wfs",
        },
        // Not answering — `ensure_server` also tries to (re)start the sidecar
        // within its cooldown window.
        Err(_) => {
            wfs::ensure_server();
            SearchStatus {
                ready: false,
                building: false,
                files: 0,
                source: "wfs",
            }
        }
    })
    .await
    .unwrap_or(SearchStatus {
        ready: false,
        building: false,
        files: 0,
        source: "wfs",
    })
}

#[cfg(test)]
mod tests {
    use super::content_query;

    #[test]
    fn content_query_rewrites_word_tokens_only() {
        assert_eq!(content_query("预算"), "content:预算");
        // wildcard terms stay name terms — they narrow the scan's window
        assert_eq!(content_query("*.md 预算"), "*.md content:预算");
        // a path token keeps scoping AND donates its trailing segment as a
        // content term: "documents under src\core containing core"
        assert_eq!(
            content_query(r"src\core 预算"),
            r"src\core content:core content:预算"
        );
        // pure scopes and drive filters contribute no content term
        assert_eq!(content_query("C: report"), "C: content:report");
        assert_eq!(content_query(r"D:\"), r"D:\");
        // the user's reported case: a path prefix with a keyword glued on
        assert_eq!(content_query(r"D:\测"), r"D:\测 content:测");
        // wildcard tails are filename patterns, not keywords
        assert_eq!(content_query(r"D:\测*.md"), r"D:\测*.md");
        // multiple word tokens → multiple content terms (AND)
        assert_eq!(content_query("Q3 预算"), "content:Q3 content:预算");
    }
}
