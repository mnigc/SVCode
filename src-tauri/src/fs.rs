use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;

/// Above this a text file opens read-only; the editor is not built for huge files.
const READ_ONLY_BYTES: u64 = 5 * 1024 * 1024;
/// Above this we refuse to load it at all and point at an external program.
const REFUSE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// e.g. `C:\`
    pub path: String,
    /// e.g. `数据 (D:)`
    pub display: String,
    /// fixed | removable | network | cdrom | ram
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextContent {
    pub text: String,
    /// Remembered so saving round-trips the original encoding instead of
    /// silently converting the user's file to UTF-8.
    pub encoding: String,
    /// `crlf` | `lf`. WebView text inputs always hand back LF-joined text, so
    /// without this a save would rewrite every line ending in the file.
    pub eol: String,
    pub size: u64,
    pub read_only: bool,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let read = fs::read_dir(&path).map_err(err)?;
    let mut out = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(Entry {
            path: entry.path().to_string_lossy().into_owned(),
            name,
            is_dir,
        });
    }
    out.sort_by(|a, b| {
        (b.is_dir.cmp(&a.is_dir))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
pub fn read_text(path: String) -> Result<TextContent, String> {
    let size = fs::metadata(&path).map_err(err)?.len();
    if size > REFUSE_BYTES {
        return Err("文件超过 20MB，请用外部程序打开。".into());
    }
    let bytes = fs::read(&path).map_err(err)?;
    let (text, encoding) = decode(&bytes);
    let eol = if bytes.windows(2).any(|w| w == b"\r\n") {
        "crlf".into()
    } else {
        "lf".into()
    };
    Ok(TextContent {
        text,
        encoding,
        eol,
        size,
        read_only: size > READ_ONLY_BYTES,
    })
}

#[tauri::command]
pub fn write_text(path: String, text: String, encoding: String, eol: String) -> Result<(), String> {
    let text = if eol == "crlf" {
        &text.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        &text
    };
    let bytes = encode(text, &encoding)?;
    // Write-then-rename so a crash mid-write cannot leave a truncated file.
    let tmp = {
        let file_name = Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Path::new(&path)
            .parent()
            .map(|p| p.join(format!(".{file_name}.svcode-tmp")))
            .ok_or_else(|| "无效路径".to_string())?
    };
    let mut file = fs::File::create(&tmp).map_err(err)?;
    let written = file
        .write_all(&bytes)
        .and_then(|_| file.flush())
        .map_err(err);
    drop(file);
    written?;
    match fs::rename(&tmp, &path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(err(e))
        }
    }
}

fn decode(bytes: &[u8]) -> (String, String) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(rest).into_owned(), "utf-8-bom".into());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return (decode_utf16(rest, false), "utf-16le".into());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return (decode_utf16(rest, true), "utf-16be".into());
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return (s.to_owned(), "utf-8".into());
    }
    // Chinese Windows puts a lot of plain text in GBK; try it before anything lossy.
    if let Some(cow) =
        encoding_rs::GBK.decode_without_bom_handling_and_without_replacement(bytes)
    {
        return (cow.into_owned(), "gbk".into());
    }
    (
        String::from_utf8_lossy(bytes).into_owned(),
        "utf-8-lossy".into(),
    )
}

fn decode_utf16(bytes: &[u8], big_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks(2)
        .filter_map(|c| {
            if c.len() < 2 {
                return None;
            }
            Some(if big_endian {
                u16::from_be_bytes([c[0], c[1]])
            } else {
                u16::from_le_bytes([c[0], c[1]])
            })
        })
        .collect();
    String::from_utf16_lossy(&units)
}

fn encode(text: &str, encoding: &str) -> Result<Vec<u8>, String> {
    let label = |name: &str| encoding_rs::Encoding::for_label(name.as_bytes());
    match encoding {
        "utf-8-bom" => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            Ok(out)
        }
        "utf-16le" => {
            let mut out = vec![0xFF, 0xFE];
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            Ok(out)
        }
        "utf-16be" => {
            let mut out = vec![0xFE, 0xFF];
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_be_bytes());
            }
            Ok(out)
        }
        "utf-8" | "utf-8-lossy" => Ok(text.as_bytes().to_owned()),
        other => {
            let enc = label(other).ok_or_else(|| format!("未知编码 {other}"))?;
            let (bytes, _, had_errors) = enc.encode(text);
            if had_errors {
                // Refusing is better than replacing characters with '?' behind the user's back.
                return Err(format!(
                    "内容包含 {other} 无法表示的字符，未保存。请改用“另存为 UTF-8”。"
                ));
            }
            Ok(bytes.into_owned())
        }
    }
}

/// `GetDriveTypeW` returns a plain `u32` in the `windows` crate, so mirror the
/// values here instead of pulling in another feature for the constants.
#[cfg(windows)]
mod drive_type {
    pub const REMOVABLE: u32 = 2;
    pub const FIXED: u32 = 3;
    pub const REMOTE: u32 = 4;
    pub const CDROM: u32 = 5;
    pub const RAMDISK: u32 = 6;
}

#[cfg(windows)]
fn drive_type_kind(t: u32) -> &'static str {
    match t {
        drive_type::FIXED => "fixed",
        drive_type::REMOVABLE => "removable",
        drive_type::REMOTE => "network",
        drive_type::CDROM => "cdrom",
        drive_type::RAMDISK => "ram",
        _ => "unknown",
    }
}

#[cfg(windows)]
fn default_kind_name(kind: &str) -> &'static str {
    match kind {
        "fixed" => "本地磁盘",
        "removable" => "可移动磁盘",
        "network" => "网络位置",
        "cdrom" => "DVD RW 驱动器",
        "ram" => "RAM 驱动器",
        _ => "驱动器",
    }
}

#[cfg(windows)]
#[tauri::command]
pub fn list_drives() -> Vec<Drive> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::*;

    let mask = unsafe { GetLogicalDrives() };
    let mut out = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        let root = format!("{letter}:\\");
        let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();

        let kind = drive_type_kind(unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) });
        if kind == "unknown" {
            continue;
        }

        let mut label_buf = [0u16; 64];
        let label = unsafe {
            GetVolumeInformationW(
                PCWSTR(wide.as_ptr()),
                Some(&mut label_buf),
                None,
                None,
                None,
                None,
            )
        }
        .ok()
        .map(|_| {
            let end = label_buf.iter().position(|&c| c == 0).unwrap_or(label_buf.len());
            String::from_utf16_lossy(&label_buf[..end])
        })
        .unwrap_or_default();

        // An empty CD drive or a dead network mapping reports a type but cannot be read.
        if fs::read_dir(&root).is_err() && kind != "cdrom" {
            continue;
        }

        let display = match label.trim() {
            trimmed if !trimmed.is_empty() => format!("{trimmed} ({letter}:)"),
            _ => format!("{} ({letter}:)", default_kind_name(kind)),
        };
        out.push(Drive {
            path: format!("{letter}:\\"),
            display,
            kind: kind.to_owned(),
        });
    }
    out
}

#[cfg(not(windows))]
#[tauri::command]
pub fn list_drives() -> Vec<Drive> {
    vec![Drive {
        path: "/".into(),
        display: "/".into(),
        kind: "fixed".into(),
    }]
}
