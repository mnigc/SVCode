import { kv } from './persist'
import { useWorkspace, flatGroups } from '../store/workspace'
import { fileKind } from './paths'

/**
 * Session restore: editor groups with open tabs, unsaved drafts, expanded
 * tree dirs and panel layout, persisted (debounced) through the same KV
 * backend as settings. Drafts are capped at the text-readonly limit —
 * anything bigger cannot have been loaded into the editor anyway.
 */
const DRAFT_LIMIT = 5 * 1024 * 1024
const SAVE_DEBOUNCE_MS = 800

export interface SessionTab {
  path: string
  draft?: string
}

export interface SessionGroup {
  active: string | null
  /** View mode of previewable files ('edit' | 'preview' | 'both'). */
  view?: 'edit' | 'preview' | 'both'
  /** Pre-viewmode format; read only (false = edit-only). */
  preview?: boolean
  tabs: SessionTab[]
}

export interface SessionData {
  groups?: SessionGroup[]
  /** Index into `groups`; secondary windows store their own layout here too. */
  activeGroup?: number
  /** Row layout: groups per row (top→bottom, in `groups` order) and each
   * row's height share. Absent = one row (pre-rows session format). */
  layout?: { rowSizes: number[]; rowRatios: number[] }
  /** Pre-groups format (one implicit group); read only. */
  tabs?: SessionTab[]
  active: string | null
  expanded: string[]
  sidebarOpen: boolean
  sidebarWidth: number
  previewRatio: number
}

export async function saveSessionNow() {
  const s = useWorkspace.getState()
  const flat = flatGroups(s.rows)
  const data: SessionData = {
    groups: flat.map((gid) => ({
      active: s.groupActive[gid] ?? null,
      view: s.groupView[gid] ?? 'both',
      tabs: s.tabs
        .filter((t) => t.group === gid && (t.kind === 'text' || t.kind === 'markdown'))
        .map((t) => ({
          path: t.path,
          draft: t.dirty && t.text.length <= DRAFT_LIMIT ? t.text : undefined,
        })),
    })),
    activeGroup: flat.indexOf(s.activeGroup),
    layout: {
      rowSizes: s.rows.map((r) => r.groups.length),
      rowRatios: s.rows.map((r) => s.rowRatios[r.id] ?? 1),
    },
    active: s.groupActive[s.activeGroup] ?? null,
    expanded: Object.values(s.nodes)
      .filter((n) => n.isDir && n.expanded && n.children)
      .map((n) => n.path),
    sidebarOpen: s.sidebarOpen,
    sidebarWidth: s.sidebarWidth,
    previewRatio: s.previewRatio,
  }
  await kv('session.json').then((k) => k.set('session', data))
}

let timer: ReturnType<typeof setTimeout> | null = null

/** Debounced persist — call from anywhere state changes. */
export function scheduleSessionSave() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void saveSessionNow().catch(() => {})
  }, SAVE_DEBOUNCE_MS)
}

export async function restoreSession() {
  const data = await kv('session.json')
    .then((k) => k.get<SessionData>('session'))
    .catch(() => undefined)
  if (!data) return

  const s = useWorkspace.getState()
  useWorkspace.setState({
    sidebarOpen: data.sidebarOpen ?? s.sidebarOpen,
    sidebarWidth: data.sidebarWidth ?? s.sidebarWidth,
    // Old sessions may carry a px previewWidth; ignore it and fall back to
    // the default ratio rather than dividing by a stale container width.
    previewRatio:
      typeof data.previewRatio === 'number' ? data.previewRatio : s.previewRatio,
  })

  await s.loadSystemTree()
  if (data.expanded?.length) await s.expandDirs(data.expanded)

  if (data.groups?.length) {
    // Rebuild the saved rows/columns. restoreLayout clears the default group
    // the store booted with and mints fresh ids in saved order.
    const groups = data.groups
    const layout = data.layout
    // Only trust a layout that accounts for every saved group exactly once.
    const sizes =
      layout?.rowSizes?.length &&
      layout.rowSizes.every((n) => n >= 1) &&
      layout.rowSizes.reduce((a, b) => a + b, 0) === groups.length
        ? layout.rowSizes
        : [groups.length]
    useWorkspace.setState({
      tabs: [],
      rows: [],
      groupActive: {},
      groupRatios: {},
      rowRatios: {},
    })
    const gids = s.restoreLayout(sizes, layout?.rowRatios)
    for (let i = 0; i < groups.length; i++) {
      const reopenable = groups[i].tabs.filter(
        (t) => fileKind(t.path) === 'text' || fileKind(t.path) === 'markdown',
      )
      // Sequential so the tab order from the last session is preserved.
      for (const t of reopenable) await s.openRestoredTab(t.path, t.draft, gids[i])
      const active = groups[i].active
      if (active && useWorkspace.getState().tabs.some((t) => t.path === active && t.group === gids[i])) {
        useWorkspace.setState((st) => ({ groupActive: { ...st.groupActive, [gids[i]]: active } }))
      }
      useWorkspace.setState((st) => ({
        groupView: {
          ...st.groupView,
          // Pre-viewmode sessions: preview === false meant edit-only.
          [gids[i]]: groups[i].view ?? (groups[i].preview === false ? 'edit' : 'both'),
        },
      }))
    }
    const ag = gids[data.activeGroup ?? 0]
    if (ag !== undefined) s.setActiveGroup(ag)
  } else {
    // Pre-groups session: one flat tab list → a single group.
    const reopenable = (data.tabs ?? []).filter(
      (t) => fileKind(t.path) === 'text' || fileKind(t.path) === 'markdown',
    )
    for (const t of reopenable) await s.openRestoredTab(t.path, t.draft)
    if (data.active && useWorkspace.getState().tabs.some((t) => t.path === data.active)) {
      s.activate(data.active)
    }
  }
}
