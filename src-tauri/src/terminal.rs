use std::process::Command;

/// Opens a terminal at `path`: Windows Terminal when it is installed, otherwise a
/// plain console. Args are passed without a shell, so a folder name cannot inject
/// a command.
#[cfg(windows)]
#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

    if Command::new("wt.exe").arg("-d").arg(&path).spawn().is_ok() {
        return Ok(());
    }
    Command::new("cmd.exe")
        .arg("/K")
        .current_dir(&path)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| format!("无法启动终端：{e}"))?;
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn open_terminal(_path: String) -> Result<(), String> {
    Err("当前平台暂不支持打开终端。".into())
}
