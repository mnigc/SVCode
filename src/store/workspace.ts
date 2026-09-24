import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { open as pickFolder } from '@tauri-apps/plugin-dialog'
import { readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { basename, joinPath, fileKind, type FileKind } from '../lib/paths'

/** Above this size a text file opens read-only; the editor is not built for huge files. */
const READ_ONLY_BYTES = 5 * 1024 * 1024

export interface NodeInfo {
  path: string
  name: string
  isDir: boolean
  /** null until the directory has been listed */
  children: string[] | null
  expanded: boolean
  loading: boolean
}

export interface TabInfo {
  path: string
  name: string
  kind: FileKind
  text: string
  dirty: boolean
  readOnly: boolean
  loading: boolean
  error: string | null
}

interface WorkspaceState {
  root: string | null
  rootName: string
  nodes: Record<string, NodeInfo>
  tabs: TabInfo[]
  activePath: string | null

  sidebarWidth: number
  previewWidth: number
  sidebarOpen: boolean
  previewOpen: boolean

  openFolderDialog: () => Promise<void>
  setRoot: (path: string) => Promise<void>
  toggleDir: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  activate: (path: string) => void
  closeTab: (path: string) => void
  editActive: (text: string) => void
  saveActive: () => Promise<void>

  setSidebarWidth: (px: number) => void
  setPreviewWidth: (px: number) => void
  toggleSidebar: () => void
  togglePreview: () => void
}

function blankNode(path: string, isDir: boolean): NodeInfo {
  return { path, name: basename(path), isDir, children: null, expanded: false, loading: false }
}

const sortEntries = (a: NodeInfo, b: NodeInfo) =>
  a.isDir === b.isDir
    ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : a.isDir
      ? -1
      : 1

async function listDir(dir: string): Promise<NodeInfo[]> {
  const entries = await readDir(dir)
  return entries
    .filter((e) => e.name !== '')
    .map<NodeInfo>((e) => blankNode(joinPath(dir, e.name), e.isDirectory))
    .sort(sortEntries)
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: null,
  rootName: '',
  nodes: {},
  tabs: [],
  activePath: null,

  sidebarWidth: 260,
  previewWidth: 420,
  sidebarOpen: true,
  previewOpen: true,

  openFolderDialog: async () => {
    const picked = await pickFolder({ directory: true, multiple: false, title: '打开文件夹' })
    if (typeof picked === 'string') await get().setRoot(picked)
  },

  setRoot: async (path) => {
    // The fs capability grants no user paths, so widen the runtime scope first.
    await invoke('grant_folder_scope', { path })
    const children = await listDir(path)
    set({
      root: path,
      rootName: basename(path),
      nodes: {
        [path]: { ...blankNode(path, true), children: children.map((c) => c.path), expanded: true },
        ...Object.fromEntries(children.map((c) => [c.path, c])),
      },
    })
  },

  toggleDir: async (path) => {
    const node = get().nodes[path]
    if (!node) return
    if (node.expanded) {
      set((s) => ({ nodes: { ...s.nodes, [path]: { ...node, expanded: false } } }))
      return
    }
    if (node.children === null) {
      set((s) => ({ nodes: { ...s.nodes, [path]: { ...node, loading: true, expanded: true } } }))
      try {
        const children = await listDir(path)
        set((s) => ({
          nodes: {
            ...s.nodes,
            [path]: { ...s.nodes[path], children: children.map((c) => c.path), loading: false },
            ...Object.fromEntries(
              children
                .filter((c) => !s.nodes[c.path])
                .map((c) => [c.path, c] as [string, NodeInfo]),
            ),
          },
        }))
        return
      } catch (err) {
        set((s) => ({ nodes: { ...s.nodes, [path]: { ...s.nodes[path], loading: false, expanded: false } } }))
        throw err
      }
    }
    set((s) => ({ nodes: { ...s.nodes, [path]: { ...node, expanded: true } } }))
  },

  openFile: async (path) => {
    const { tabs } = get()
    const existing = tabs.find((t) => t.path === path)
    if (existing) {
      get().activate(path)
      return
    }

    const kind = fileKind(path)
    const tab: TabInfo = {
      path,
      name: basename(path),
      kind,
      text: '',
      dirty: false,
      readOnly: false,
      loading: kind === 'text' || kind === 'markdown',
      error: null,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activePath: path }))

    if (!tab.loading) return
    try {
      const text = await readTextFile(path)
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === path
            ? { ...t, text, loading: false, readOnly: text.length > READ_ONLY_BYTES }
            : t,
        ),
      }))
    } catch (err) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === path ? { ...t, loading: false, error: String(err) } : t,
        ),
      }))
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
    await writeTextFile(tab.path, tab.text)
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === tab.path ? { ...t, dirty: false } : t)),
    }))
  },

  setSidebarWidth: (px) => set({ sidebarWidth: clamp(px, 160, 520) }),
  setPreviewWidth: (px) => set({ previewWidth: clamp(px, 240, 900) }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  togglePreview: () => set((s) => ({ previewOpen: !s.previewOpen })),
}))

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

export function activeTab(s: WorkspaceState): TabInfo | null {
  return s.tabs.find((t) => t.path === s.activePath) ?? null
}
