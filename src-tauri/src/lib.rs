mod fs;
mod icons;
mod terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            fs::list_drives,
            fs::list_dir,
            fs::read_text,
            fs::write_text,
            icons::file_icon,
            terminal::open_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
