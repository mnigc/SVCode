import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'
import { basename, dirname, extname, fileKind, joinPath, isRootPath, type FileKind } from '../lib/paths'
import { t, tBackend, tDriveName } from '../lib/i18n'
import { DIR_ICON, PC_ICON, driveIcon, fileIcon } from '../lib/fileIcons'

/** Stand-in tree root for 此电脑. No real path can collide with it. */
export const THIS_PC = '<此电脑>'

/*
 * Tree shape is platform-specific: Windows keeps the 此电脑 → drives layer,
 * POSIX systems start directly at `/`. `navigator.platform` is fine for this
 * UI-only concern ("Win32" / "MacIntel" / "Linux …").
 */
const platform = navigator.platform.toLowerCase()
export const IS_WINDOWS = platform.includes('win')
export const IS_MAC = platform.includes('mac')
/** The tree's synthetic root: 此电脑 on Windows, `/` elsewhere. */
export const ROOT = IS_WINDOWS ? THIS_PC : '/'

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
  /** Hover-probed readability, drives the denied styling. */
  access: 'unknown' | 'ok' | 'denied'
  /** Explorer-equivalent hidden|system flag; display-filtered by settings. */
  hidden: boolean
}

/** One horizontal band of the editor area: its groups laid out left to
 * right; rows stack top to bottom. `splitEditor('up'/'down')` creates rows,
 * `'left'/'right'` insert groups into the active row. */
export interface EditorRow {
  id: number
  groups: number[]
}

/** All group ids in visual order (rows top→bottom, each row left→right). */
export function flatGroups(rows: EditorRow[]): number[] {
  return rows.flatMap((r) => r.groups)
}

export type SplitDirection = 'left' | 'right' | 'up' | 'down'

export interface TabInfo {
  path: string
  /** Editor group this tab lives in (see WorkspaceState.rows). */
  group: number
  name: string
  kind: FileKind
  icon: string
  text: string
  /** The on-disk text this session started from; dirty = text !== original. */
  original: string
  /** Cached line count so the status bar never re-splits text per keystroke. */
  lineCount: number
  /** Encoding the file was read as; saving re-encodes to it. */
  encoding: string
  /** `crlf` | `lf`; saving restores it because the editor only speaks LF. */
  eol: string
  /** On-disk size in bytes; text tabs learn it from read_text/write_text,
   * binary tabs from the preview viewers' byte buffers. */
  size: number | null
  dirty: boolean
  readOnly: boolean
  loading: boolean
  error: string | null
}

