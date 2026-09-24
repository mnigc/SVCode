# SVCode

轻量的文本 / 代码编辑器，编辑为主、预览为辅。用 Tauri 2 + CodeMirror 6 自建，Windows 优先。

定位是"快开快看快改"：秒启动、单实例内存约 100MB、安装包约 10MB。需要 LSP、补全、插件系统时请用完整 IDE。

## 架构

```
SVCode (Tauri 2 窗口, WebView2)
├── 前端  Vite + React + TypeScript + zustand
│   ├── 文件树（懒加载目录）
│   ├── 多标签编辑区（CodeMirror 6，M1 接入）
│   └── 预览面板  markdown-it / <img> / pdf.js —— 只读
└── 后端  Rust，尽量薄
    ├── 自写命令：list_drives / list_dir / read_text / write_text
    ├── 自写命令：file_icon（Win32 shell 图标）/ open_terminal
    └── 二进制资源走 IPC 字节流，不用 asset protocol
```

## 权限模型

左侧树直接展示整机文件系统，不选文件夹、也没有 scope 白名单：读写走上面那几个自定义
`#[tauri::command]`，它们不受 capability scope 约束，所以能枚举驱动器、读任意路径。
`capabilities/default.json` 因此只剩窗口控制、对话框、store、opener 这些内置权限。

代价是"能碰整个磁盘"这件事完全由前端决定，所以后端自己守两条硬线：
超过约 5MB 的文本按只读打开，超过约 20MB 直接报错引导外部程序；保存用临时文件 + rename，
且按打开时探测到的编码（UTF-8 / UTF-16 / GBK）写回，编码表示不了的字符会拒绝保存而不是写坏文件。

## 开发

```bash
rustup toolchain install stable-x86_64-pc-windows-msvc   # 需要 MSVC Build Tools
pnpm install
pnpm tauri dev     # 开发
pnpm tauri build   # 打包（NSIS）
```

`.cargo/config.toml` 和 `.npmrc` 把依赖源指向国内镜像（rsproxy / npmmirror），只对本项目生效。

## 里程碑

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| M0 | 环境 + 脚手架 + 三栏骨架 + 打开文件夹 | 完成 |
| M0.5 | 无边框标题栏、全量文件系统树 + 系统图标、外部终端 | 完成 |
| M1 | CodeMirror 6 编辑核心、语言包、查找替换、设置持久化 | 待办 |
| M2 | Markdown 编辑/预览分栏、GFM、滚动同步 | 待办 |
| M3 | 图片 + PDF 预览（Rust 读字节 → blob URL） | 待办 |
| M4 | 暗色/亮色主题、会话恢复、快捷键、安装包 | 待办 |

## 已定死的技术决策

1. PDF 用 pdf.js，不用 WebView2 原生；只在打开 PDF 时懒加载。
2. 二进制资源统一走"Rust 读字节 → blob URL"，不用 asset protocol。
3. 文本超过约 5MB 按只读打开，编辑器不做大文件优化。
4. 状态用 zustand，设置/会话用 tauri-plugin-store。
5. CodeMirror theme 与预览 CSS 共用一套 CSS 变量色板（见 `src/styles/theme.css`）。
