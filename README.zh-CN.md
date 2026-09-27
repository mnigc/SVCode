<div align="center">

<img src="public/logo.png" width="96" alt="SVCode logo" />

# SVCode

**Simple Viewer & Code Editor**

**轻量、编辑优先的文本 / 代码编辑器，内置预览能力 —— Windows 优先。**

[![Release](https://img.shields.io/github/v/release/mnigc/SVCode?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&color=2563eb)](https://github.com/mnigc/SVCode/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/mnigc/SVCode/release.yml?label=%E6%9E%84%E5%BB%BA&branch=main)](https://github.com/mnigc/SVCode/actions/workflows/release.yml)
[![Platform](https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows%2010%2B-0078d4)](#下载安装)
[![Tauri](https://img.shields.io/badge/Tauri-2-24c8d8)](https://tauri.app)

[English](README.md) | **简体中文**

</div>

---

## SVCode 是什么？

**SVCode = Simple Viewer & Code Editor（简单查看器 + 代码编辑器）。**

定位是**编辑为主，预览为辅**：核心是一个轻量代码 / 文本编辑器，同时内置预览能力，
用来快速看 Markdown、图片、PDF、Office 文档等 —— 而且看完就能在同一个窗口里直接改。

改一个配置文件、看一眼日志、快速编辑一段脚本、顺手翻一份文档 —— 打开完整 IDE 太重，
记事本又太糙。SVCode 的定位就是中间这块：**秒级启动，打开即所见，改完即保存。**

- 秒启动，安装包**不到 4MB**，空闲内存约 100MB
- 不选工作区、不扫文件夹：启动即见**整个磁盘**的文件树
- 需要补全、LSP、插件系统时，请用完整 IDE；SVCode 只做「快开、快看、快改」

## 功能一览

### 🗂 全盘文件树 + 多标签编辑
- 无边框标题栏，三栏布局可拖拽分割、可折叠
- 文件树懒加载目录，内置 19 种文件类型 SVG 图标
- 多标签、编辑器组拆分（左右上下），标签右键批量关闭
- 可挂载**网络共享文件夹**（`\\NAS\share`，SMB）为顶层节点——像本地磁盘一样浏览、编辑、
  预览、搜索 NAS 目录，重启后保留（文件 → 添加网络位置）

### ⌨️ CodeMirror 6 编辑内核
- 语法高亮：C/C++、Rust、Go、Java、Python、JS/TS、HTML/CSS/Sass、Vue、PHP、SQL、YAML、XML、Markdown 等
- 查找替换、自动换行、字体/缩进设置，全部持久化

### 👁 所见即预览（懒加载，打开才载入）
| 类型 | 方案 |
| --- | --- |
| Markdown | markdown-it + GFM + 任务列表，编辑/预览分栏 |
| HTML | 沙箱 iframe 预览（禁用脚本） |
| 图片 | PNG / JPG / GIF / WebP / SVG / BMP / ICO，缩放适配 |
| PDF | pdf.js 渲染，缩放适配 |
| Office | .docx（docx-preview）、.xlsx（SheetJS，超 500 行截断并提示）、.pptx（自写解析提取文字） |
| 二进制/不识别 | 「不支持预览」卡片，一键用系统默认程序打开或在资源管理器中显示 |

### 🔍 全盘文件名秒级搜索（内置 WFSearch 引擎）
搜索由自带的 [WFSearch](https://github.com/mnigc/WFSearch) 引擎提供 —— 直读 NTFS 的
MFT + USN 日志建索引，百万级文件全量索引约 2 秒，增量实时跟进：

- 安装包内置 `wfs-server`，SVCode 首次搜索时自动拉起；退出时引擎随之优雅关闭
- 若本机已把 WFSearch 装成 Windows 服务（`wfs-server install`），SVCode 直接复用，无需管理员权限
- SVCode 走引擎的回环 HTTP 网关，并用引擎启动时发布的 token（`%ProgramData%\WFSearch\http.token`）
  鉴权，因此两侧都需 **引擎 0.1.0 或更新**
- 打进安装包的引擎版本锁在 `scripts/fetch-wfs.mjs`；每日巡检上游发布并自动提「升锁版本」的 PR
  （`scripts/check-wfs.mjs`），合并后下一次打包才用新版
- 查询语法：空格分词 AND、`*`/`?` 通配、含 `\` 的词按全路径匹配（点文件夹「在其中搜索」即靠它）

> 注意：直接读 MFT 需要管理员权限。普通权限运行 SVCode 时，建议一次性安装 WFSearch
> 服务（管理员 PowerShell 执行 `wfs-server.exe install`），之后 SVCode 免提权即可搜索全盘。

### 🌏 其他
- 深色 / 亮色 / 跟随系统主题；中英双语界面
- **自动更新**：每天后台向 GitHub Releases 静默检查一次签名产物，可在应用内带进度直接安装
- 会话恢复：标签、分组、布局重启还原，**未保存草稿一并恢复**，内容不丢
- 右键在终端中打开；保存按原编码（UTF-8 / UTF-16 / GBK）写回，编码表示不了的字符拒绝保存而不是写坏文件

## 下载安装

到 [**Releases**](https://github.com/mnigc/SVCode/releases/latest) 下载最新安装包 ——
整个编辑器打包后比一张手机照片还小：

- `SVCode_x.y.z_x64-setup.exe` — NSIS 安装程序，**约 3.6 MB**（推荐）
- `SVCode_x.y.z_x64_en-US.msi` — MSI 安装包，**约 4.7 MB**

要求：Windows 10 及以上（自带 WebView2 渲染）。

安装程序启动时会让你选择安装方式：**为所有用户安装**（需管理员确认，可安装到任意磁盘）
或**仅为当前用户安装**（免管理员）。两种方式都可自选安装目录，升级时自动记住上次的
安装位置原位升级。

> 搜索引擎 WFSearch 已随安装包内置，开箱即用；追求免提权的最佳体验，可先把
> `wfs-server.exe install` 装成 Windows 服务。

## 从源码构建

```bash
# 前置：Rust stable (MSVC) + Node.js 22 + pnpm 9
pnpm install
pnpm fetch:wfs     # 拉取锁定版本的 WFSearch 引擎到 src-tauri/binaries（不入库）
pnpm tauri dev     # 开发调试
pnpm tauri build   # 打包（NSIS + MSI）
```

推 `v*` 标签（或在 Actions 页手动触发）会自动构建 Windows 安装包：打标签时发布到
GitHub Release，手动触发时在 Actions 构件里下载。

## 架构与安全模型

```
SVCode (Tauri 2 窗口, WebView2)
├── 前端  Vite + React 19 + TypeScript + zustand
│   ├── 文件树 / 多标签编辑区（CodeMirror 6）/ 只读预览面板
│   └── 二进制资源走 IPC 字节流 → blob URL，不用 asset protocol
└── 后端  Rust，尽量薄
    ├── fs.rs       list_dir / read_text / write_text / copy / move / ...
    ├── search.rs   搜索命令薄代理 → WFSearch 引擎
    ├── wfs.rs      WFSearch 回环 HTTP 网关客户端 + wfs-server sidecar 生命周期
    └── terminal.rs 在终端中打开
```

文件树直接展示整机文件系统，读写走自定义 `#[tauri::command]`（不受 capability scope
约束），因此**能碰整个磁盘**。作为补偿，后端守住两条硬线：超过约 5MB 的文本按只读
打开、超过约 20MB 拒绝读取并引导外部程序；保存用临时文件 + rename 原子替换。
Markdown 预览对原始 HTML 做白名单消毒（危险标签连同内容整棵删除、URL 属性过滤），
HTML 文件预览则在全沙箱 iframe（禁脚本/表单/弹窗）中渲染，注入均无落地渠道。

## 技术栈

Tauri 2 · React 19 · TypeScript · zustand · CodeMirror 6 · markdown-it · pdf.js · docx-preview · SheetJS · Rust（`notify` · `encoding_rs` · WFSearch sidecar）
