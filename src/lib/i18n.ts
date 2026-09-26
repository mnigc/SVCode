import { useCallback } from 'react'
import { useSettings } from './settings'

export type Lang = 'zh' | 'en'

/** UI strings. zh doubles as the source of truth the components used before
 * i18n; en mirrors it. `{name}` slots are interpolated via `t(key, vars)`. */
const dict = {
  // title bar
  'menu.file': { zh: '文件', en: 'File' },
  'menu.view': { zh: '视图', en: 'View' },
  'menu.save': { zh: '保存', en: 'Save' },
  'menu.closeTab': { zh: '关闭标签页', en: 'Close Tab' },
  'menu.openTerminal': { zh: '在终端中打开', en: 'Open in Terminal' },
  'menu.exit': { zh: '退出', en: 'Exit' },
  'theme.dark': { zh: '暗色主题', en: 'Dark Theme' },
  'theme.light': { zh: '亮色主题', en: 'Light Theme' },
  'theme.auto': { zh: '跟随系统', en: 'Follow System' },
  'menu.wordWrap': { zh: '自动换行', en: 'Word Wrap' },
  'menu.showHidden': { zh: '显示隐藏文件', en: 'Show Hidden Files' },
  'menu.help': { zh: '帮助', en: 'Help' },
  'menu.checkUpdate': { zh: '检查更新', en: 'Check for Updates' },
  'menu.about': { zh: '关于 SVCode', en: 'About SVCode' },

  // settings dialog
  'menu.settings': { zh: '设置…', en: 'Settings…' },
  'settings.title': { zh: '设置', en: 'Settings' },
  'settings.appearance': { zh: '外观', en: 'Appearance' },
  'settings.editor': { zh: '编辑器', en: 'Editor' },
  'settings.preview': { zh: '预览', en: 'Preview' },
  'settings.files': { zh: '文件', en: 'Files' },
  'settings.theme': { zh: '主题', en: 'Theme' },
  'settings.lang': { zh: '界面语言', en: 'UI Language' },
  'settings.fontSize': { zh: '编辑器字号', en: 'Editor font size' },
  'settings.tabSize': { zh: '缩进宽度（空格）', en: 'Indent width (spaces)' },
  'settings.wordWrap': { zh: '自动换行', en: 'Word Wrap' },
  'settings.wordWrap.desc': {
    zh: '超出宽度的行折行显示，不改动文件内容',
    en: 'Soft-wrap long lines on screen; file content is unchanged',
  },
  'settings.lineNumbers': { zh: '显示行号', en: 'Show Line Numbers' },
  'settings.defaultView': { zh: '新分组默认视图', en: 'Default View for New Groups' },
  'settings.defaultView.desc': {
    zh: '拆分或新建分组时的初始视图；已打开分组的视图切换不受影响',
    en: 'Initial view when a group is split or created; never resets an existing group’s view',
  },
  'settings.showHidden': { zh: '显示隐藏文件', en: 'Show Hidden Files' },
  'settings.showHidden.desc': {
    zh: '在文件树中显示系统隐藏文件（如 desktop.ini）',
    en: 'Show system-hidden files in the tree (e.g. desktop.ini)',
  },
  'settings.search': { zh: '搜索', en: 'Search' },
  'settings.searchScope': { zh: '文件名索引范围', en: 'File-name Index Scope' },
  'settings.searchScope.desc': {
    zh: '首次搜索时才开始建索引；Everything 在运行时会直接接管搜索，不占用内存',
    en: 'The index is built on the first search, not at startup. Everything takes over when it is running.',
  },
  'settings.scope.off': { zh: '关闭', en: 'Off' },
  'settings.scope.system': { zh: '仅系统盘', en: 'System drive' },
  'settings.scope.all': { zh: '所有磁盘', en: 'All drives' },
  'settings.reset': { zh: '恢复默认设置', en: 'Reset to Defaults' },
  'settings.done': { zh: '完成', en: 'Done' },

  // about / update dialog
  'about.tagline': { zh: '轻量、编辑优先的文本 / 代码编辑器', en: 'A lightweight, edit-first text & code editor' },
  'about.desc': {
    zh: 'SVCode 为主打「快开、快看、快改」而生：像资源管理器一样浏览全盘文件，像 Everything 一样按名搜索，打开即预览、随手就能改。',
    en: 'SVCode is built to open, view and fix files fast: browse the whole disk like Explorer, search file names like Everything, preview on open, edit right away.',
  },
  'about.featPreview': { zh: 'Markdown / 图片 / PDF / Office 文档即时预览', en: 'Instant preview of Markdown, images, PDF & Office documents' },
  'about.featSearch': { zh: '全盘文件名搜索（Everything IPC 或自建索引）', en: 'Whole-disk file-name search (Everything IPC or built-in index)' },
  'about.featEditor': { zh: 'CodeMirror 6 编辑内核，语法高亮、查找替换', en: 'CodeMirror 6 core with syntax highlighting and find & replace' },
  'about.featMisc': { zh: '深浅主题、中英界面、会话恢复、草稿保护', en: 'Dark & light themes, bilingual UI, session restore, draft protection' },
  'about.tech': { zh: 'Tauri 2 · React · CodeMirror 6 · Windows', en: 'Tauri 2 · React · CodeMirror 6 · Windows' },
  'about.github': { zh: 'GitHub 仓库', en: 'GitHub Repository' },
  'about.checkUpdate': { zh: '检查更新', en: 'Check for Updates' },
  'about.checking': { zh: '正在检查更新…', en: 'Checking for updates…' },
  'about.upToDate': { zh: '已是最新版本', en: "You're up to date" },
  'about.newVersion': { zh: '发现新版本', en: 'Update available' },
  'about.currentVersion': { zh: '当前版本 {current}', en: 'Current version {current}' },
  'about.published': { zh: '发布于 {date}', en: 'Published {date}' },
  'about.notes': { zh: '更新说明', en: 'Release notes' },
  'about.download': { zh: '前往下载', en: 'Download' },
  'about.install': { zh: '下载并安装', en: 'Download & Install' },
  'about.installing': { zh: '正在下载安装包…', en: 'Downloading the update…' },
  'about.progress': { zh: '已下载 {n}%', en: '{n}% downloaded' },
  'about.restartNote': {
    zh: '安装程序启动后 SVCode 会退出，装完自动重新打开。',
    en: 'SVCode quits when the installer starts and reopens once it is done.',
  },
  'about.later': { zh: '以后再说', en: 'Later' },
  'about.retry': { zh: '重试', en: 'Retry' },
  'about.failed': { zh: '检查更新失败', en: 'Failed to check for updates' },
  'about.close': { zh: '关闭', en: 'Close' },
  'lang.zh': { zh: '中文', en: '中文' },
  'lang.en': { zh: 'English', en: 'English' },
  'lang.auto': { zh: '跟随系统', en: 'Follow System' },
  'title.toggleSidebar': { zh: '切换侧边栏 (Ctrl+B)', en: 'Toggle Sidebar (Ctrl+B)' },
  'title.minimize': { zh: '最小化', en: 'Minimize' },
  'title.maximize': { zh: '最大化', en: 'Maximize' },
  'title.restore': { zh: '向下还原', en: 'Restore' },
  'title.close': { zh: '关闭', en: 'Close' },

  // tabs
  'tab.close': { zh: '关闭', en: 'Close' },
  'tab.actions': { zh: '标签页操作', en: 'Tab Actions' },
  'tab.split': { zh: '拆分编辑器', en: 'Split Editor' },
  'tab.split.right': { zh: '向右拆分', en: 'Split Right' },
  'tab.split.down': { zh: '向下拆分', en: 'Split Down' },
  'tab.split.left': { zh: '向左拆分', en: 'Split Left' },
  'tab.split.up': { zh: '向上拆分', en: 'Split Up' },
  'tab.closeGroup': { zh: '关闭分组', en: 'Close Group' },
  'tree.openToSide': { zh: '在右侧打开', en: 'Open to the Side' },
  'group.close': { zh: '关闭此分组', en: 'Close This Group' },
  'group.max': { zh: '最多支持 {n} 个编辑器分组', en: 'Up to {n} editor groups' },
  'tab.closeOthers': { zh: '关闭其他标签页', en: 'Close Other Tabs' },
  'tab.closeRight': { zh: '关闭右侧标签页', en: 'Close Tabs to the Right' },
  'tab.closeAll': { zh: '关闭全部标签页', en: 'Close All Tabs' },

  // status bar
  'status.thisPC': { zh: '此电脑', en: 'This PC' },
  'status.dismiss': { zh: '点击忽略', en: 'Click to dismiss' },
  'status.readonly': { zh: '只读', en: 'Read-only' },
  'status.chars': { zh: '{n} 字符', en: '{n} chars' },
  'status.lines': { zh: '{n} 行', en: '{n} lines' },
  'status.tabs': { zh: '{n} 个标签', en: '{n} tabs' },

  // file kinds (status bar)
  'kind.text': { zh: '文本', en: 'Text' },
  'kind.image': { zh: '图片', en: 'Image' },
  'kind.office': { zh: 'Office 文档', en: 'Office document' },
  'kind.binary': { zh: '二进制文件', en: 'Binary' },

  // sidebar
  'sidebar.explorer': { zh: '资源管理器', en: 'Explorer' },
  'sidebar.quickAccess': { zh: '快速访问', en: 'Quick Access' },
  'sidebar.terminal': { zh: '在终端中打开 {path}', en: 'Open {path} in Terminal' },
  'sidebar.terminalHint': { zh: '先在左侧选中一个文件夹', en: 'Pick a folder on the left first' },

  // search
  'search.placeholder': { zh: '搜索文件名 (Ctrl+E)', en: 'Search file names (Ctrl+E)' },
  'search.placeholderScope': { zh: '搜索「{name}」里的文件', en: 'Search inside "{name}"' },
  'search.clear': { zh: '清空', en: 'Clear' },
  'search.viaEverything': { zh: '走 Everything 索引', en: 'Powered by the Everything index' },
  'search.viaLocal': { zh: 'SVCode 自建索引', en: 'SVCode local index' },
  'search.everythingReady': { zh: 'Everything 已接管搜索', en: 'Searching via Everything' },
  'search.indexed': { zh: '{n} 个文件已索引', en: '{n} files indexed' },
  'search.indexing': { zh: '正在建索引：{n} 个文件…', en: 'Building index: {n} files…' },
  'search.scopeOff': { zh: '搜索已关闭（可在设置中开启）', en: 'Search is off (enable it in Settings)' },
  'search.scopeOffHint': {
    zh: '在 设置 → 搜索 → 文件名索引范围 中开启；Everything 在运行时不受此设置影响',
    en: 'Enable it under Settings → Search → Index Scope. Everything, when running, is unaffected.',
  },
  'search.noMatches': { zh: '没有匹配的文件', en: 'No matching files' },
  'search.truncated': {
    zh: '仅显示前 {n} 条，输入更多字符缩小范围',
    en: 'Showing first {n} results; type more to narrow down',
  },

  // welcome screen
  'welcome.tagline': {
    zh: '轻量文本 / 代码编辑器，内置 md、图片、PDF、Office 预览',
    en: 'A lightweight text & code editor with built-in Markdown, image, PDF and Office preview',
  },
  'welcome.start': {
    zh: '从左侧「此电脑」里挑一个文件开始，或在搜索框里找。',
    en: 'Pick a file from “This PC” on the left, or search for one.',
  },
  'welcome.find': { zh: '查找 / 替换', en: 'Find / Replace' },
  'welcome.save': { zh: '保存', en: 'Save' },
  'welcome.sidebar': { zh: '切换侧栏', en: 'Toggle sidebar' },
  'welcome.preview': { zh: '切换预览', en: 'Toggle preview' },
  'welcome.split': { zh: '拆分编辑器', en: 'Split editor' },

  // editor pane
  'pane.loading': { zh: '读取中…', en: 'Loading…' },
  'pane.readonly': { zh: '文件超过 5MB，已按只读打开。', en: 'File exceeds 5 MB and was opened read-only.' },

  // editor search/replace panel (CodeMirror createPanel)
  'editorSearch.find': { zh: '查找', en: 'Find' },
  'editorSearch.replace': { zh: '替换', en: 'Replace' },
  'editorSearch.prev': { zh: '上一个', en: 'Previous' },
  'editorSearch.next': { zh: '下一个', en: 'Next' },
  'editorSearch.all': { zh: '全部', en: 'All' },
  'editorSearch.replaceOne': { zh: '替换', en: 'Replace' },
  'editorSearch.replaceAll': { zh: '全部替换', en: 'Replace All' },
  'editorSearch.case': { zh: '区分大小写', en: 'Match case' },
  'editorSearch.regexp': { zh: '正则表达式', en: 'Regular expression' },
  'editorSearch.word': { zh: '全词匹配', en: 'Whole word' },
  'editorSearch.close': { zh: '关闭 (Esc)', en: 'Close (Esc)' },

  // preview pane
  'preview.title': { zh: '预览', en: 'Preview' },
  'viewmode.label': { zh: '视图模式', en: 'View mode' },
  'viewmode.edit': { zh: '仅编辑', en: 'Editor only' },
  'viewmode.both': { zh: '编辑 + 预览', en: 'Editor + Preview' },
  'viewmode.preview': { zh: '仅预览', en: 'Preview only' },
  'preview.close': { zh: '关闭预览 (Ctrl+Shift+V)', en: 'Close preview (Ctrl+Shift+V)' },
  'preview.empty': { zh: '打开一个文件后这里会显示预览。', en: 'Open a file to see its preview here.' },

  // file tree
  'tree.noAccess': { zh: '没有访问权限', en: 'Access denied' },
  'tree.loading': { zh: '正在加载文件系统…', en: 'Loading file system…' },
  'tree.loadFailed': { zh: '加载失败，点击重试', en: 'Load failed — click to retry' },
  'tree.deleteDetail': { zh: '文件夹内容将一并删除。', en: 'Its contents will be deleted too.' },
  'tree.confirmDelete': { zh: '确定删除「{name}」？{detail}', en: 'Delete “{name}”? {detail}' },
  'tree.newFile': { zh: '新建文件', en: 'New File' },
  'tree.newFolder': { zh: '新建文件夹', en: 'New Folder' },
  'tree.open': { zh: '打开', en: 'Open' },
  'tree.openExternal': { zh: '使用系统默认程序打开', en: 'Open with default app' },
  'tree.copy': { zh: '复制', en: 'Copy' },
  'tree.cut': { zh: '剪切', en: 'Cut' },
  'tree.paste': { zh: '粘贴', en: 'Paste' },
  'tree.clipboardEmpty': { zh: '剪贴板为空', en: 'Clipboard is empty' },
  'tree.rename': { zh: '重命名', en: 'Rename' },
  'tree.delete': { zh: '删除', en: 'Delete' },
  'tree.pin': { zh: '固定到快速访问', en: 'Pin to Quick Access' },
  'tree.unpin': { zh: '从快速访问移除', en: 'Unpin from Quick Access' },
  'qa.missing': { zh: '文件夹不存在或无法访问', en: 'Folder is missing or inaccessible' },
  'qa.empty': { zh: '右键文件夹可固定到快速访问', en: 'Right-click a folder to pin it here' },
  'net.add': { zh: '添加网络位置', en: 'Add Network Location' },
  'net.remove': { zh: '移除网络位置', en: 'Remove Network Location' },
  'net.title': { zh: '添加网络位置', en: 'Add Network Location' },
  'net.placeholder': { zh: '\\\\服务器\\共享文件夹', en: '\\\\server\\share' },
  'net.hint': {
    zh: '输入共享文件夹的 UNC 路径，如 \\\\NAS\\media 或 \\\\NAS\\media\\项目',
    en: 'Enter the UNC path of a shared folder, e.g. \\\\NAS\\media\\projects',
  },
  'net.invalid': {
    zh: '路径格式无效：需要 \\\\服务器\\共享名 形式的 UNC 路径',
    en: 'Invalid path: expected a UNC path like \\\\server\\share',
  },
  'net.unreachable': {
    zh: '无法访问该路径，请检查服务器名、共享名和凭据',
    en: 'Cannot reach this path — check the server, share name and credentials',
  },
  'dialog.cancel': { zh: '取消', en: 'Cancel' },
  'dialog.close': { zh: '关闭', en: 'Close' },

  // workspace notices / dialogs
  'root.thisPC': { zh: '此电脑', en: 'This PC' },
  'root.fs': { zh: '文件系统', en: 'File System' },
  'ask.unsaved': {
    zh: '有 {n} 个标签页未保存，关闭后将丢失这些修改。',
    en: '{n} tab(s) have unsaved changes that will be lost.',
  },
  'ws.saveFailed': { zh: '保存失败：{msg}', en: 'Failed to save: {msg}' },
  'ws.deleteFailed': { zh: '删除失败：{msg}', en: 'Failed to delete: {msg}' },
  'ws.externalChange': {
    zh: '「{name}」已在磁盘上被其他程序修改，当前有未保存更改，未自动刷新',
    en: '"{name}" was changed on disk by another program — kept your unsaved changes',
  },
  'ws.reloadFailed': {
    zh: '无法重新读取「{name}」，文件可能已被删除或移动',
    en: 'Could not re-read "{name}" — it may have been deleted or moved',
  },
  'paste.copy': { zh: '副本', en: 'copy' },

  // drive type names (Rust fallback labels)
  'drive.fixed': { zh: '本地磁盘', en: 'Local Disk' },
  'drive.removable': { zh: '可移动磁盘', en: 'Removable Disk' },
  'drive.network': { zh: '网络位置', en: 'Network Location' },
  'drive.cdrom': { zh: 'DVD RW 驱动器', en: 'DVD RW Drive' },
  'drive.ram': { zh: 'RAM 驱动器', en: 'RAM Disk' },
  'drive.generic': { zh: '驱动器', en: 'Drive' },

  // unsupported card
  'card.images': { zh: '图片', en: 'Images' },
  'card.text': { zh: '文本 / 代码', en: 'Text / Code' },
  'card.textExts': { zh: '{n} 种扩展名，直接编辑', en: '{n} extensions, edited directly' },
  'card.descError': { zh: '此文件无法以文本方式读取。', en: 'This file cannot be read as text.' },
  'card.descBinary': {
    zh: '此格式暂不支持预览，可以交给系统默认程序打开。',
    en: 'No preview for this format yet; it can be opened with its default app.',
  },
  'card.descText': {
    zh: '文本与代码文件在编辑区直接编辑，没有预览形态。',
    en: 'Text and code files are edited directly in the editor pane; they have no preview.',
  },
  'card.descShown': { zh: '此格式在编辑区显示。', en: 'This format is shown in the editor pane.' },
  'card.openFailed': { zh: '打开失败：{msg}', en: 'Failed to open: {msg}' },
  'card.readFailed': { zh: '读取失败：{msg}', en: 'Failed to read: {msg}' },
  'card.openWith': { zh: '用系统默认程序打开', en: 'Open with default app' },
  'card.reveal': { zh: '在资源管理器中显示', en: 'Show in File Explorer' },

  // shared viewer chrome
  'viewer.zoomOut': { zh: '缩小', en: 'Zoom out' },
  'viewer.zoomIn': { zh: '放大', en: 'Zoom in' },
  'viewer.fit': { zh: '适应窗口', en: 'Fit window' },
  'viewer.parseFailed': { zh: '解析失败：{msg}', en: 'Failed to parse: {msg}' },

  // image viewer
  'img.loading': { zh: '加载中…', en: 'Loading…' },
  'img.tiff': {
    zh: 'WebView2 暂不支持直接预览 TIFF，请用外部图片查看器。',
    en: 'WebView2 cannot preview TIFF directly yet; use an external image viewer.',
  },

  // pdf viewer
  'pdf.loadFailed': { zh: 'PDF 加载失败：{msg}', en: 'Failed to load PDF: {msg}' },
  'pdf.rendering': { zh: '渲染中 {done}/{total} 页', en: 'Rendering {done}/{total}' },

  // office viewers
  'office.parsingDoc': { zh: '解析文档中…', en: 'Parsing document…' },
  'office.parsingSheet': { zh: '解析表格中…', en: 'Parsing worksheet…' },
  'office.parsingSlides': { zh: '解析幻灯片中…', en: 'Parsing slides…' },
  'office.truncated': {
    zh: '表格过大，仅显示前 {rows} 行 × {cols} 列。',
    en: 'Sheet too large; showing first {rows} rows × {cols} columns.',
  },
  'office.slideNo': { zh: '第 {n} 页', en: 'Slide {n}' },
  'office.slideEmpty': { zh: '（本页无文本内容）', en: '(no text on this slide)' },
  'office.unsupported': { zh: '不支持预览的 Office 格式。', en: 'This Office format has no preview.' },
  'office.noteDocx': {
    zh: '预览仅供参考：复杂排版与嵌入图片可能显示不全。',
    en: 'Preview only: complex layout and embedded images may be incomplete.',
  },
  'office.noteXlsx': {
    zh: '预览仅供参考：部分样式与格式可能显示不全。',
    en: 'Preview only: some styles and formatting may be incomplete.',
  },
  'office.notePptx': {
    zh: '预览仅供参考：仅提取文字内容，图片、配色与排版不会显示。',
    en: 'Preview only: text extraction — images, colors and layout are not shown.',
  },

  // Rust backend error strings (exact matches; see tBackend)
  'err.terminal.launch': { zh: '无法启动终端：{msg}', en: 'Failed to launch terminal: {msg}' },
  'err.terminal.unsupported': {
    zh: '当前平台暂不支持打开终端。',
    en: 'Opening a terminal is not supported on this platform.',
  },
  'err.fileTooLarge20': {
    zh: '文件超过 20MB，请用外部程序打开。',
    en: 'File exceeds 20 MB; open it in an external program.',
  },
  'err.fileTooLarge200': {
    zh: '文件超过 200MB，请用外部程序打开。',
    en: 'File exceeds 200 MB; open it in an external program.',
  },
  'err.invalidPath': { zh: '无效路径', en: 'Invalid path' },
  'err.nameEmpty': { zh: '名称不能为空', en: 'Name cannot be empty' },
  'err.nameTooLong': { zh: '名称过长', en: 'Name is too long' },
  'err.nameContains': { zh: '名称不能包含 {msg}', en: 'Names cannot contain {msg}' },
  'err.nameEndDotSpace': {
    zh: '名称不能以点或空格结尾',
    en: 'Names cannot end with a dot or space',
  },
  'err.reservedName': { zh: '该名称是系统保留名', en: 'That name is reserved by the system' },
  'err.fileExists': { zh: '同名文件已存在', en: 'A file with that name already exists' },
  'err.dirExists': { zh: '同名文件夹已存在', en: 'A folder with that name already exists' },
  'err.destExists': { zh: '目标名称已存在', en: 'Target name already exists' },
  'err.noPermission': { zh: '没有权限执行该操作', en: 'Permission denied for this operation' },
  'err.dirNotEmpty': { zh: '文件夹不为空', en: 'Folder is not empty' },
  'err.cantCopy': { zh: '不支持复制该类型', en: 'This type cannot be copied' },
  'err.cantMove': { zh: '不支持移动该类型', en: 'This type cannot be moved' },
  'err.binaryFile': {
    zh: '这是二进制文件，无法以文本打开，请用外部程序。',
    en: 'This is a binary file and cannot be opened as text; use an external program.',
  },
  'err.unknownEncoding': { zh: '未知编码 {msg}', en: 'Unknown encoding {msg}' },
  'err.unrepresentable': {
    zh: '内容包含 {msg} 无法表示的字符，未保存。请改用“另存为 UTF-8”。',
    en: 'Content contains characters {msg} cannot represent; not saved. Use “Save as UTF-8” instead.',
  },
} satisfies Record<string, { zh: string; en: string }>

