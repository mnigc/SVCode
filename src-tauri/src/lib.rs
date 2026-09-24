use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

/// Widen the fs plugin's runtime scope to a folder the user just picked.
///
/// The static capability grants no user paths on purpose: SVCode can only touch
/// folders explicitly opened through the dialog.
#[tauri::command]
fn grant_folder_scope<R: Runtime>(app: AppHandle<R>, path: String) -> tauri::Result<()> {
    app.fs_scope().allow_directory(&path, true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![grant_folder_scope])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
