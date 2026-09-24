//! Extracts the real Explorer shell icons so the tree matches what the user is
//! used to seeing. Returns raw 32x32 RGBA over Tauri's binary IPC, which avoids
//! base64 and PNG encoding on the Rust side entirely.
//!
//! Runs on the main thread on purpose: `SHGetFileInfoW` needs the COM apartment
//! that the event loop already initialised.

pub const ICON_PX: u32 = 32;

#[cfg(windows)]
mod imp {
    use super::ICON_PX;
    use std::ffi::c_void;
    use std::sync::OnceLock;

    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_FLAGS_AND_ATTRIBUTES,
    };
    use windows::Win32::UI::Shell::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    static CACHE: OnceLock<std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>> =
        OnceLock::new();

    /// CLSID_MyComputer, the only way to ask the shell for the 此电脑 icon.
    const THIS_PC: &str = "shell:::{20D04FE0-3AEA-1069-A2D7-0C0303942E1B}";

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// A spec is the whole cache key, so identical specs never hit the shell twice.
    fn resolve(key: &str) -> Option<(String, FILE_FLAGS_AND_ATTRIBUTES, SHGFI_FLAGS)> {
        let cached = SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES;
        let live = SHGFI_ICON | SHGFI_LARGEICON;
        match key {
            "<dir>" => Some(("folder".into(), FILE_ATTRIBUTE_DIRECTORY, cached)),
            "<file>" => Some(("file".into(), FILE_ATTRIBUTE_NORMAL, cached)),
            "<pc>" => Some((THIS_PC.into(), FILE_FLAGS_AND_ATTRIBUTES(0), live)),
            _ => match key.split_once(':') {
                Some(("ext", ext)) if !ext.is_empty() => {
                    Some((format!("probe.{ext}"), FILE_ATTRIBUTE_NORMAL, cached))
                }
                Some(("path", p)) if !p.is_empty() => {
                    Some((p.to_owned(), FILE_FLAGS_AND_ATTRIBUTES(0), live))
                }
                _ => None,
            },
        }
    }

    /// Draw `hicon` onto a 32bpp top-down DIB primed with `fill`, returning BGRA bytes.
    unsafe fn render_on(hdc_screen: HDC, hicon: HICON, fill: u8) -> Option<Vec<u8>> {
        let size = ICON_PX as i32;
        let mem = CreateCompatibleDC(Some(hdc_screen));
        if mem.0.is_null() {
            return None;
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size,
                biHeight: -size, // negative == top-down, so row 0 is the image's first row
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut bits: *mut c_void = std::ptr::null_mut();
        let dib = match CreateDIBSection(Some(mem), &bmi, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(dib) => dib,
            Err(_) => {
                let _ = DeleteDC(mem);
                return None;
            }
        };
        let previous = SelectObject(mem, HGDIOBJ(dib.0));
        let len = (ICON_PX * ICON_PX * 4) as usize;
        let buffer = std::slice::from_raw_parts_mut(bits as *mut u8, len);
        buffer.fill(fill);

        let drawn = DrawIconEx(
            mem,
            0,
            0,
            hicon,
            size,
            size,
            0,
            None,
            DI_NORMAL,
        );

        let out = if drawn.is_ok() {
            Some(buffer.to_vec())
        } else {
            None
        };

        SelectObject(mem, previous);
        let _ = DeleteObject(HGDIOBJ(dib.0));
        let _ = DeleteDC(mem);
        out
    }

    /// Un-premultiply the two renders. Giving the icon over black gives `a*F`,
    /// over white gives `a*F + (1-a)*255`, so the per-channel difference recovers
    /// alpha without trusting whatever the DIB's own alpha bytes happen to hold.
    fn compose(black: &[u8], white: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; black.len()];
        for px in 0..(black.len() / 4) {
            let i = px * 4;
            let mut diff_sum = 0i32;
            for c in 0..3 {
                diff_sum += white[i + c] as i32 - black[i + c] as i32;
            }
            let alpha = (255 - diff_sum / 3).clamp(0, 255);
            // B and R are swapped here: DIBs are BGRA, ImageData wants RGBA.
            for (dst, src) in [(2usize, 0usize), (1, 1), (0, 2)] {
                out[i + dst] = if alpha == 0 {
                    0
                } else {
                    ((black[i + src] as i32 * 255) / alpha).clamp(0, 255) as u8
                };
            }
            out[i + 3] = alpha as u8;
        }
        out
    }

    pub fn extract(key: &str) -> Vec<u8> {
        let cache = CACHE.get_or_init(Default::default);
        if let Some(hit) = cache.lock().unwrap().get(key) {
            return hit.clone();
        }
        let rgba = unsafe { extract_uncached(key) }.unwrap_or_else(Vec::new);
        cache.lock().unwrap().insert(key.to_owned(), rgba.clone());
        rgba
    }

    unsafe fn extract_uncached(key: &str) -> Option<Vec<u8>> {
        let (probe, attributes, flags) = resolve(key)?;
        let wide = to_wide(&probe);
        let mut info = SHFILEINFOW::default();
        let fetched = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            attributes,
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        );
        if fetched == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let hicon = info.hIcon;

        let screen = GetDC(None);
        let result = match (render_on(screen, hicon, 0x00), render_on(screen, hicon, 0xFF)) {
            (Some(black), Some(white)) => Some(compose(&black, &white)),
            _ => None,
        };
        ReleaseDC(None, screen);
        let _ = DestroyIcon(hicon);
        result
    }
}

#[cfg(windows)]
pub fn extract(key: &str) -> Vec<u8> {
    imp::extract(key)
}

#[cfg(not(windows))]
pub fn extract(_key: &str) -> Vec<u8> {
    Vec::new()
}

#[tauri::command]
pub fn file_icon(key: String) -> tauri::ipc::Response {
    tauri::ipc::Response::new(extract(&key))
}