export type TextKey = keyof typeof dict

export const systemLang = (): Lang =>
  navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'

/** Effective language right now — for non-React code (store actions, dialogs). */
export const currentLang = (): Lang => {
  const pref = useSettings.getState().lang
  return pref === 'auto' ? systemLang() : pref
}

const format = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s

/** Reactive translation for React components: `const t = useT()`. The
 * component re-renders when the language setting changes. */
export function useT() {
  const pref = useSettings((s) => s.lang)
  const lang = pref === 'auto' ? systemLang() : pref
  return useCallback((key: TextKey, vars?: Record<string, string | number>) => format(dict[key][lang], vars), [lang])
}

/** One-shot translation for store code and plain functions. */
export const t = (key: TextKey, vars?: Record<string, string | number>): string =>
  format(dict[key][currentLang()], vars)

const DRIVE_LABELS: Record<string, TextKey> = {
  本地磁盘: 'drive.fixed',
  可移动磁盘: 'drive.removable',
  网络位置: 'drive.network',
  'DVD RW 驱动器': 'drive.cdrom',
  'RAM 驱动器': 'drive.ram',
  驱动器: 'drive.generic',
  'Local Disk': 'drive.fixed',
  'Removable Disk': 'drive.removable',
  'Network Location': 'drive.network',
  'DVD RW Drive': 'drive.cdrom',
  'RAM Disk': 'drive.ram',
  Drive: 'drive.generic',
}

