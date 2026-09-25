<div align="center">

<img src="public/logo.png" width="96" alt="SVCode logo" />

# SVCode

**Simple Viewer & Code Editor**

**A lightweight, edit-first text & code editor with built-in previews — Windows first.**

[![Release](https://img.shields.io/github/v/release/mnigc/SVCode?label=Release&color=2563eb)](https://github.com/mnigc/SVCode/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/mnigc/SVCode/release.yml?label=Build&branch=main)](https://github.com/mnigc/SVCode/actions/workflows/release.yml)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2B-0078d4)](#download)
[![Tauri](https://img.shields.io/badge/Tauri-2-24c8d8)](https://tauri.app)

**English** | [简体中文](README.zh-CN.md)

</div>

---

## What is SVCode?

**SVCode = Simple Viewer & Code Editor.**

The positioning is **edit-first, preview-second**: at its core SVCode is a lightweight code / text
editor, with preview abilities built in so you can quickly look at Markdown, images, PDF, Office
documents and more — then edit them right away, in the same window.

Fix a config, glance at a log, tweak a script, peek at a doc — a full IDE is overkill and Notepad
is too crude. SVCode lives in that gap: **starts in seconds, shows what you open, saves as you
edit.**

- Starts in seconds; installer **under 3 MB**; ~100 MB RAM per instance
- No "open workspace" step: the file tree shows your **entire disk** from launch
- When you need completion, LSP or plugins, use a full IDE — SVCode only does **open fast, view
  fast, fix fast**

## Features

### 🗂 Whole-disk file tree + multi-tab editing
- Frameless title bar, three-pane layout with draggable splitters and collapsible panes
- Lazily-loaded directory tree with 19 built-in SVG file-type icons
- Multiple tabs, editor-group splitting (left/right/up/down), tab context menu with bulk close

### ⌨️ CodeMirror 6 editing core
- Syntax highlighting for C/C++, Rust, Go, Java, Python, JS/TS, HTML/CSS/Sass, Vue, PHP, SQL,
  YAML, XML, Markdown and more
- Find & replace, word wrap, font/indent settings — all persisted

### 👁 Instant previews (lazy-loaded, only when opened)
| Type | Powered by |
| --- | --- |
| Markdown | markdown-it + GFM + task lists, edit/preview split |
| Images | PNG / JPG / GIF / WebP / SVG / BMP / ICO, zoom to fit |
| PDF | pdf.js rendering, zoom to fit |
| Office | .docx (docx-preview), .xlsx (SheetJS, truncated past 500 rows with a notice), .pptx (custom parser, text extraction) |
| Binary / unknown | "Preview not supported" card — open with the system default app or reveal in Explorer |

### 🔍 Everything-speed whole-disk file-name search
Three tiers with automatic fallback:
1. **Everything IPC** (detected at runtime — millisecond results, zero indexing cost)
2. **Built-in index** (`ignore` parallel walk + `notify` incremental watching, fuzzy subsequence
   matching, Chinese file names supported)
3. Direct NTFS MFT reading as an optional future speed-up

### 🌏 Also
- Dark / light / follow-system theme; English & Simplified Chinese UI
- Session restore: tabs, groups and layout survive restarts — **unsaved drafts too**, nothing lost
- Right-click "Open in Terminal"; files save back in their original encoding (UTF-8 / UTF-16 /
  GBK); characters the encoding can't represent refuse to save instead of corrupting the file

## Download

Grab the latest installer from [**Releases**](https://github.com/mnigc/SVCode/releases/latest) —
the whole editor ships in a download smaller than a photo:

- `SVCode_x.y.z_x64-setup.exe` — NSIS installer, **≈ 2.6 MB** (recommended)
- `SVCode_x.y.z_x64_en-US.msi` — MSI package, **≈ 3.2 MB**

Requires Windows 10 or later (renders with the bundled WebView2).

The installer lets you choose: **install for all users** (UAC confirmation, any drive you like) or
**current user only** (no admin needed). Both modes let you pick the install directory, and
upgrades go back to the same location automatically.

> If [Everything](https://www.voidtools.com/) is running, search uses its IPC automatically for the
> best experience; without it, SVCode quietly falls back to its own index.

## Build from source

```bash
# Prerequisites: Rust stable (MSVC) + Node.js 22 + pnpm 9
pnpm install
pnpm tauri dev     # development
pnpm tauri build   # package (NSIS + MSI)
```

Pushing a `v*` tag (or triggering manually from the Actions page) builds the Windows installers
automatically: tags publish to GitHub Releases, manual runs are downloadable as workflow
artifacts.

## Architecture & security model

```
SVCode (Tauri 2 window, WebView2)
├── Frontend  Vite + React 19 + TypeScript + zustand
│   ├── File tree / multi-tab editor (CodeMirror 6) / read-only preview pane
│   └── Binary resources via IPC byte streams → blob URLs (no asset protocol)
└── Backend  Rust, kept thin
    ├── fs.rs       list_dir / read_text / write_text / copy / move / ...
    ├── search.rs   Everything IPC first, built-in index fallback (watcher.rs keeps it fresh)
    ├── everything.rs  Everything WM_COPYDATA IPC (Windows)
    └── terminal.rs Open in Terminal
```

The file tree shows the whole machine's file system; reads and writes go through custom
`#[tauri::command]`s (not bound by capability scopes), so **the entire disk is reachable**. As
compensation the backend enforces two hard lines: text over ~5 MB opens read-only, over ~20 MB is
refused with a nudge to an external app; saves go through a temp file + atomic rename. Markdown
preview runs with `html: false` — raw HTML is escaped into visible text, so injection is ruled out
by construction.

## Milestones

| Stage | Scope | Status |
| --- | --- | --- |
| M0 / M0.5 | Scaffold, three-pane layout, frameless title bar, whole-disk tree, terminal | ✅ |
| M1 | CodeMirror 6 core, language packs, find & replace, persisted settings | ✅ |
| M2 | Markdown edit/preview split, GFM | ✅ |
| M3 | Image + PDF preview | ✅ |
| M4 | Themes, session restore (incl. drafts), shortcuts, installer | ✅ |
| M5 | Whole-disk file-name search (Everything IPC + built-in index) | ✅ |
| M6 | Office preview (docx / xlsx / pptx) | ✅ |
| Next | Direct NTFS MFT reading (optional, elevated), more polish | 🚧 |

## Tech stack

Tauri 2 · React 19 · TypeScript · zustand · CodeMirror 6 · markdown-it · pdf.js · docx-preview ·
SheetJS · Rust (`everything-ipc` · `ignore` · `notify` · `encoding_rs`)