interface DirEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
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
  /** Drive listing in flight (loadSystemTree is the only writer). */
  rootLoading: boolean
  /** Last loadSystemTree failure — the tree offers a retry while set. */
  rootError: string | null
  tabs: TabInfo[]
  /** Editor rows top to bottom, each row's groups left to right; ids are
   * session-unique. Every tab lives in exactly one group — the same file
   * never shows in two groups. */
  rows: EditorRow[]
  /** Flex-grow width of each group within its row; the splitter between two
   * groups rebalances its neighbours. */
  groupRatios: Record<number, number>
  /** Flex-grow height of each row; the splitter between two rows
   * rebalances its neighbours. */
  rowRatios: Record<number, number>
  /** Active tab path per group. */
  groupActive: Record<number, string | null>
  /** The focused group — tree clicks and edits land here. */
  activeGroup: number
  /** Per-file viewer zoom (image/pdf/office), keyed by path; the group
   * status bar's − %/＋ controls and the viewer itself both drive this. */
  zoom: Record<string, number>
  clipboard: { mode: 'copy' | 'cut'; path: string } | null

  sidebarWidth: number
  /** Preview width as a fraction of the group body, so editor:preview stays
   * proportional when the window resizes. */
  previewRatio: number
  sidebarOpen: boolean
  /** Per-group view mode of previewable files: edit the source only, show
   * only the rendered preview, or both side by side. */
  groupView: Record<number, GroupView>

  loadSystemTree: () => Promise<void>
  retranslateRoots: () => void
  toggleNode: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  /** Open `path` in a new group to the right of the active one. */
  openToSide: (path: string) => Promise<void>
  openInTerminal: () => Promise<void>
  activate: (path: string) => void
  closeTab: (path: string) => Promise<void>
  closeAllTabs: () => Promise<void>
  closeOthers: (path: string) => Promise<void>
  closeRight: (path: string) => Promise<void>
  editActive: (group: number, text: string, lineCount: number) => void
  saveActive: () => Promise<void>
  dismissNotice: () => void

  /** Hover-probe a not-yet-listed directory's readability. */
  probeAccess: (path: string) => Promise<void>
  /** Re-list a directory's children in place (after tree mutations). */
  reloadDir: (dir: string) => Promise<void>
  /** Re-list externally-mutated watched dirs; prune them if deleted. */
  handleFsChanges: (dirs: string[]) => Promise<void>
  /** Drop a deleted-externally node from the tree (tabs are kept). */
  pruneNode: (path: string) => void
  createNode: (dir: string, type: 'file' | 'dir', name: string) => Promise<void>
  renameNode: (path: string, newName: string) => Promise<void>
  removeNode: (path: string) => Promise<void>
  setClipboard: (mode: 'copy' | 'cut', path: string) => void
  pasteInto: (dir: string) => Promise<void>

  /** Expand ancestors + select a path (search results → tree). */
  revealPath: (path: string) => Promise<void>
  /** Expand a Quick Access folder from the top down, stubbing ancestors the
   * tree never listed (unlike revealPath, which relies on loaded nodes). */
  revealPinned: (path: string) => Promise<void>
  /** Bulk-expand saved directories (session restore), parents first. */
  expandDirs: (paths: string[]) => Promise<void>
  /** Reopen tabs saved by the last session; `draft` restores unsaved edits.
   * `group` places the tab in a pre-created group (session restore). */
  openRestoredTab: (path: string, draft?: string, group?: number) => Promise<void>

  /** Split: an empty group opens to the left/right of the active one in its
   * row, or a new row above/below it. */
  splitEditor: (direction?: SplitDirection) => void
  /** Focus a group (click anywhere inside it); its active tab becomes the
   * global active tab. */
  setActiveGroup: (group: number) => void
  closeGroup: (group: number) => Promise<void>
  /** Session restore: build rows of empty groups (`rowSizes[i]` groups in
   * row i, `rowRatios[i]` its height share) and return the new group ids in
   * saved order. */
  restoreLayout: (rowSizes: number[], rowRatios?: number[]) => number[]
  /** Set the flex-grow of the two groups flanking a splitter. */
  adjustGroupSplit: (left: number, right: number, leftGrow: number, rightGrow: number) => void
  /** Set the flex-grow of the two rows flanking a splitter. */
  adjustRowSplit: (top: number, bottom: number, topGrow: number, bottomGrow: number) => void
  /** Store a viewer's zoom for one file (clamped by the caller). */
  setZoom: (path: string, zoom: number) => void
  /** Preview viewers report the byte size they fetched (image/pdf/office). */
  setTabSize: (path: string, size: number) => void

  setSidebarWidth: (px: number) => void
  setPreviewRatio: (ratio: number) => void
  toggleSidebar: () => void
  togglePreview: (group?: number) => void
  setGroupView: (group: number, view: GroupView) => void
}

/**
 * Files with a real right-pane preview: markdown renders live, SVG text
 * renders as an image (source stays in the editor). For everything else the
 * pane would only ever show a placeholder hint, so opening such a file
 * auto-collapses it (user decision 2026-09-25).
 */
/** View mode of one group for previewable files: edit the source only, show
 * only the rendered preview, or both side by side. */
export type GroupView = 'edit' | 'preview' | 'both'

/** The view a group boots with; after that the mode is sticky — only the
 * status-bar switcher (or Ctrl+Shift+V) changes it, never open/activate. */

export function hasPreview(path: string): boolean {
  return fileKind(path) === 'markdown' || (fileKind(path) === 'text' && extname(path) === 'svg')
}

/** Prefix matching every node/tab path inside `path` (itself included). */
function subTreePrefix(path: string): string {
  return /[/\\]$/.test(path) ? path : path + (path.includes('\\') ? '\\' : '/')
}

const INITIAL_GROUP = 1
const INITIAL_ROW = 1
/** Layout sanity cap; VS Code-style unlimited groups would just shrink each
 * pane into uselessness. */
const MAX_GROUPS = 4
let nextGroupId = INITIAL_GROUP + 1
let nextRowId = INITIAL_ROW + 1

/**
 * Drop tabs matching `drop`, then rebalance: a group whose active tab went
 * away falls back to its last tab, and emptied groups are removed — except
 * the last one, which survives empty so the workbench always shows one
 * editor area.
 */
function dropTabs(s: WorkspaceState, drop: (t: TabInfo) => boolean): Partial<WorkspaceState> {
  const tabs = s.tabs.filter((t) => !drop(t))
  const groupActive = { ...s.groupActive }
  for (const g of flatGroups(s.rows)) {
    const remaining = tabs.filter((t) => t.group === g)
    if (remaining.length > 0) {
      if (!remaining.some((t) => t.path === groupActive[g])) {
        groupActive[g] = remaining[remaining.length - 1].path
      }
    } else {
      // Emptied groups are KEPT (welcome card + 关闭此分组 button) — a group
      // only ever closes via closeGroup, never as a side effect of closing
      // tabs.
      groupActive[g] = null
    }
  }
  return { tabs, groupActive, activeGroup: s.activeGroup }
}

