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
    /// Explorer-equivalent hidden flag: Windows hidden|system attributes,
    /// dot-prefixed names elsewhere. Filtering happens in the frontend so
    /// the "show hidden files" toggle never needs a re-list.
    pub hidden: bool,
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

/// Explorer hides entries with the hidden or system attribute set.
#[cfg(windows)]
fn is_hidden(entry: &fs::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x8;
    entry
        .metadata()
        .map(|m| (m.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) != 0)
        .unwrap_or(false)
}

/// Outside Windows the dot-prefix convention stands in for hidden entries.
#[cfg(not(windows))]
fn is_hidden(entry: &fs::DirEntry) -> bool {
    entry.file_name().to_string_lossy().starts_with('.')
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
            hidden: is_hidden(&entry),
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
    let (text, encoding, eol) = decode_text(&bytes)?;
    Ok(TextContent {
        text,
        encoding,
        eol,
        size,
        read_only: size > READ_ONLY_BYTES,
    })
}

/// Decode + newline sniffing for `read_text`, split out so tests can run it
/// without touching the filesystem. The text is always normalized to LF:
/// the editor only speaks LF, and `eol` carries the original so saving
/// restores CRLF files byte-for-byte.
fn decode_text(bytes: &[u8]) -> Result<(String, String, String), String> {
    let (text, encoding) = decode(bytes)?;
    // Sniff on the decoded text, not the raw bytes: in UTF-16 a CRLF is
    // `0D 00 0A 00`, so byte-level detection never fires for those files.
    let crlf = text.contains("\r\n");
    let text = if crlf { text.replace("\r\n", "\n") } else { text };
    Ok((text, encoding, if crlf { "crlf" } else { "lf" }.into()))
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
    // sync_all (not just flush) so the bytes reach the disk before the rename —
    // flush only guarantees they left our process, and a crash could then leave
    // a renamed-but-empty file.
    let written = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(err(e));
    }
    match fs::rename(&tmp, &path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(err(e))
        }
    }
}

/// Above this a binary file is refused outright; preview streams are for
/// images/PDFs, not arbitrary big files.
const BINARY_REFUSE_BYTES: u64 = 200 * 1024 * 1024;

/// Raw bytes for the preview viewers (images, PDFs). The frontend wraps them
/// in a blob URL. Returns Tauri's raw IPC response so the payload stays bytes
/// instead of going through JSON.
#[tauri::command]
pub fn read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let size = fs::metadata(&path).map_err(err)?.len();
    if size > BINARY_REFUSE_BYTES {
        return Err("文件超过 200MB，请用外部程序打开。".into());
    }
    let bytes = fs::read(&path).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ------------------------------------------------------- tree mutations

/// Cheap readability probe for the tree's hover hint: true when the directory
/// can be opened and iterated (an empty-but-readable dir also passes).
#[tauri::command]
pub fn check_access(path: String) -> bool {
    match fs::read_dir(&path) {
        Ok(mut rd) => matches!(rd.next(), None | Some(Ok(_))),
        Err(_) => false,
    }
}

/// Windows filename rules, enforced before touching the disk.
fn valid_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("名称不能为空".into());
    }
    if name.len() > 255 {
        return Err("名称过长".into());
    }
    const BAD: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    if let Some(c) = name.chars().find(|c| BAD.contains(c)) {
        return Err(format!("名称不能包含 {c}"));
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err("名称不能以点或空格结尾".into());
    }
    const RESERVED: [&str; 22] = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
        "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    if RESERVED.iter().any(|r| name.eq_ignore_ascii_case(r)) {
        return Err("该名称是系统保留名".into());
    }
    Ok(())
}

fn file_name_of(path: &str) -> Result<String, String> {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "无效路径".to_string())
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    valid_name(&file_name_of(&path)?)?;
    fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            "同名文件已存在".into()
        } else {
            err(e)
        }
    })?;
    Ok(())
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    valid_name(&file_name_of(&path)?)?;
    fs::create_dir(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            "同名文件夹已存在".into()
        } else {
            err(e)
        }
    })
}

#[tauri::command]
pub fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    valid_name(&file_name_of(&new_path)?)?;
    // std::fs::rename uses MoveFileEx with REPLACE_EXISTING on Windows, which
    // would silently clobber the target file — refuse instead.
    if fs::symlink_metadata(&new_path).is_ok() {
        return Err("目标名称已存在".into());
    }
    fs::rename(&old_path, &new_path).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => "目标名称已存在".into(),
        std::io::ErrorKind::PermissionDenied => "没有权限执行该操作".into(),
        _ => err(e),
    })
}

#[tauri::command]
pub fn delete_path(path: String, recursive: bool) -> Result<(), String> {
    let meta = fs::symlink_metadata(&path).map_err(err)?;
    if meta.is_dir() {
        if recursive {
            fs::remove_dir_all(&path).map_err(err)
        } else {
            fs::remove_dir(&path).map_err(|e| match e.kind() {
                std::io::ErrorKind::DirectoryNotEmpty => "文件夹不为空".into(),
                _ => err(e),
            })
        }
    } else {
        fs::remove_file(&path).map_err(err)
    }
}

fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(err)?;
    for entry in fs::read_dir(src).map_err(err)?.flatten() {
        let to = dest.join(entry.file_name());
        let ft = entry.file_type().map_err(err)?;
        if ft.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else if ft.is_file() {
            fs::copy(entry.path(), &to).map_err(err)?;
        }
        // Symlinks/others are skipped: copying a machine's link graph
        // silently is worse than leaving it out.
    }
    Ok(())
}

#[tauri::command]
pub fn copy_path(src: String, dest: String) -> Result<(), String> {
    let meta = fs::symlink_metadata(&src).map_err(err)?;
    if meta.is_dir() {
        copy_dir(Path::new(&src), Path::new(&dest))
    } else if meta.is_file() {
        fs::copy(&src, &dest).map(|_| ()).map_err(err)
    } else {
        Err("不支持复制该类型".into())
    }
}

/// Move = rename when possible (same volume), copy+delete otherwise.
#[tauri::command]
pub fn move_path(src: String, dest: String) -> Result<(), String> {
    if fs::rename(&src, &dest).is_ok() {
        return Ok(());
    }
    let meta = fs::symlink_metadata(&src).map_err(err)?;
    if meta.is_dir() {
        copy_dir(Path::new(&src), Path::new(&dest))?;
        fs::remove_dir_all(&src).map_err(err)
    } else if meta.is_file() {
        fs::copy(&src, &dest).map_err(err)?;
        fs::remove_file(&src).map_err(err)
    } else {
        Err("不支持移动该类型".into())
    }
}

fn decode(bytes: &[u8]) -> Result<(String, String), String> {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return Ok((String::from_utf8_lossy(rest).into_owned(), "utf-8-bom".into()));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return Ok((decode_utf16(rest, false), "utf-16le".into()));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return Ok((decode_utf16(rest, true), "utf-16be".into()));
    }
    // NUL bytes with no BOM mean binary (UTF-16 always carries a BOM here, and
    // neither UTF-8 nor GBK can produce a NUL in valid text). Without this the
    // probe-less open would hand the editor mojibake to save back over the file.
    if bytes.contains(&0) {
        return Err("这是二进制文件，无法以文本打开，请用外部程序。".into());
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok((s.to_owned(), "utf-8".into()));
    }
    // Chinese Windows puts a lot of plain text in GBK; try it before anything lossy.
    if let Some(cow) = encoding_rs::GBK.decode_without_bom_handling_and_without_replacement(bytes)
    {
        return Ok((cow.into_owned(), "gbk".into()));
    }
    Ok((
        String::from_utf8_lossy(bytes).into_owned(),
        "utf-8-lossy".into(),
    ))
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
pub async fn list_drives() -> Vec<Drive> {
    // GetVolumeInformationW and the read_dir probe below can block for many
    // seconds on dead network mappings / empty optical drives — and a sync
    // command would run them on the MAIN thread, freezing the whole UI (the
    // tree would sit at "loading" the entire time). Keep it off-thread.
    tauri::async_runtime::spawn_blocking(drive_roots_blocking)
        .await
        .unwrap_or_default()
}

