mod fs;
mod search;
mod terminal;
mod watcher;

#[cfg(windows)]
mod everything;

use tauri::Manager;

/// Whether closing the main window hides it to the tray (background) or
/// really quits. The frontend mirrors the settings value here at startup and
/// on every change; default true until told otherwise.
struct CloseToTray(std::sync::Mutex<bool>);

fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<'_, CloseToTray>, enabled: bool) {
    *state.0.lock().unwrap() = enabled;
}

/// Real quit — `win.close()` from JS is intercepted by the tray handler, so
/// the 文件 menu's 退出 and the tray menu both go through here.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        Manager,
    };

    tauri::Builder::default()
        // Must be the first plugin: a second launch while running in the
        // tray should surface the existing window, not start a twin process.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(CloseToTray(std::sync::Mutex::new(true)))
        .setup(|app| {
            app.manage(watcher::init(&app.handle()));

            let open = MenuItem::with_id(app, "open", "显示 SVCode", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(
                    app.default_window_icon()
                        .expect("app has a window icon")
                        .clone(),
                )
                .tooltip("SVCode")
                .menu(&menu)
                // Left click shows the window; the menu stays on right click.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let hide = *window
                        .state::<CloseToTray>()
                        .0
                        .lock()
                        .unwrap();
                    if hide {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
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
            search::search_set_scope,
            watcher::watch_dir,
            watcher::unwatch_dir,
            set_close_to_tray,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
