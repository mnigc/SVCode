<div align="center">

# SVCode

**轻量、编辑优先的文本 / 代码编辑器 · Windows 优先**

像资源管理器一样浏览全盘文件，像 Everything 一样按名搜索，打开即预览、随手就能改。

[![Release](https://img.shields.io/github/v/release/mnigc/SVCode?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&color=2563eb)](https://github.com/mnigc/SVCode/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/mnigc/SVCode/release.yml?label=%E6%9E%84%E5%BB%BA&branch=main)](https://github.com/mnigc/SVCode/actions/workflows/release.yml)
[![Platform](https://img.shields.io/badge/平台-Windows%2010%2B-0078d4)](#下载安装)
[![Tauri](https://img.shields.io/badge/Tauri-2-24c8d8)](https://tauri.app)

</div>

---

## 为什么做 SVCode

改一个配置文件、看一眼日志、快速编辑一段脚本 —— 打开完整 IDE 太重，记事本又太糙。
SVCode 的定位就是中间这块：**秒级启动，打开即所见，改完即保存。**

- 秒启动，安装包约 10MB，单实例内存约 100MB
- 不选工作区、不扫文件夹：启动即见**整个磁盘**的文件树
- 需要补全、LSP、插件系统时，请用完整 IDE；SVCode 只做「快开、快看、快改」

## 功能一览

### 🗂 全盘文件树 + 多标签编辑
- 无边框标题栏，三栏布局可拖拽分割、可折叠
- 文件树懒加载目录，内置 19 种文件类型 SVG 图标，三平台一套观感
- 多标签、编辑器组拆分（左右上下），标签右键批量关闭

### ⌨️ CodeMirror 6 编辑内核
- 语法高亮：C/C++、Rust、Go、Java、Python、JS/TS、HTML/CSS/Sass、Vue、PHP、SQL、YAML、XML、Markdown 等
- 查找替换、自动换行、字体/缩进设置，全部持久化

### 👁 所见即预览（懒加载，打开才载入）
| 类型 | 方案 |
| --- | --- |
| Markdown | markdown-it + GFM + 任务列表，编辑/预览分栏 |
| 图片 | PNG / JPG / GIF / WebP / SVG / BMP / ICO，缩放适配 |
| PDF | pdf.js 渲染，缩放适配 |
| Office | .docx（docx-preview）、.xlsx（SheetJS，超 500 行截断提示）、.pptx（自写解析提取文字） |
| 二进制/不识别 | 「不支持预览」卡片，一键用系统默认程序打开或在资源管理器中显示 |

### 🔍 Everything 级全盘文件名搜索
三层方案自动降级：
1. **Everything IPC**（运行时检测，毫秒级结果、零索引成本）
2. **自建索引**（`ignore` 并行遍历 + `notify` 增量监视，模糊子序列匹配、中文文件名可搜）
3. MFT 直读为后续可选项

### 🌏 其他
- 深色 / 亮色 / 跟随系统主题；中英双语界面
- 会话恢复：标签、分组、布局重启还原，**未保存草稿一并恢复**，内容不丢
- 右键在终端中打开；保存按原编码（UTF-8 / UTF-16 / GBK）写回，编码表示不了的字符拒绝保存而不是写坏文件

## 下载安装

到 [**Releases**](https://github.com/mnigc/SVCode/releases/latest) 下载最新安装包：

- `SVCode_x.y.z_x64-setup.exe` — NSIS 安装程序（推荐）
- `SVCode_x.y.z_x64_en-US.msi` — MSI 安装包

安装程序启动时会让你选择安装方式：**为所有用户安装**（需管理员确认，可安装到任意磁盘）
或**仅为当前用户安装**（免管理员，装到用户目录）。两种方式都可自选安装目录，
升级时会记住上次的安装位置原位升级。

要求：Windows 10 及以上（自带 WebView2 渲染）。

> 搜索功能如果本机在运行 [Everything](https://www.voidtools.com/) 会自动走它的 IPC，体验最佳；没装也没关系，会自动落到自建索引。

## 从源码构建

```bash
# 前置：Rust stable (MSVC) + Node.js 22 + pnpm 9
pnpm install
pnpm tauri dev     # 开发调试
pnpm tauri build   # 打包（NSIS + MSI）
```

推 `v*` 标签（或在 Actions 页手动触发）会自动构建 Windows 安装包：
打标签时发布到 GitHub Release，手动触发时在 Actions 构件里下载。

## 架构与安全模型

```
SVCode (Tauri 2 窗口, WebView2)
├── 前端  Vite + React 19 + TypeScript + zustand
│   ├── 文件树 / 多标签编辑区（CodeMirror 6）/ 只读预览面板
│   └── 二进制资源走 IPC 字节流 → blob URL，不用 asset protocol
└── 后端  Rust，尽量薄
    ├── fs.rs       list_dir / read_text / write_text / copy / move / ...
    ├── search.rs   Everything IPC 优先，自建索引兜底（watcher.rs 增量维护）
    ├── everything.rs  Everything WM_COPYDATA IPC（Windows）
    └── terminal.rs 在终端中打开
```

文件树直接展示整机文件系统，读写走自定义 `#[tauri::command]`（不受 capability scope
约束），因此**能碰整个磁盘**。作为补偿，后端守住两条硬线：超过约 5MB 的文本按只读
打开、超过约 20MB 拒绝读取并引导外部程序；保存用临时文件 + rename 原子替换。
Markdown 预览 `html: false`，原始 HTML 直接转义为可见文本，从构造上杜绝注入。

## 开发里程碑

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| M0 / M0.5 | 脚手架、三栏布局、无边框标题栏、全盘文件树、外部终端 | ✅ |
| M1 | CodeMirror 6 编辑核心、语言包、查找替换、设置持久化 | ✅ |
| M2 | Markdown 编辑/预览分栏、GFM | ✅ |
| M3 | 图片 + PDF 预览 | ✅ |
| M4 | 主题、会话恢复（含草稿）、快捷键、安装包 | ✅ |
| M5 | 全盘文件名搜索（Everything IPC + 自建索引） | ✅ |
| M6 | Office 预览（docx / xlsx / pptx） | ✅ |
| 后续 | NTFS MFT 直读（管理员提权下的可选加速）、更多打磨 | 🚧 |

## 技术栈

Tauri 2 · React 19 · TypeScript · zustand · CodeMirror 6 · markdown-it · pdf.js · docx-preview · SheetJS · Rust（`everything-ipc` · `ignore` · `notify` · `encoding_rs`）
