//! Watches directories and pushes debounced change events to the frontend,
//! so external mutations (Explorer, other programs) show up without any
//! in-app interaction.
//!
//! Watches are NON-recursive: expanded tree dirs get one each (that is
//! exactly the set of visible listings — nested dirs only need their own
//! watch once the user expands them), and the parent dir of every open text
//! tab is watched too, so an external edit reloads the editor even when the
//! folder is collapsed in the tree. Ownership is refcounted: the tree and
//! open tabs may watch the same dir, and the OS watch lives until every
//! owner releases it. The frontend calls `watch_dir`/`unwatch_dir` from
//! toggleNode, tab open/close and prunes watch roots when directories vanish.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

// Locks here are tolerated on poisoning (`unwrap_or_else(|p| p.into_inner())`):
// the app builds with panic=abort, so a poisoned mutex means a thread already
// panicked — crashing the whole process instead of limping on buys nothing,
// and the guarded state (sets of paths, a watcher handle) stays coherent
// enough to keep watching.

pub struct WatchState {
    watcher: Mutex<RecommendedWatcher>,
    /// Watched path → owner count. Keys are the exact strings callers passed
    /// to `watch_dir`, so every unwatch must reuse the same casing.
    roots: Arc<Mutex<HashMap<PathBuf, usize>>>,
    /// Roots that lost their OS watch (watched dir deleted, notify errored).
    /// The OS watch never recovers on its own, so a delete + external
    /// recreate would leave the tree deaf forever; `watch_dir` re-arms roots
    /// in this set instead of taking the refcount fast path.
    dead: Arc<Mutex<HashSet<PathBuf>>>,
}

/// Payload of the debounced `fs:change` event: `dirs` are watched roots with
/// something new (the tree re-lists them), `files` are the touched paths
/// themselves (matched against open tabs for auto-reload).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FsChanges {
    dirs: Vec<String>,
    files: Vec<String>,
}

/// Collect raw notify events, map each touched path back to its watched root
/// (marking the root dirty) and remember the path itself. A flush thread
/// drains both on a short interval, which debounces bursts (a single save
/// can emit several events).
pub fn init(app: &AppHandle) -> WatchState {
    let roots: Arc<Mutex<HashMap<PathBuf, usize>>> = Arc::new(Mutex::new(HashMap::new()));
    let dirty: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));
    let files: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));
    let dead: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));

    let event_roots = roots.clone();
    let event_dirty = dirty.clone();
    let event_files = files.clone();
    let event_dead = dead.clone();
    let watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| match res {
            Ok(event) => {
                let roots = event_roots.lock().unwrap_or_else(|p| p.into_inner());
                let mut dirty = event_dirty.lock().unwrap_or_else(|p| p.into_inner());
                let mut files = event_files.lock().unwrap_or_else(|p| p.into_inner());
                for path in &event.paths {
                    files.insert(path.clone());
                    for root in roots.keys() {
                        if path.starts_with(root) {
                            dirty.insert(root.clone());
                        }
                    }
                }
            }
            Err(e) => {
                // A watched dir that got deleted kills its OS watch for good;
                // without this the delete + external recreate case above would
                // never see new events again. notify does not always attach the
                // failed path, in which case every root is treated as suspect —
                // re-watching a live root is harmless, staying deaf is not.
                let roots = event_roots.lock().unwrap_or_else(|p| p.into_inner());
                let mut dead = event_dead.lock().unwrap_or_else(|p| p.into_inner());
                if e.paths.is_empty() {
                    eprintln!(
                        "watcher: error without path info, marking all roots for re-watch: {e}"
                    );
                    dead.extend(roots.keys().cloned());
                } else {
                    for p in &e.paths {
                        for root in roots.keys() {
                            if p.starts_with(root) && dead.insert(root.clone()) {
                                eprintln!(
                                    "watcher: root {} lost its watch ({}), marked for re-watch",
                                    root.display(),
                                    e
                                );
                            }
                        }
                    }
                }
            }
        })
        .expect("failed to create file-system watcher");

    let flush_dirty = dirty.clone();
    let flush_files = files.clone();
    let flush_app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(400));
        let drained: HashSet<PathBuf> =
            std::mem::take(&mut *flush_dirty.lock().unwrap_or_else(|p| p.into_inner()));
        let touched: HashSet<PathBuf> =
            std::mem::take(&mut *flush_files.lock().unwrap_or_else(|p| p.into_inner()));
        if !drained.is_empty() || !touched.is_empty() {
            fn to_str(paths: impl Iterator<Item = PathBuf>) -> Vec<String> {
                paths.map(|p| p.to_string_lossy().into_owned()).collect()
            }
            let _ = flush_app.emit(
                "fs:change",
                &FsChanges {
                    dirs: to_str(drained.into_iter()),
                    files: to_str(touched.into_iter()),
                },
            );
        }
    });

    WatchState {
        watcher: Mutex::new(watcher),
        roots,
        dead,
    }
}

#[tauri::command]
pub fn watch_dir(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let key = PathBuf::from(&path);
    let mut roots = state.roots.lock().unwrap_or_else(|p| p.into_inner());
    let mut dead = state.dead.lock().unwrap_or_else(|p| p.into_inner());
    let known = roots.contains_key(&key);
    let was_dead = dead.remove(&key);
    if known && !was_dead {
        // Already OS-watched for another owner — just take a reference.
        *roots.get_mut(&key).expect("checked above") += 1;
        return Ok(());
    }
    // New root, or a root that lost its OS watch (deleted then recreated
    // externally): (re-)arm the OS watch.
    if !known {
        roots.insert(key.clone(), 1);
    }
    let mut watcher = state.watcher.lock().unwrap_or_else(|p| p.into_inner());
    let mut res = watcher.watch(Path::new(&path), RecursiveMode::NonRecursive);
    if res.is_err() {
        // The stale registration from before the delete may still be on
        // notify's books; drop it first. For a live root the watch call
        // itself is idempotent, so this retry only fires on real trouble.
        let _ = watcher.unwatch(Path::new(&path));
        res = watcher.watch(Path::new(&path), RecursiveMode::NonRecursive);
    }
    if let Err(e) = res {
        if !known {
            roots.remove(&key);
        }
        if was_dead {
            dead.insert(key);
        }
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn unwatch_dir(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let key = PathBuf::from(&path);
    let mut roots = state.roots.lock().unwrap_or_else(|p| p.into_inner());
    let drop_watch = match roots.get_mut(&key) {
        Some(count) => {
            *count -= 1;
            *count == 0
        }
        // Never watched from this process (or under a different casing).
        None => false,
    };
    if drop_watch {
        roots.remove(&key);
        // The root is fully released: no need to remember it was deaf.
        state
            .dead
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&key);
        let mut watcher = state.watcher.lock().unwrap_or_else(|p| p.into_inner());
        let _ = watcher.unwatch(Path::new(&path));
    }
    Ok(())
}
