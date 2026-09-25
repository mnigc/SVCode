//! M5: whole-machine filename search.
//!
//! Two tiers, tried in order by `search_files`:
//! 1. Everything IPC (`everything.rs`, Windows only) — instant if the user
//!    runs Everything; we ride its MFT index.
//! 2. A self-built in-memory index: one parallel walk of every fixed/removable
//!    drive (`ignore` crate), maintained incrementally by a `notify` watcher.
//!
//! The index stores full paths once (original case for display, lowercase for
//! matching) plus one flag byte per entry. Match tiers: name-exact <
//! name-prefix < name-contains < path-contains < fuzzy-name.

use crate::fs::drive_roots_blocking;
use notify::Watcher;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock, RwLock};
use std::time::Duration;

const FLAG_DIR: u8 = 1;
const FLAG_DEAD: u8 = 0x80;
/// Directories never worth indexing or descending into.
const SKIP_DIRS: [&str; 2] = ["$recycle.bin", "system volume information"];
/// Cap for one watcher batch, so a busy build directory can't stall queries.
const MAX_APPLY_PER_ROUND: usize = 4000;

#[derive(Serialize, Clone)]
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
    pub ready: bool,
    pub files: u64,
    pub source: &'static str,
}

struct IndexVecs {
    paths: Vec<Box<str>>,
    lower: Vec<Box<str>>,
    flags: Vec<u8>,
}

struct Index {
    vecs: RwLock<IndexVecs>,
    ready: AtomicBool,
    files: AtomicU64,
    /// Set once the build thread has been spawned (successfully or not).
    started: AtomicBool,
    /// Watcher event pump, handed to the apply loop after the build.
    watcher_pending: Mutex<Option<mpsc::Receiver<PathBuf>>>,
}

static INDEX: OnceLock<Index> = OnceLock::new();

fn index() -> &'static Index {
    INDEX.get_or_init(|| Index {
        vecs: RwLock::new(IndexVecs {
            paths: Vec::new(),
            lower: Vec::new(),
            flags: Vec::new(),
        }),
        ready: AtomicBool::new(false),
        files: AtomicU64::new(0),
        started: AtomicBool::new(false),
        watcher_pending: Mutex::new(None),
    })
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn search_files(query: String, limit: usize) -> SearchOutcome {
    // Sync commands run on the main thread; a full-index scan there freezes
    // typing. The whole query pipeline therefore stays off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let limit = limit.clamp(1, 1000);
        ensure_started();
        #[cfg(windows)]
        if crate::everything::available() {
            if let Some(out) = crate::everything::query(&query, limit) {
                return out;
            }
        }
        query_local(&query, limit)
    })
    .await
    .unwrap_or_else(|_| SearchOutcome {
        hits: vec![],
        truncated: false,
    })
}

#[tauri::command]
pub async fn search_status() -> SearchStatus {
    // `available()` does an Everything IPC roundtrip — keep it off the UI thread too.
    tauri::async_runtime::spawn_blocking(|| {
        ensure_started();
        #[cfg(windows)]
        if crate::everything::available() {
            return SearchStatus {
                ready: true,
                files: 0,
                source: "everything",
            };
        }
        let idx = index();
        SearchStatus {
            ready: idx.ready.load(Ordering::Relaxed),
            files: idx.files.load(Ordering::Relaxed),
            source: "local",
        }
    })
    .await
    .unwrap_or(SearchStatus {
        ready: false,
        files: 0,
        source: "local",
    })
}

/// Start the local index build on first use (only when Everything is absent).
pub fn ensure_started() {
    #[cfg(windows)]
    if crate::everything::available() {
        return;
    }
    let idx = index();
    if idx.ready.load(Ordering::Relaxed) || idx.started.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::Builder::new()
        .name("search-index".into())
        .spawn(build_and_watch)
        .expect("spawn search-index thread");
}

// ------------------------------------------------------------------- build

