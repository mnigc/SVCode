//! Watches the directories that are currently expanded in the file tree and
//! pushes debounced change events to the frontend, so external mutations
//! (Explorer, other programs) show up without any in-app interaction.
//!
//! Watches are NON-recursive, one per expanded directory: that is exactly the
//! set of visible listings — nested dirs only need their own watch once the
//! user expands them. The frontend calls `watch_dir`/`unwatch_dir` from
//! toggleNode and prunes watch roots when directories vanish.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub struct WatchState {
    watcher: Mutex<RecommendedWatcher>,
    roots: Arc<Mutex<HashSet<PathBuf>>>,
}

/// Collect raw notify events, map each touched path back to its watched root
/// and mark the root dirty. A flush thread drains the dirty set on a short
/// interval, which debounces bursts (a single save can emit several events).
pub fn init(app: &AppHandle) -> WatchState {
    let roots: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));
    let dirty: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));

    let event_roots = roots.clone();
    let event_dirty = dirty.clone();
    let watcher = notify::recommended_watcher(
        move |res: Result<notify::Event, notify::Error>| {
            let Ok(event) = res else { return };
            let Ok(roots) = event_roots.lock() else { return };
            let mut dirty = event_dirty.lock().unwrap();
            for path in &event.paths {
                for root in roots.iter() {
                    if path.starts_with(root) && !dirty.contains(root) {
                        dirty.push(root.clone());
                    }
                }
            }
        },
    )
    .expect("failed to create file-system watcher");

    let flush_dirty = dirty.clone();
    let flush_app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(400));
        let drained: Vec<PathBuf> = std::mem::take(&mut *flush_dirty.lock().unwrap());
        if !drained.is_empty() {
            let _ = flush_app.emit("fs:change", &drained);
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
    if roots.insert(PathBuf::from(&path)) {
        let mut watcher = state.watcher.lock().unwrap();
            if let Err(err) = watcher.watch(Path::new(&path), RecursiveMode::NonRecursive) {
                roots.remove(Path::new(&path));
                return Err(err.to_string());
            }
    }
    Ok(())
}

#[tauri::command]
pub fn unwatch_dir(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let mut roots = state.roots.lock().unwrap();
    if roots.remove(Path::new(&path)) {
        let mut watcher = state.watcher.lock().unwrap();
        let _ = watcher.unwatch(Path::new(&path));
    }
    Ok(())
}