function node(path: string, name: string, isDir: boolean, hidden = false): NodeInfo {
  return {
    path,
    name,
    isDir,
    icon: isDir ? (isRootPath(path) ? driveIcon(path) : DIR_ICON) : fileIcon(path),
    children: null,
    expanded: false,
    loading: false,
    error: null,
    access: 'unknown',
    hidden,
  }
}

/** Turns Rust's `io::Error` strings into something worth showing a user. */
function describe(err: unknown): string {
  const message = String(err)
  if (message.includes('os error 5')) return tBackend('没有访问权限')
  return tBackend(message)
}

/**
 * Every close path funnels unsaved work through this guard, so bulk closes
 * can never silently drop edits. `count === 0` resolves immediately.
 */
const confirmDiscard = (count: number): Promise<boolean> =>
  count === 0
    ? Promise.resolve(true)
    : ask(t('ask.unsaved', { n: count }), {
        title: 'SVCode',
        kind: 'warning',
        okLabel: t('dialog.close'),
        cancelLabel: t('dialog.cancel'),
      })

/**
 * Expand `chain` (top-down) inside the store, stubbing levels the tree never
 * listed. Never collapses: already-open levels are skipped, so re-reveals
 * (search hits, tab clicks, Quick Access) can't fold the tree back up.
 * `toggleNode` supplies listing, expansion and watching for each new level;
 * the walk naturally stops at the always-loaded root/drive nodes.
 */
async function expandRevealChain(
  get: () => WorkspaceState,
  set: (partial: Partial<WorkspaceState> | ((s: WorkspaceState) => Partial<WorkspaceState>)) => void,
  chain: string[],
): Promise<void> {
  for (const dir of chain) {
    if (!get().nodes[dir]) {
      set((s) => ({ nodes: { ...s.nodes, [dir]: node(dir, basename(dir), true) } }))
    }
    const n = get().nodes[dir]
    if ((n.expanded && n.children) || n.access === 'denied') continue
    await get().toggleNode(dir)
  }
}

