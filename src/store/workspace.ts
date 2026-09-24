import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { basename, dirname, fileKind, type FileKind } from '../lib/paths'
import { DIR_ICON, PC_ICON, driveIcon, fileIcon, useIcons } from './icons'

/** Stand-in tree root for 此电脑. No real path can collide with it. */
export const THIS_PC = '<此电脑>'

export interface DriveInfo {
  path: string
  display: string
  kind: string
}

export interface NodeInfo {
  path: string
  name: string
  isDir: boolean
  icon: string
  /** null until the folder has been listed */
  children: string[] | null
  expanded: boolean
  loading: boolean
  error: string | null
}

export interface TabInfo {
  path: string
  name: string
  kind: FileKind
  icon: string
  text: string
  /** Encoding the file was read as; saving re-encodes to it. */
  encoding: string
  /** `crlf` | `lf`; saving restores it because text inputs only speak LF. */
  eol: string
  dirty: boolean
  readOnly: boolean
  loading: boolean
  error: string | null
}

interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

interface TextContent {
  text: string
  encoding: string
  eol: string
  size: number
  readOnly: boolean
}

interface WorkspaceState {
  nodes: Record<string, NodeInfo>
  /** Folder the terminal button and status bar point at. */
  selectedDir: string | null
  notice: string | null
  tabs: TabInfo[]
  activePath: string | null

  sidebarWidth: number
  previewWidth: number
  sidebarOpen: boolean
  previewOpen: boolean

  loadSystemTree: () => Promise<void>
  toggleNode: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  openInTerminal: () => Promise<void>
  activate: (path: string) => void
  closeTab: (path: string) => void
  editActive: (text: string) => void
  saveActive: () => Promise<void>
  dismissNotice: () => void

  setSidebarWidth: (px: number) => void
  setPreviewWidth: (px: number) => void
  toggleSidebar: () => void
  togglePreview: () => void
}

const isRootPath = (path: string) => /^[a-zA-Z]:[\\/]$/.test(path)

function node(path: string, name: string, isDir: boolean): NodeInfo {
  return {
    path,
    name,
    isDir,
    icon: isDir ? (isRootPath(path) ? driveIcon(path) : DIR_ICON) : fileIcon(path),
    children: null,
    expanded: false,
    loading: false,
    error: null,
  }
}

/** Turns Rust's `io::Error` strings into something worth showing a user. */
function describe(err: unknown): string {
  const message = String(err)
  if (message.includes('os error 5')) return '没有访问权限'
  return message
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const patch = (path: string, changes: Partial<NodeInfo>) =>
    set((s) => ({ nodes: { ...s.nodes, [path]: { ...s.nodes[path], ...changes } } }))

  const ensureIcons = (specs: string[]) => useIcons.getState().ensure(specs)

  return {
    nodes: {},
    selectedDir: null,
    notice: null,
    tabs: [],
    activePath: null,

    sidebarWidth: 260,
    previewWidth: 420,
    sidebarOpen: true,
    previewOpen: true,

    loadSystemTree: async () => {
      if (get().nodes[THIS_PC]) return
      const drives = await invoke<DriveInfo[]>('list_drives')
      const children = drives.map((d) => d.path)
      const nodes: Record<string, NodeInfo> = {
        [THIS_PC]: { ...node(THIS_PC, '此电脑', true), icon: PC_ICON, expanded: true, children },
      }
      for (const d of drives) nodes[d.path] = node(d.path, d.display, true)
      set({ nodes })
      ensureIcons([PC_ICON, ...children.map(driveIcon)])
    },

    toggleNode: async (path) => {
      const current = get().nodes[path]
      if (!current) return
      set({ selectedDir: path === THIS_PC ? null : path, notice: null })

      if (current.expanded) {
        patch(path, { expanded: false })
        return
      }
      if (path === THIS_PC || current.children) {
        patch(path, { expanded: true })
        return
      }

      patch(path, { expanded: true, loading: true, error: null })
      try {
        // Rust already sorts folders first, case-insensitively.
        const entries = await invoke<DirEntry[]>('list_dir', { path })
        const known = get().nodes
        const added: Record<string, NodeInfo> = {}
        for (const e of entries) if (!known[e.path]) added[e.path] = node(e.path, e.name, e.isDir)
        set((s) => ({ nodes: { ...s.nodes, ...added } }))
        ensureIcons(Object.values(added).map((n) => n.icon))
        patch(path, { children: entries.map((e) => e.path), loading: false })
      } catch (err) {
        patch(path, { loading: false, expanded: false, error: describe(err) })
      }
    },

    openFile: async (path) => {
      set({ selectedDir: dirname(path), notice: null })
      const opened = get().tabs.find((t) => t.path === path)
      if (opened) {
        set({ activePath: path })
        return
      }

      const kind = fileKind(path)
      const tab: TabInfo = {
        path,
        name: basename(path),
        kind,
        icon: fileIcon(path),
        text: '',
        encoding: 'utf-8',
        eol: 'lf',
        dirty: false,
        readOnly: false,
        loading: kind === 'text' || kind === 'markdown',
        error: null,
      }
      set((s) => ({ tabs: [...s.tabs, tab], activePath: path }))
      ensureIcons([tab.icon])
      if (!tab.loading) return

      try {
        const content = await invoke<TextContent>('read_text', { path })
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.path === path
              ? {
                  ...t,
                  text: content.text,
                  encoding: content.encoding,
                  eol: content.eol,
                  readOnly: content.readOnly,
                  loading: false,
                }
              : t,
          ),
        }))
      } catch (err) {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, loading: false, error: describe(err) } : t)),
        }))
      }
    },

    openInTerminal: async () => {
      const dir = get().selectedDir
      if (!dir) return
      try {
        await invoke('open_terminal', { path: dir })
      } catch (err) {
        set({ notice: describe(err) })
      }
    },

    activate: (path) => set({ activePath: path }),

    closeTab: (path) =>
      set((s) => {
        const tabs = s.tabs.filter((t) => t.path !== path)
        const activePath =
          s.activePath !== path ? s.activePath : (tabs[tabs.length - 1]?.path ?? null)
        return { tabs, activePath }
      }),

    editActive: (text) =>
      set((s) => ({
        tabs: s.tabs.map((t) => (t.path === s.activePath ? { ...t, text, dirty: true } : t)),
      })),

    saveActive: async () => {
      const { tabs, activePath } = get()
      const tab = tabs.find((t) => t.path === activePath)
      if (!tab || !tab.dirty || tab.readOnly) return
      try {
        await invoke('write_text', {
          path: tab.path,
          text: tab.text,
          encoding: tab.encoding,
          eol: tab.eol,
        })
        set((s) => ({
          notice: null,
          tabs: s.tabs.map((t) => (t.path === tab.path ? { ...t, dirty: false } : t)),
        }))
      } catch (err) {
        set({ notice: `保存失败：${describe(err)}` })
      }
    },

    dismissNotice: () => set({ notice: null }),

    setSidebarWidth: (px) => set({ sidebarWidth: clamp(px, 160, 520) }),
    setPreviewWidth: (px) => set({ previewWidth: clamp(px, 240, 900) }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    togglePreview: () => set((s) => ({ previewOpen: !s.previewOpen })),
  }
})

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

export function activeTab(s: WorkspaceState): TabInfo | null {
  return s.tabs.find((t) => t.path === s.activePath) ?? null
}