/** Rust error strings arrive in Chinese (fs.rs/terminal.rs return literals).
 * The backend keeps its own language; this bridge translates the known set at
 * display time in BOTH directions — backend zh ↔ UI en, and en text stored
 * before a language switch back to zh — passing everything else through. */
export function tBackend(msg: string): string {
  const lang = currentLang()
  if (lang === 'zh') {
    const exact = BACKEND_ZH_REVERSE[msg]
    if (exact) return exact
    for (const [prefix, key, suffix] of BACKEND_EN_TEMPLATES) {
      if (msg.startsWith(prefix)) {
        let rest = msg.slice(prefix.length)
        if (suffix && rest.endsWith(suffix)) rest = rest.slice(0, -suffix.length)
        return format(dict[key].zh, { msg: rest })
      }
    }
    return msg
  }
  const exact = BACKEND_EXACT[msg]
  if (exact) return dict[exact].en
  for (const [prefix, key, suffix] of BACKEND_TEMPLATES) {
    if (msg.startsWith(prefix)) {
      let rest = msg.slice(prefix.length)
      if (suffix && rest.endsWith(suffix)) rest = rest.slice(0, -suffix.length)
      rest = rest.replace(/^：/, '')
      return format(dict[key].en, { msg: rest })
    }
  }
  return msg
}

