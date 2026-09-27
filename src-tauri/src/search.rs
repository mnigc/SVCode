//! Whole-machine filename search, backed by the WFSearch engine (`wfs.rs`):
//! an MFT/USN-driven index served over a loopback HTTP gateway, either the
//! bundled sidecar or a system-wide WFSearch service if one is already running.
//!
//! Query syntax is the engine's: whitespace-separated AND terms, each a
//! case-insensitive substring or `*`/`?` glob; a term containing `\` or `/`
//! matches against the full path, which is what the tree's "search inside
//! this folder" scope relies on.

use crate::wfs;
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
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
pub async fn search_files(query: String, limit: usize) -> SearchOutcome {
    // Pipe round-trips are blocking I/O — keep them off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let empty = || SearchOutcome {
            hits: vec![],
            truncated: false,
        };
        let query = query.trim();
        if query.is_empty() {
            return empty();
        }
        let limit = limit.clamp(1, 1000) as u32;
        wfs::ensure_server();
        let Ok(resp) = wfs::search(query, limit) else {
            return empty();
        };
        SearchOutcome {
            truncated: resp.total_matched > resp.results.len() as u64,
            hits: resp
                .results
                .into_iter()
                .map(|r| SearchHit {
                    path: r.path,
                    name: r.name,
                    is_dir: r.is_dir,
                })
                .collect(),
        }
    })
    .await
    .unwrap_or_else(|_| SearchOutcome {
        hits: vec![],
        truncated: false,
    })
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
    .unwrap_or_else(|_| SearchStatus {
        ready: false,
        building: false,
        files: 0,
        source: "wfs",
    })
}
