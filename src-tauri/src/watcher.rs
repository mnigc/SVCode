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
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub struct WatchState {
    watcher: Mutex<RecommendedWatcher>,
    /// Watched path → owner count. Keys are the exact strings callers passed
    /// to `watch_dir`, so every unwatch must reuse the same casing.
    roots: Arc<Mutex<HashMap<PathBuf, usize>>>,
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
    let dirty: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
    let files: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));

    let event_roots = roots.clone();
    let event_dirty = dirty.clone();
    let event_files = files.clone();
    let watcher = notify::recommended_watcher(
        move |res: Result<notify::Event, notify::Error>| {
            let Ok(event) = res else { return };
            let Ok(roots) = event_roots.lock() else { return };
            let mut dirty = event_dirty.lock().unwrap();
            let mut files = event_files.lock().unwrap();
            for path in &event.paths {
                if !files.contains(path) {
                    files.push(path.clone());
                }
                for root in roots.keys() {
                    if path.starts_with(root) && !dirty.contains(root) {
                        dirty.push(root.clone());
                    }
                }
            }
        },
    )
    .expect("failed to create file-system watcher");

    let flush_dirty = dirty.clone();
    let flush_files = files.clone();
    let flush_app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(400));
        let drained: Vec<PathBuf> = std::mem::take(&mut *flush_dirty.lock().unwrap());
        let touched: Vec<PathBuf> = std::mem::take(&mut *flush_files.lock().unwrap());
        if !drained.is_empty() || !touched.is_empty() {
            let to_str = |paths: &[PathBuf]| {
                paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
            };
            let _ = flush_app.emit(
                "fs:change",
                &FsChanges {
                    dirs: to_str(&drained),
                    files: to_str(&touched),
                },
            );
        }
    });

    WatchState {
        watcher: Mutex::new(watcher),
        roots,
    }
}

#[tauri::command]
pub fn watch_dir(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let mut roots = state.roots.lock().unwrap();
    if let Some(count) = roots.get_mut(Path::new(&path)) {
        // Already OS-watched for another owner — just take a reference.
        *count += 1;
        return Ok(());
    }
    roots.insert(PathBuf::from(&path), 1);
    let mut watcher = state.watcher.lock().unwrap();
    if let Err(err) = watcher.watch(Path::new(&path), RecursiveMode::NonRecursive) {
        roots.remove(Path::new(&path));
        return Err(err.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn unwatch_dir(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let mut roots = state.roots.lock().unwrap();
    let drop_watch = match roots.get_mut(Path::new(&path)) {
        Some(count) => {
            *count -= 1;
            *count == 0
        }
        // Never watched from this process (or under a different casing).
        None => false,
    };
    if drop_watch {
        roots.remove(Path::new(&path));
        let mut watcher = state.watcher.lock().unwrap();
        let _ = watcher.unwatch(Path::new(&path));
    }
    Ok(())
}