const BACKEND_EXACT: Partial<Record<string, TextKey>> = {
  '当前平台暂不支持打开终端。': 'err.terminal.unsupported',
  '文件超过 20MB，请用外部程序打开。': 'err.fileTooLarge20',
  '文件超过 200MB，请用外部程序打开。': 'err.fileTooLarge200',
  无效路径: 'err.invalidPath',
  名称不能为空: 'err.nameEmpty',
  名称过长: 'err.nameTooLong',
  '名称不能以点或空格结尾': 'err.nameEndDotSpace',
  该名称是系统保留名: 'err.reservedName',
  同名文件已存在: 'err.fileExists',
  同名文件夹已存在: 'err.dirExists',
  目标名称已存在: 'err.destExists',
  没有权限执行该操作: 'err.noPermission',
  文件夹不为空: 'err.dirNotEmpty',
  不支持复制该类型: 'err.cantCopy',
  不支持移动该类型: 'err.cantMove',
  '这是二进制文件，无法以文本打开，请用外部程序。': 'err.binaryFile',
  没有访问权限: 'tree.noAccess',
}

const BACKEND_TEMPLATES: [string, TextKey, string?][] = [
  ['无法启动终端：', 'err.terminal.launch'],
  ['名称不能包含 ', 'err.nameContains'],
  ['未知编码 ', 'err.unknownEncoding'],
  ['内容包含 ', 'err.unrepresentable', ' 无法表示的字符，未保存。请改用“另存为 UTF-8”。'],
]

/** zh→en lookups derived from the exact map: stored English text back to the
 * canonical Chinese, for tabs/notices created before a switch back to zh. */
const BACKEND_ZH_REVERSE: Record<string, string> = Object.fromEntries(
  (Object.entries(BACKEND_EXACT) as [string, TextKey][]).map(([zh, key]) => [dict[key].en, zh]),
)

/** en→zh template rules, split at the {msg} slot of each en template. */
const BACKEND_EN_TEMPLATES: [string, TextKey, string?][] = BACKEND_TEMPLATES.map(
  ([, key]) => {
    const tpl = dict[key].en
    const i = tpl.indexOf('{msg}')
    return [tpl.slice(0, i), key, tpl.slice(i + 5)]
  },
)

/** Translate a Rust-provided drive display name (the fallback labels from
 * `default_kind_name`); volume-label names pass through. Both languages map
 * back so a mid-session language switch can re-translate stored labels. */
export function tDriveName(display: string): string {
  const key = DRIVE_LABELS[display]
  return key ? t(key) : display
}