/** Ancestor chain of `path` down from the tree root, `path` excluded. */
function ancestorChain(path: string): string[] {
  const chain: string[] = []
  let cur = dirname(path)
  while (cur && cur !== ROOT && cur !== THIS_PC) {
    chain.unshift(cur)
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return chain
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const patch = (path: string, changes: Partial<NodeInfo>) =>
    set((s) => ({ nodes: { ...s.nodes, [path]: { ...s.nodes[path], ...changes } } }))

  /** Fresh, not-yet-loaded tab shell in group `group`. */
  const beginTab = (path: string, group: number): TabInfo => {
    const kind = fileKind(path)
    return {
      path,
      group,
      name: basename(path),
      kind,
      icon: fileIcon(path),
      text: '',
      original: '',
      lineCount: 1,
      encoding: 'utf-8',
      eol: 'lf',
      size: null,
      dirty: false,
      readOnly: false,
      loading: kind === 'text' || kind === 'markdown',
      error: null,
    }
  }

  /** Load a just-appended tab's content, or surface the read error on it. */
  const readTab = async (path: string) => {
    try {
      const content = await invoke<TextContent>('read_text', { path })
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === path
            ? {
                ...t,
                text: content.text,
                original: content.text,
                lineCount: countLines(content.text),
                encoding: content.encoding,
                eol: content.eol,
                size: content.size,
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
  }

  /** Focus `path` in the group it lives in (tab exists somewhere). */
  const focusTab = (path: string, group: number) =>
    set((s) => ({ activeGroup: group, groupActive: { ...s.groupActive, [group]: path } }))

  /**
   * Remap a renamed/moved path and its whole subtree through nodes, tabs and
   * the active-tab pointer (used by rename and cut-paste).
   */
  const relocate = (path: string, newPath: string) =>
    set((s) => {
      const prefix = subTreePrefix(path)
      const nodes = { ...s.nodes }
      const moved: Record<string, NodeInfo> = {}
      for (const k of Object.keys(nodes)) {
        if (k === path) {
          moved[newPath] = { ...nodes[k], path: newPath, name: basename(newPath) }
          delete nodes[k]
        } else if (k.startsWith(prefix)) {
          const nk = newPath + k.slice(path.length)
          moved[nk] = { ...nodes[k], path: nk }
          delete nodes[k]
        }
      }
      const tabs = s.tabs.map((t) =>
        t.path === path
          ? { ...t, path: newPath, name: basename(newPath), icon: fileIcon(newPath) }
          : t.path.startsWith(prefix)
            ? { ...t, path: newPath + t.path.slice(path.length) }
            : t,
      )
      const groupActive = { ...s.groupActive }
      for (const g of Object.keys(groupActive)) {
        const v = groupActive[Number(g)]
        if (!v) continue
        groupActive[Number(g)] =
          v === path ? newPath : v.startsWith(prefix) ? newPath + v.slice(path.length) : v
      }
      // Viewer zoom follows the file across renames/moves too.
      const zoom = { ...s.zoom }
      for (const k of Object.keys(zoom)) {
        if (k === path) {
          zoom[newPath] = zoom[k]
          delete zoom[k]
        } else if (k.startsWith(prefix)) {
          zoom[newPath + k.slice(path.length)] = zoom[k]
          delete zoom[k]
        }
      }
      return { nodes: { ...nodes, ...moved }, tabs, groupActive, zoom }
    })

  return {
    nodes: {},
    selectedDir: null,
    notice: null,
    rootLoading: false,
    rootError: null,
    tabs: [],
    rows: [{ id: INITIAL_ROW, groups: [INITIAL_GROUP] }],
    rowRatios: { [INITIAL_ROW]: 1 },
    groupRatios: { [INITIAL_GROUP]: 1 },
    groupActive: { [INITIAL_GROUP]: null },
    activeGroup: INITIAL_GROUP,
    zoom: {},
    clipboard: null,

    sidebarWidth: 260,
    previewRatio: 0.34,
    sidebarOpen: true,
    groupView: { [INITIAL_GROUP]: 'both' },

    loadSystemTree: async () => {
      if (get().nodes[ROOT] || get().rootLoading) return
      set({ rootLoading: true, rootError: null })
      try {
        if (!IS_WINDOWS) {
          // POSIX: one real root folder, listed lazily like any other directory.
          set({
            nodes: {
              [ROOT]: {
                ...node(ROOT, IS_MAC ? 'Macintosh HD' : t('root.fs'), true),
                icon: PC_ICON,
              },
            },
          })
          return
        }
        const drives = await invoke<DriveInfo[]>('list_drives')
        const children = drives.map((d) => d.path)
        const nodes: Record<string, NodeInfo> = {
          [THIS_PC]: { ...node(THIS_PC, t('root.thisPC'), true), icon: PC_ICON, expanded: true, children },
        }
        for (const d of drives) nodes[d.path] = node(d.path, tDriveName(d.display), true)
        set({ nodes })
      } catch (err) {
        // Without this the tree would sit at "loading" forever on a failed
        // drive listing; the tree offers a click-to-retry instead.
        set({ rootError: describe(err) })
      } finally {
        set({ rootLoading: false })
      }
    },

    retranslateRoots: () =>
      set((s) => {
        const nodes = { ...s.nodes }
        let changed = false
        const relabel = (k: string, name: string) => {
          if (nodes[k] && nodes[k].name !== name) {
            nodes[k] = { ...nodes[k], name }
            changed = true
          }
        }
        if (nodes[THIS_PC]) relabel(THIS_PC, t('root.thisPC'))
        if (!IS_WINDOWS && nodes[ROOT]) relabel(ROOT, IS_MAC ? 'Macintosh HD' : t('root.fs'))
        for (const k of Object.keys(nodes)) {
          if (isRootPath(k) && k !== ROOT) relabel(k, tDriveName(nodes[k].name))
        }
        return changed ? { nodes } : {}
      }),

    toggleNode: async (path) => {
      const current = get().nodes[path]
      if (!current) return
      set({ selectedDir: path === THIS_PC ? null : path, notice: null })

      if (current.expanded) {
        patch(path, { expanded: false })
        void invoke('unwatch_dir', { path }).catch(() => {})
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
        for (const e of entries) if (!known[e.path]) added[e.path] = node(e.path, e.name, e.isDir, e.hidden)
        set((s) => ({ nodes: { ...s.nodes, ...added } }))
        patch(path, { children: entries.map((e) => e.path), loading: false, access: 'ok' })
        // Track external mutations while this listing is visible.
        void invoke('watch_dir', { path }).catch(() => {})
      } catch (err) {
        const message = describe(err)
        patch(path, {
          loading: false,
          expanded: false,
          error: message,
          access: message.includes('os error 5') ? 'denied' : 'unknown',
        })
      }
    },

  openFile: async (path) => {
    // The view mode is sticky (set via the status-bar switcher); opening a
    // file never forces it. Non-previewable files simply render as editor.
    const opened = get().tabs.find((t) => t.path === path)
    const group = opened ? opened.group : get().activeGroup
    set({
      selectedDir: dirname(path),
      notice: null,
    })
    if (opened) {
      focusTab(path, opened.group)
      return
    }

    const tab = beginTab(path, group)
    set((s) => ({ tabs: [...s.tabs, tab], groupActive: { ...s.groupActive, [group]: path } }))
    if (!tab.loading) return
    await readTab(path)
  },

  openToSide: async (path) => {
    const opened = get().tabs.find((t) => t.path === path)
    if (opened) {
      set({
        selectedDir: dirname(path),
        notice: null,
      })
      focusTab(path, opened.group)
      return
    }
    const s = get()
    if (flatGroups(s.rows).length >= MAX_GROUPS) {
      set({ notice: t('group.max', { n: MAX_GROUPS }) })
      return
    }
    const id = nextGroupId++
    const row = s.rows.find((r) => r.groups.includes(s.activeGroup)) ?? s.rows[0]
    const groups = [...row.groups]
    groups.splice(groups.indexOf(s.activeGroup) + 1, 0, id)
    const tab = beginTab(path, id)
    set({
      tabs: [...s.tabs, tab],
      rows: s.rows.map((r) => (r === row ? { ...r, groups } : r)),
      groupRatios: { ...s.groupRatios, [id]: 1 },
      groupActive: { ...s.groupActive, [id]: path },
      groupView: { ...s.groupView, [id]: 'both' },
      activeGroup: id,
      selectedDir: dirname(path),
      notice: null,
    })
    if (!tab.loading) return
    await readTab(path)
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

    activate: (path) => {
      const tab = get().tabs.find((t) => t.path === path)
      if (!tab) return
      focusTab(path, tab.group)
    },

    closeTab: async (path) => {
      const tab = get().tabs.find((t) => t.path === path)
      if (!tab) return
      if (!(await confirmDiscard(tab.dirty ? 1 : 0))) return
      set((s) => dropTabs(s, (t) => t.path === path))
    },

    closeAllTabs: async () => {
      const { tabs, activeGroup } = get()
      const groupTabs = tabs.filter((t) => t.group === activeGroup)
      if (groupTabs.length === 0) return
      if (!(await confirmDiscard(groupTabs.filter((t) => t.dirty).length))) return
      set((s) => dropTabs(s, (t) => t.group === s.activeGroup))
    },

    closeOthers: async (path) => {
      const tab = get().tabs.find((t) => t.path === path)
      if (!tab) return
      const doomed = get().tabs.filter((t) => t.group === tab.group && t.path !== path)
      if (!(await confirmDiscard(doomed.filter((t) => t.dirty).length))) return
      const drop = new Set(doomed.map((t) => t.path))
      set((s) => dropTabs(s, (t) => drop.has(t.path)))
      focusTab(path, tab.group)
    },

    closeRight: async (path) => {
      const tab = get().tabs.find((t) => t.path === path)
      if (!tab) return
      const groupTabs = get().tabs.filter((t) => t.group === tab.group)
      const idx = groupTabs.findIndex((t) => t.path === path)
      if (idx < 0 || idx === groupTabs.length - 1) return
      const doomed = groupTabs.slice(idx + 1)
      if (!(await confirmDiscard(doomed.filter((t) => t.dirty).length))) return
      const drop = new Set(doomed.map((t) => t.path))
      set((s) => dropTabs(s, (t) => drop.has(t.path)))
    },

    editActive: (group, text, lineCount) =>
      set((s) => {
        const active = s.groupActive[group]
        return {
          tabs: s.tabs.map((t) =>
            t.group === group && t.path === active
              ? { ...t, text, lineCount, dirty: text !== t.original }
              : t,
          ),
        }
      }),

    saveActive: async () => {
      const s = get()
      const tab = s.tabs.find(
        (t) => t.group === s.activeGroup && t.path === s.groupActive[s.activeGroup],
      )
      if (!tab || !tab.dirty || tab.readOnly) return
      try {
        const newSize = await invoke<number>('write_text', {
          path: tab.path,
          text: tab.text,
          encoding: tab.encoding,
          eol: tab.eol,
        })
        set((s) => ({
          notice: null,
          tabs: s.tabs.map((t) =>
            t.path === tab.path ? { ...t, dirty: false, original: t.text, size: newSize } : t,
          ),
        }))
      } catch (err) {
        set({ notice: t('ws.saveFailed', { msg: describe(err) }) })
      }
    },

    revealPath: async (path) => {
      // Expand the ancestor chain (stubbing never-listed levels — a file
      // opened via search can live in an unopened drive), select the parent,
      // and expand the target itself when it is a folder. Never collapses.
      set({ selectedDir: dirname(path), notice: null })
      await expandRevealChain(get, set, ancestorChain(path))
      const target = get().nodes[path]
      if (
        target?.isDir &&
        target.access !== 'denied' &&
        !(target.expanded && target.children)
      ) {
        await get().toggleNode(path)
      }
    },

    revealPinned: async (path) => {
      // Quick Access reveal: same expand-only walk, but the pinned folder
      // itself is the target (chain includes it) and it owns the selection.
      set({ selectedDir: path, notice: null })
      await expandRevealChain(get, set, ancestorChain(path))
      const target = get().nodes[path]
      if (!target) return
      if (target.access !== 'denied' && !(target.expanded && target.children)) {
        await get().toggleNode(path)
      }
    },

    expandDirs: async (paths) => {
      // Round after round until nothing new loads, so nested saved dirs work
      // regardless of the order they were persisted in.
      let pending = paths.filter((p) => p !== THIS_PC && p !== ROOT)
      while (pending.length > 0) {
        const round = pending
        pending = []
        for (const dir of round) {
          const node = get().nodes[dir]
          if (!node) continue
          if (node.children) {
            patch(dir, { expanded: true })
          } else {
            pending.push(dir)
          }
        }
        if (pending.length === round.length) {
          // Nothing left is already loaded — list the rest sequentially so
          // parents exist before children try to expand.
          for (const dir of pending) await get().toggleNode(dir)
          return
        }
      }
    },

    openRestoredTab: async (path, draft, group) => {
      const opened = get().tabs.find((t) => t.path === path)
      if (opened) {
        focusTab(path, opened.group)
        return
      }
      const g = group ?? get().activeGroup
      const tab = beginTab(path, g)
      set((s) => ({ tabs: [...s.tabs, tab], groupActive: { ...s.groupActive, [g]: path } }))
      if (!tab.loading) return

      // A draft means the last session closed with unsaved edits — restore the
      // buffer content and keep the tab dirty instead of silently dropping it.
      if (draft !== undefined) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.path === path
              ? { ...t, text: draft, lineCount: countLines(draft), dirty: true, loading: false }
              : t,
          ),
        }))
        return
      }

      await readTab(path)
    },

    dismissNotice: () => set({ notice: null }),

    probeAccess: async (path) => {
      const n = get().nodes[path]
      if (!n || !n.isDir || n.access !== 'unknown' || n.children || path === THIS_PC || isRootPath(path))
        return
      try {
        const ok = await invoke<boolean>('check_access', { path })
        patch(path, { access: ok ? 'ok' : 'denied' })
      } catch {
        patch(path, { access: 'denied' })
      }
    },

    reloadDir: async (dir) => {
      const n = get().nodes[dir]
      if (!n || !n.isDir || n.access === 'denied') return
      try {
        const entries = await invoke<DirEntry[]>('list_dir', { path: dir })
        const known = get().nodes
        const added: Record<string, NodeInfo> = {}
        for (const e of entries) if (!known[e.path]) added[e.path] = node(e.path, e.name, e.isDir, e.hidden)
        set((s) => ({ nodes: { ...s.nodes, ...added } }))
        patch(dir, { children: entries.map((e) => e.path), error: null, access: 'ok' })
      } catch (err) {
        patch(dir, { error: describe(err) })
      }
    },

    handleFsChanges: async (dirs) => {
      for (const dir of dirs) {
        const current = get().nodes[dir]
        // Only expanded listings are watched and visible; anything else can
        // lazily pick up changes on its next expansion.
        if (!current || !current.expanded) continue
        await get().reloadDir(dir)
        const fresh = get().nodes[dir]
        // The watched directory itself was deleted or moved away.
        if (fresh?.error && /os error [23]/.test(fresh.error)) get().pruneNode(dir)
      }
    },

    pruneNode: (path) => {
      void invoke('unwatch_dir', { path }).catch(() => {})
      set((s) => {
        const nodes = { ...s.nodes }
        const prefix = subTreePrefix(path)
        for (const key of Object.keys(nodes)) {
          if (key === path || key.startsWith(prefix)) delete nodes[key]
        }
        const parent = dirname(path)
        if (parent && nodes[parent]?.children) {
          nodes[parent] = {
            ...nodes[parent],
            children: nodes[parent].children!.filter((child) => child !== path),
          }
        }
        // Open tabs are intentionally kept: dropping them could lose drafts,
        // and saving into the deleted path surfaces a natural error instead.
        return { nodes }
      })
    },

    createNode: async (dir, type, name) => {
      const path = joinPath(dir, name)
      try {
        await invoke(type === 'file' ? 'create_file' : 'create_dir', { path })
        await get().reloadDir(dir)
        if (type === 'file') void get().openFile(path)
      } catch (err) {
        set({ notice: describe(err) })
      }
    },

    renameNode: async (path, newName) => {
      const dir = dirname(path)
      const newPath = joinPath(dir, newName)
      try {
        await invoke('rename_path', { oldPath: path, newPath })
        relocate(path, newPath)
        await get().reloadDir(dir)
      } catch (err) {
        set({ notice: describe(err) })
      }
    },

    removeNode: async (path) => {
      const prefix = subTreePrefix(path)
      // Deleting a folder drops its open tabs — guard unsaved edits first.
      const dirty = get().tabs.filter((t) => (t.path === path || t.path.startsWith(prefix)) && t.dirty)
      if (dirty.length > 0 && !(await confirmDiscard(dirty.length))) return
      try {
        await invoke('delete_path', { path, recursive: true })
        set((s) => {
          const nodes = { ...s.nodes }
          for (const k of Object.keys(nodes)) {
            if (k === path || k.startsWith(prefix)) delete nodes[k]
          }
          // Open tabs on deleted paths are dropped (guarded above); dropTabs
          // rebalances per-group actives and removes emptied groups.
          return { nodes, ...dropTabs(s, (t) => t.path === path || t.path.startsWith(prefix)) }
        })
        const parent = dirname(path)
        if (parent && get().nodes[parent]) await get().reloadDir(parent)
      } catch (err) {
        set({ notice: t('ws.deleteFailed', { msg: describe(err) }) })
      }
    },

    setClipboard: (mode, path) => set({ clipboard: { mode, path } }),

    pasteInto: async (dir) => {
      const clip = get().clipboard
      if (!clip) return
      const name = basename(clip.path)
      const dot = name.lastIndexOf('.')
      const stem = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ''
      const taken = new Set(get().nodes[dir]?.children ?? [])
      const copy = t('paste.copy')
      let destName = clip.mode === 'copy' ? `${stem} - ${copy}${ext}` : name
      let i = 2
      while (taken.has(joinPath(dir, destName)) && i < 100) {
        destName =
          clip.mode === 'copy' ? `${stem} - ${copy} (${i})${ext}` : `${stem} (${i})${ext}`
        i++
      }
      const dest = joinPath(dir, destName)
      try {
        await invoke(clip.mode === 'copy' ? 'copy_path' : 'move_path', { src: clip.path, dest })
        if (clip.mode === 'cut') {
          relocate(clip.path, dest)
          set({ clipboard: null })
        }
        await get().reloadDir(dir)
      } catch (err) {
        set({ notice: describe(err) })
      }
    },

    setSidebarWidth: (px) => set({ sidebarWidth: clamp(px, 160, 520) }),
    setPreviewRatio: (ratio) => set({ previewRatio: clamp(ratio, 0.15, 0.6) }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    togglePreview: (group) =>
      set((s) => {
        const g = group ?? s.activeGroup
        // Ctrl+Shift+V / the preview's ×: hide the preview entirely, or bring
        // it back as the side-by-side view.
        return { groupView: { ...s.groupView, [g]: (s.groupView[g] ?? 'both') === 'edit' ? 'both' : 'edit' } }
      }),

    setGroupView: (group, view) =>
      set((s) => ({ groupView: { ...s.groupView, [group]: view } })),

    setActiveGroup: (group) => {
      if (get().rows.some((r) => r.groups.includes(group))) set({ activeGroup: group })
    },

    splitEditor: (direction = 'right') => {
      const s = get()
      if (flatGroups(s.rows).length >= MAX_GROUPS) {
        set({ notice: t('group.max', { n: MAX_GROUPS }) })
        return
      }
      const id = nextGroupId++
      const row = s.rows.find((r) => r.groups.includes(s.activeGroup))
      if (row && (direction === 'left' || direction === 'right')) {
        const groups = [...row.groups]
        groups.splice(groups.indexOf(s.activeGroup) + (direction === 'right' ? 1 : 0), 0, id)
        set({
          rows: s.rows.map((r) => (r === row ? { ...r, groups } : r)),
          groupRatios: { ...s.groupRatios, [id]: 1 },
          groupActive: { ...s.groupActive, [id]: null },
          groupView: { ...s.groupView, [id]: 'both' },
          activeGroup: id,
        })
        return
      }
      // A new row above/below the active group's row (or appended when the
      // active group is somehow missing).
      const at = row ? s.rows.indexOf(row) + (direction === 'up' ? 0 : 1) : s.rows.length
      const rowId = nextRowId++
      const rows = [...s.rows]
      rows.splice(at, 0, { id: rowId, groups: [id] })
      set({
        rows,
        rowRatios: { ...s.rowRatios, [rowId]: 1 },
        groupRatios: { ...s.groupRatios, [id]: 1 },
        groupActive: { ...s.groupActive, [id]: null },
        groupView: { ...s.groupView, [id]: 'both' },
        activeGroup: id,
      })
    },

    closeGroup: async (group) => {
      const dirty = get().tabs.filter((t) => t.group === group && t.dirty).length
      if (!(await confirmDiscard(dirty))) return
      set((s) => {
        const row = s.rows.find((r) => r.groups.includes(group))
        let rows = s.rows
          .map((r) => (r === row ? { ...r, groups: r.groups.filter((g) => g !== group) } : r))
          .filter((r) => r.groups.length > 0)
        const groupActive = { ...s.groupActive }
        const groupRatios = { ...s.groupRatios }
        const groupView = { ...s.groupView }
        const rowRatios = { ...s.rowRatios }
        delete groupActive[group]
        delete groupRatios[group]
        delete groupView[group]
        let activeGroup = s.activeGroup
        if (rows.length === 0) {
          // Never leave the workbench without an editor area.
          const gid = nextGroupId++
          const rid = nextRowId++
          rows = [{ id: rid, groups: [gid] }]
          groupActive[gid] = null
          groupRatios[gid] = 1
          groupView[gid] = 'both'
          rowRatios[rid] = 1
          activeGroup = gid
        } else {
          // The emptied row vanished with its last group.
          if (row && !rows.includes(row)) delete rowRatios[row.id]
          if (activeGroup === group) {
            const flat = flatGroups(rows)
            activeGroup = flat[Math.min(Math.max(0, flatGroups(s.rows).indexOf(group) - 1), flat.length - 1)]
          }
        }
        return {
          tabs: s.tabs.filter((t) => t.group !== group),
          rows,
          groupActive,
          groupRatios,
          groupView,
          rowRatios,
          activeGroup,
        }
      })
    },

    restoreLayout: (rowSizes, rowRatios) => {
      const rows: EditorRow[] = []
      const gids: number[] = []
      const groupRatios: Record<number, number> = {}
      const groupActive: Record<number, string | null> = {}
      const groupView: Record<number, GroupView> = {}
      const newRowRatios: Record<number, number> = {}
      for (let i = 0; i < rowSizes.length; i++) {
        const groups: number[] = []
        for (let j = 0; j < rowSizes[i]; j++) {
          const gid = nextGroupId++
          groups.push(gid)
          gids.push(gid)
          groupRatios[gid] = 1
          groupActive[gid] = null
          groupView[gid] = 'both'
        }
        if (groups.length > 0) {
          const rowId = nextRowId++
          rows.push({ id: rowId, groups })
          newRowRatios[rowId] = rowRatios?.[i] ?? 1
        }
      }
      if (rows.length === 0) {
        // Degenerate session data — fall back to one empty group.
        const gid = nextGroupId++
        const rowId = nextRowId++
        const fallbackRows = [{ id: rowId, groups: [gid] }]
        set({
          rows: fallbackRows,
          groupRatios: { [gid]: 1 },
          rowRatios: { [rowId]: 1 },
          groupActive: { [gid]: null },
          groupView: { [gid]: 'both' },
          tabs: [],
          activeGroup: gid,
        })
        return [gid]
      }
      set({ rows, groupRatios, rowRatios: newRowRatios, groupActive, groupView, tabs: [], activeGroup: rows[0].groups[0] })
      return gids
    },

    adjustGroupSplit: (left, right, leftGrow, rightGrow) =>
      set((s) => ({
        groupRatios: {
          ...s.groupRatios,
          [left]: Math.max(0.08, leftGrow),
          [right]: Math.max(0.08, rightGrow),
        },
      })),

    adjustRowSplit: (top, bottom, topGrow, bottomGrow) =>
      set((s) => ({
        rowRatios: {
          ...s.rowRatios,
          [top]: Math.max(0.08, topGrow),
          [bottom]: Math.max(0.08, bottomGrow),
        },
      })),

    setZoom: (path, zoom) => set((s) => ({ zoom: { ...s.zoom, [path]: zoom } })),
    setTabSize: (path, size) =>
      set((s) => ({
        tabs: s.tabs.map((t) => (t.path === path && t.size === null ? { ...t, size } : t)),
      })),
  }
})

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

/** Line count without allocating a per-line array (status bar hot path). */
function countLines(text: string): number {
  if (!text) return 1
  let n = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

/** Active tab path of the focused group (successor of the old state field). */
export function activePathOf(s: WorkspaceState): string | null {
  return s.groupActive[s.activeGroup] ?? null
}
