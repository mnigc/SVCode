mod fs;
mod search;
mod terminal;
mod watcher;

#[cfg(windows)]
mod everything;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            app.manage(watcher::init(&app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs::list_drives,
            fs::list_dir,
            fs::read_text,
            fs::write_text,
            fs::read_bytes,
            fs::check_access,
            fs::create_file,
            fs::create_dir,
            fs::rename_path,
            fs::delete_path,
            fs::copy_path,
            fs::move_path,
            terminal::open_terminal,
            search::search_files,
            search::search_status,
            watcher::watch_dir,
            watcher::unwatch_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