fn scan_roots() -> Vec<String> {
    // Runs on the search-index thread — use the blocking drive listing.
    drive_roots_blocking()
        .into_iter()
        .filter(|d| d.kind == "fixed" || d.kind == "removable")
        .map(|d| d.path)
        .collect()
}

fn skip_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|s| name.eq_ignore_ascii_case(s))
}

/// Entry points of the whole subsystem: build the initial index, then keep it
/// fresh by applying watcher events in debounced rounds.
fn build_and_watch() {
    let (tx, rx) = mpsc::channel();
    *index().watcher_pending.lock().unwrap() = Some(rx);

    // Watch roots before walking so nothing that changes mid-build is missed.
    let mut watchers = Vec::new();
    for root in scan_roots() {
        let tx = tx.clone();
        match notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    for path in event.paths {
                        let _ = tx.send(path);
                    }
                }
            },
        ) {
            Ok(mut w) => {
                if let Err(e) = w.watch(Path::new(&root), notify::RecursiveMode::Recursive) {
                    eprintln!("watch {root} failed: {e}");
                }
                watchers.push(w);
            }
            Err(e) => eprintln!("watcher init failed: {e}"),
        }
    }

    let collected = Mutex::new(Vec::<(String, bool)>::new());
    for root in scan_roots() {
        let sink = &collected;
        let mut builder = ignore::WalkBuilder::new(&root);
        builder
            .threads(std::thread::available_parallelism().map_or(4, |n| n.get()))
            .hidden(false)
            .ignore(false)
            .git_ignore(false)
            .git_global(false)
            .git_exclude(false)
            .parents(false)
            .require_git(false)
            .follow_links(false);

        builder.build_parallel().run(|| {
            Box::new(move |entry| {
                let Ok(entry) = entry else {
                    return ignore::WalkState::Continue;
                };
                let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
                let Some(name) = entry.file_name().to_str() else {
                    return ignore::WalkState::Continue;
                };
                if is_dir {
                    if skip_dir(name) {
                        return ignore::WalkState::Skip;
                    }
                }
                let path = entry.path().to_string_lossy().into_owned();
                sink.lock().unwrap().push((path, is_dir));
                ignore::WalkState::Continue
            })
        });
    }

    let batch = collected.into_inner().unwrap();
    {
        let mut vecs = index().vecs.write().unwrap();
        vecs.paths.reserve(batch.len());
        vecs.lower.reserve(batch.len());
        vecs.flags.reserve(batch.len());
        for (path, is_dir) in batch {
            let lower = path.to_lowercase();
            vecs.flags.push(if is_dir { FLAG_DIR } else { 0 });
            vecs.lower.push(lower.into_boxed_str());
            vecs.paths.push(path.into_boxed_str());
        }
    }
    index().files.store(index().vecs.read().unwrap().paths.len() as u64, Ordering::Relaxed);
    index().ready.store(true, Ordering::SeqCst);

    // Takes ownership so the watchers live as long as the (infinite) loop.
    apply_watcher_rounds(watchers);
}

fn apply_watcher_rounds(watchers: Vec<impl Watcher>) {
    // Held for the process lifetime; dropping would unregister the watches.
    let _keepers = watchers;
    let rx = index()
        .watcher_pending
        .lock()
        .unwrap()
        .take()
        .expect("watcher channel taken twice");
    let mut pending: HashSet<PathBuf> = HashSet::new();
    loop {
        // Drain whatever accumulated in the last tick.
        while let Ok(path) = rx.try_recv() {
            if pending.len() < MAX_APPLY_PER_ROUND {
                pending.insert(path);
            }
        }
        if !pending.is_empty() && index().ready.load(Ordering::SeqCst) {
            let batch: Vec<PathBuf> = pending.drain().take(MAX_APPLY_PER_ROUND).collect();
            apply_batch(&batch);
        } else {
            std::thread::sleep(Duration::from_millis(500));
        }
    }
}