/// Blocking drive listing for internal callers that already run on a blocking
/// thread (the search index builder) — the async `list_drives` command wraps
/// this via spawn_blocking.
pub fn drive_roots_blocking() -> Vec<Drive> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// encode → decode must round-trip text and remember the encoding label.
    #[test]
    fn round_trip_utf8() {
        let text = "hello 世界 🎉\nline two".to_string();
        let bytes = encode(&text, "utf-8").unwrap();
        let (out, enc) = decode(&bytes).unwrap();
        assert_eq!(out, text);
        assert_eq!(enc, "utf-8");
    }

    #[test]
    fn round_trip_utf8_bom() {
        let text = "带 BOM 的内容".to_string();
        let bytes = encode(&text, "utf-8-bom").unwrap();
        assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
        let (out, enc) = decode(&bytes).unwrap();
        assert_eq!(out, text);
        assert_eq!(enc, "utf-8-bom");
    }

    #[test]
    fn round_trip_utf16le_and_be() {
        // Include an astral char to exercise surrogate pairs.
        let text = "宽字符 𝌆 wide".to_string();
        for enc in ["utf-16le", "utf-16be"] {
            let bytes = encode(&text, enc).unwrap();
            let (out, got) = decode(&bytes).unwrap();
            assert_eq!(out, text, "round trip failed for {enc}");
            assert_eq!(got, enc);
        }
    }

    #[test]
    fn round_trip_gbk() {
        let text = "中文内容：常用汉字与标点。「引号」".to_string();
        let bytes = encode(&text, "gbk").unwrap();
        let (out, got) = decode(&bytes).unwrap();
        assert_eq!(out, text);
        assert_eq!(got, "gbk");
    }

    #[test]
    fn encode_gbk_rejects_unrepresentable() {
        // Emoji has no GBK mapping — must refuse instead of writing '?'.
        assert!(encode("ok 😀", "gbk").is_err());
    }

    #[test]
    fn decode_rejects_binary_nul() {
        let bytes = [0x50, 0x4B, 0x00, 0x03, 0x04];
        let e = decode(&bytes).unwrap_err();
        assert!(e.contains("二进制"));
    }

    #[test]
    fn decode_bom_utf16_with_nul_is_text() {
        // UTF-16LE always contains NUL bytes; the BOM must win over the probe.
        let bytes = encode("a b", "utf-16le").unwrap();
        let (out, _) = decode(&bytes).unwrap();
        assert_eq!(out, "a b");
    }

    #[test]
    fn decode_text_sniffs_eol() {
        let bytes = b"a\r\nb\r\nc";
        assert_eq!(decode_text(bytes).unwrap().2, "crlf");
        assert_eq!(decode_text(b"a\nb").unwrap().2, "lf");
    }

    #[test]
    fn write_then_read_round_trips_crlf_utf16() {
        let dir = std::env::temp_dir().join(format!("svcode-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.txt");

        let text = "第一行\nsecond line\n".to_string();
        write_text(path.to_string_lossy().into(), text.clone(), "utf-16le".into(), "crlf".into()).unwrap();

        let content = read_text(path.to_string_lossy().into()).unwrap();
        assert_eq!(content.text, text);
        assert_eq!(content.encoding, "utf-16le");
        assert_eq!(content.eol, "crlf");

        // The temp file must not survive a successful save.
        let tmp = dir.join(".sample.txt.svcode-tmp");
        assert!(!tmp.exists());

        // A failed save (unrepresentable char) must clean up its temp file too.
        let r = write_text(
            path.to_string_lossy().into(),
            "💥".into(),
            "gbk".into(),
            "lf".into(),
        );
        assert!(r.is_err());
        assert!(!tmp.exists());

        fs::remove_dir_all(&dir).unwrap();
    }

    // ------------------------------------------------ tree mutations

    #[test]
    fn valid_name_rejects_bad_input() {
        assert!(valid_name("hello.txt").is_ok());
        assert!(valid_name("中文文件夹").is_ok());
        assert!(valid_name("").is_err());
        assert!(valid_name("  ").is_err());
        assert!(valid_name("a/b").is_err());
        assert!(valid_name("a\\b").is_err());
        assert!(valid_name("a:b").is_err());
        assert!(valid_name("a?b").is_err());
        assert!(valid_name("name.").is_err());
        assert!(valid_name("name ").is_err());
        assert!(valid_name("con").is_err());
        assert!(valid_name("NUL").is_err());
    }

    #[test]
    fn create_rename_copy_move_delete_lifecycle() {
        let dir = std::env::temp_dir().join(format!("svcode-fs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = |s: &str| dir.join(s).to_string_lossy().into_owned();

        // create file
        create_file(p("a.txt")).unwrap();
        assert!(fs::metadata(p("a.txt")).is_ok());
        // duplicate refused
        assert!(create_file(p("a.txt")).is_err());
        // create dir + nested file
        create_dir(p("sub")).unwrap();
        create_file(p("sub\\inner.txt")).unwrap_or_else(|_| {
            create_file(dir.join("sub").join("inner.txt").to_string_lossy().into()).unwrap()
        });
        // rename file
        rename_path(p("a.txt"), p("b.txt")).unwrap();
        assert!(fs::metadata(p("b.txt")).is_ok());
        // rename onto existing refused
        create_file(p("c.txt")).unwrap();
        assert!(rename_path(p("b.txt"), p("c.txt")).is_err());
        // copy dir recursively
        copy_path(p("sub"), p("sub-copy")).unwrap();
        assert!(fs::metadata(dir.join("sub-copy").join("inner.txt")).is_ok());
        // move dir across "volumes" (same volume here, still exercises fallback path shape)
        move_path(p("sub-copy"), p("sub-moved")).unwrap();
        assert!(fs::metadata(dir.join("sub-moved").join("inner.txt")).is_ok());
        assert!(!fs::exists(p("sub-copy")).unwrap_or(false) || !fs::metadata(p("sub-copy")).is_ok());
        // delete recursive
        delete_path(p("sub-moved"), true).unwrap();
        assert!(fs::metadata(p("sub-moved")).is_err());
        // delete non-recursive on non-empty refused
        assert!(delete_path(p("sub"), false).is_err());
        // access probe
        assert!(check_access(p("sub")));
        assert!(check_access(dir.join("不存在的目录").to_string_lossy().into()) == false);

        fs::remove_dir_all(&dir).unwrap();
    }
}