fn apply_batch(batch: &[PathBuf]) {
    let mut vecs = index().vecs.write().unwrap();
    // Phase 1: tombstone removals — any entry that IS a changed path or lives
    // underneath a changed directory. A changed dir that still exists is
    // re-added by the phase-2 walk, so this is idempotent for edits.
    let changed: Vec<String> = batch
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let prefixes: Vec<Box<str>> = changed
        .iter()
        .filter(|c| !c.ends_with('\\') && !c.ends_with('/'))
        .flat_map(|c| [format!("{c}\\").into_boxed_str(), format!("{c}/").into_boxed_str()])
        .collect();
    for i in 0..vecs.paths.len() {
        if vecs.flags[i] & FLAG_DEAD != 0 {
            continue;
        }
        let path = &vecs.paths[i];
        if changed.iter().any(|c| path.as_ref() == c.as_str())
            || prefixes.iter().any(|p| path.starts_with(p.as_ref()))
        {
            vecs.flags[i] |= FLAG_DEAD;
        }
    }

    // Phase 2: re-add whatever still exists (files directly, dirs by subtree).
    for p in batch {
        let meta = std::fs::metadata(p);
        match meta {
            Ok(m) => {
                if m.is_dir() {
                    add_subtree(&mut vecs, p);
                } else {
                    add_entry(&mut vecs, p, false);
                }
            }
            Err(_) => {} // removed or renamed away — already tombstoned
        }
    }
    let live = vecs.flags.iter().filter(|f| **f & FLAG_DEAD == 0).count() as u64;
    index().files.store(live, Ordering::Relaxed);
}

fn add_subtree(vecs: &mut IndexVecs, root: &Path) {
    let mut builder = ignore::WalkBuilder::new(root);
    builder.hidden(false).ignore(false).git_ignore(false).git_global(false).git_exclude(false).parents(false).require_git(false);
    for entry in builder.build().flatten() {
        let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
        let Some(name) = entry.file_name().to_str() else {
            continue;
        };
        if is_dir && skip_dir(name) {
            continue;
        }
        add_entry(vecs, entry.path(), is_dir);
    }
}

fn add_entry(vecs: &mut IndexVecs, path: &Path, is_dir: bool) {
    let path = path.to_string_lossy().into_owned();
    let lower = path.to_lowercase();
    vecs.flags.push(if is_dir { FLAG_DIR } else { 0 });
    vecs.lower.push(lower.into_boxed_str());
    vecs.paths.push(path.into_boxed_str());
}

// ------------------------------------------------------------------- query

/// Match tiers: lower is better.
const TIER_NAME_EXACT: u8 = 0;
const TIER_NAME_PREFIX: u8 = 1;
const TIER_NAME_CONTAINS: u8 = 2;
const TIER_PATH_CONTAINS: u8 = 3;
const TIER_FUZZY: u8 = 4;

/// Where does the final path segment start, in the lowercased path?
fn name_start(lower: &str) -> usize {
    match lower.rfind(['\\', '/']) {
        Some(i) => i + 1,
        None => 0,
    }
}

/// Substring match + tier for one entry, or None.
fn match_entry(lower: &str, ql: &str) -> Option<(u8, usize)> {
    let pos = lower.find(ql)?;
    let ns = name_start(lower);
    if pos >= ns {
        if pos == ns && pos + ql.len() == lower.len() {
            Some((TIER_NAME_EXACT, pos))
        } else if pos == ns {
            Some((TIER_NAME_PREFIX, pos))
        } else {
            Some((TIER_NAME_CONTAINS, pos))
        }
    } else {
        Some((TIER_PATH_CONTAINS, pos))
    }
}

/// Subsequence match over the name only (fuzzy tier).
fn fuzzy_name(name_lower: &str, ql: &str) -> bool {
    let mut cursor = 0usize;
    for c in ql.chars() {
        match name_lower[cursor..].find(c) {
            Some(i) => cursor += i + c.len_utf8(),
            None => return false,
        }
    }
    true
}

fn query_local(query: &str, limit: usize) -> SearchOutcome {
    // Space-separated terms are ANDed (Everything semantics — keeps the two
    // backends aligned). A term containing a path separator scopes the search
    // to a folder: the UI fills "D:\proj\ " when a folder is clicked, and the
    // next word the user types narrows within it. Tiering follows the LAST
    // term (the keyword); earlier ones act as scope filters.
    let ql = query.trim().to_lowercase();
    if ql.is_empty() {
        return SearchOutcome { hits: vec![], truncated: false };
    }
    let terms: Vec<&str> = ql.split_whitespace().collect();
    let idx = index();
    if !idx.ready.load(Ordering::Relaxed) {
        return SearchOutcome { hits: vec![], truncated: false };
    }
    let vecs = idx.vecs.read().unwrap();
    let n = vecs.paths.len();
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).min(n.max(1));
    let chunk = n.div_ceil(threads);

    let total_matched = AtomicU64::new(0);
    let candidates: Vec<Vec<(u8, u32)>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let vecs = &vecs;
                let terms = &terms;
                let keyword = terms.last().unwrap();
                let total = &total_matched;
                scope.spawn(move || {
                    let mut hits: Vec<(u8, u32)> = Vec::new();
                    let start = t * chunk;
                    let end = ((t + 1) * chunk).min(n);
                    for i in start..end {
                        if vecs.flags[i] & FLAG_DEAD != 0 {
                            continue;
                        }
                        let lower = &vecs.lower[i];
                        if !terms.iter().all(|t| lower.contains(t)) {
                            continue;
                        }
                        if let Some((tier, _)) = match_entry(lower, keyword) {
                            total.fetch_add(1, Ordering::Relaxed);
                            hits.push((tier, i as u32));
                            if hits.len() > 8192 {
                                hits.sort_unstable_by_key(|(tier, i)| (*tier, vecs.paths[*i as usize].len()));
                                hits.truncate(4096);
                            }
                        }
                    }
                    hits
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
    });

    let mut merged: Vec<(u8, u32)> = candidates.into_iter().flatten().collect();
    let mut truncated = false;
    if total_matched.load(Ordering::Relaxed) > limit as u64 {
        truncated = true;
    }

    // Fuzzy top-up when the plain substring pass came up short. Parallel like
    // the substring pass — a rare query would otherwise pay a full
    // single-threaded scan while the user waits. Scope terms still filter;
    // only the keyword fuzzes.
    let (keyword, scopes) = terms.split_last().unwrap();
    let seen: HashMap<u32, ()> = merged.iter().map(|(_, j)| (*j, ())).collect();
    if merged.len() < limit {
        let fuzzy_cap = limit.saturating_mul(2);
        let fuzzy: Vec<Vec<(u8, u32)>> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..threads)
                .map(|t| {
                    let vecs = &vecs;
                    let scopes = &scopes;
                    let keyword: &str = *keyword;
                    let seen = &seen;
                    scope.spawn(move || {
                        let mut hits: Vec<(u8, u32)> = Vec::new();
                        let start = t * chunk;
                        let end = ((t + 1) * chunk).min(n);
                        for i in start..end {
                            if hits.len() >= fuzzy_cap {
                                break;
                            }
                            let flags = vecs.flags[i];
                            if flags & FLAG_DEAD != 0 || seen.contains_key(&(i as u32)) {
                                continue;
                            }
                            let lower = &vecs.lower[i];
                            if !scopes.iter().all(|t| lower.contains(t)) {
                                continue;
                            }
                            if fuzzy_name(&lower[name_start(lower)..], keyword) {
                                hits.push((TIER_FUZZY, i as u32));
                            }
                        }
                        hits
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
        });
        merged.extend(fuzzy.into_iter().flatten());
        if merged.len() > limit {
            truncated = true;
        }
    }

    merged.sort_unstable_by(|a, b| {
        (a.0.cmp(&b.0))
            .then_with(|| vecs.paths[a.1 as usize].len().cmp(&vecs.paths[b.1 as usize].len()))
            .then_with(|| vecs.paths[a.1 as usize].cmp(&vecs.paths[b.1 as usize]))
    });
    merged.truncate(limit);

    let hits = merged
        .into_iter()
        .map(|(_, i)| {
            let (path, flags) = (&vecs.paths[i as usize], vecs.flags[i as usize]);
            let name = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_owned();
            SearchHit {
                path: path.to_string(),
                name,
                is_dir: flags & FLAG_DIR != 0,
            }
        })
        .collect();

    SearchOutcome { hits, truncated }
}

// ------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn tier_of(path: &str, q: &str) -> Option<u8> {
        match_entry(path, q).map(|(t, _)| t)
    }

    #[test]
    fn name_exact_beats_prefix_beats_contains() {
        assert_eq!(tier_of(r"c:\myapp\readme.md", "readme.md"), Some(TIER_NAME_EXACT));
        assert_eq!(tier_of(r"c:\myapp\readme.md.bak", "readme"), Some(TIER_NAME_PREFIX));
        assert_eq!(tier_of(r"c:\myapp\my.readme.md", "readme"), Some(TIER_NAME_CONTAINS));
        assert_eq!(tier_of(r"c:\readme\app.txt", "readme"), Some(TIER_PATH_CONTAINS));
    }

    #[test]
    fn case_insensitive_and_no_match() {
        // match_entry's contract takes the already-lowercased path (queries
        // run against the lowercased index).
        assert_eq!(tier_of("c:\\myapp\\readme.md", "readme.md"), Some(TIER_NAME_EXACT));
        assert_eq!(tier_of("c:\\myapp\\main.rs", "readme"), None);
    }

    #[test]
    fn chinese_names_match() {
        assert_eq!(tier_of("d:\\项目\\计划书.md", "计划书"), Some(TIER_NAME_PREFIX));
        assert_eq!(tier_of("d:\\项目\\计划书.md", "书.md"), Some(TIER_NAME_CONTAINS));
        assert_eq!(tier_of("d:\\项目\\计划书.md", "不存在"), None);
    }

    #[test]
    fn posix_paths_use_forward_slash() {
        assert_eq!(tier_of("/home/user/readme.md", "readme.md"), Some(TIER_NAME_EXACT));
        assert_eq!(name_start("/home/user/readme.md"), 11);
    }

    #[test]
    fn fuzzy_matches_subsequence_only() {
        assert!(fuzzy_name("reactmain.tsx", "rmts"));
        assert!(fuzzy_name("计划书.md", "计书"));
        assert!(!fuzzy_name("react.tsx", "rmts"));
    }

    #[test]
    fn skip_dirs_ignore_case() {
        assert!(skip_dir("$RECYCLE.BIN"));
        assert!(skip_dir("System Volume Information"));
        assert!(!skip_dir("windows"));
    }

    #[test]
    fn add_subtree_indexes_new_files() {
        let mut vecs = IndexVecs {
            paths: vec![],
            lower: vec![],
            flags: vec![],
        };
        let dir = std::env::temp_dir().join(format!("svcode-search-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("f.txt"), b"x").unwrap();
        std::fs::write(dir.join("sub").join("g.txt"), b"y").unwrap();
        std::fs::write(dir.join("new.txt"), b"z").unwrap();

        add_subtree(&mut vecs, &dir);
        // root dir itself + f.txt + new.txt + sub dir + sub/g.txt
        assert_eq!(vecs.paths.len(), 5);
        assert!(vecs.flags.iter().any(|f| f & FLAG_DIR != 0));
        assert!(vecs.paths.iter().any(|p| p.ends_with("g.txt")));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
