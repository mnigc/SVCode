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

let timer: ReturnType<typeof setTimeout> | null = null

/** Debounced persist — call from anywhere state changes. */
export function scheduleSessionSave() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void saveSessionNow().catch(() => {})
  }, SAVE_DEBOUNCE_MS)
}

/** Last payload actually written; an identical re-serialization (most ticks
 * change nothing) skips the IPC write entirely. */
let lastSerialized: string | null = null

/** Drafts already warned about — one line per file per session, not one per
 * debounced save tick while the tab stays open. */
const warnedDrafts = new Set<string>()

export async function saveSessionNow() {
  const s = useWorkspace.getState()
  const flat = flatGroups(s.rows)
  const data: SessionData = {
    groups: flat.map((gid) => ({
      active: s.groupActive[gid] ?? null,
      view: s.groupView[gid] ?? 'both',
      tabs: s.tabs
        .filter((t) => t.group === gid && (t.kind === 'text' || t.kind === 'markdown'))
        .map((t) => {
          const overLimit = t.dirty && t.text.length > DRAFT_LIMIT
          if (overLimit && !warnedDrafts.has(t.path)) {
            // Oversized drafts cannot be restored into the editor anyway;
            // dropping them silently would read as data loss with no trace.
            warnedDrafts.add(t.path)
            console.warn(
              `[session] draft of "${t.name}" exceeds the ${DRAFT_LIMIT}-char limit — it will not be restored`,
            )
          }
          return {
            path: t.path,
            draft: t.dirty && !overLimit ? t.text : undefined,
          }
        }),
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
  const serialized = JSON.stringify(data)
  if (serialized === lastSerialized) return
  await kv('session.json').then((k) => k.set('session', data))
  lastSerialized = serialized
}

/** ---- Restore-time shape validation -------------------------------------
 * The session file is data at rest: a truncated write, a schema drift or a
 * hand-edited file must never reach the store half-parsed. Everything is
 * checked up front and ONE bad element discards the whole session — a
 * partial restore (half the tabs, a layout that disagrees) is worse than
 * the default boot. The version migrations below run only after this gate.
 */
const isStr = (v: unknown): v is string => typeof v === 'string'
const isOptStr = (v: unknown): v is string | undefined => v === undefined || typeof v === 'string'

function isValidSessionTab(v: unknown): v is SessionTab {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return isStr(t.path) && isOptStr(t.draft)
}

function isValidSessionGroup(v: unknown): v is SessionGroup {
  if (typeof v !== 'object' || v === null) return false
  const g = v as Record<string, unknown>
  if (!Array.isArray(g.tabs) || !g.tabs.every(isValidSessionTab)) return false
  if (g.active !== undefined && g.active !== null && !isStr(g.active)) return false
  if (g.view !== undefined && g.view !== 'edit' && g.view !== 'preview' && g.view !== 'both')
    return false
  return g.preview === undefined || typeof g.preview === 'boolean'
}

export function isValidSessionData(data: unknown): data is SessionData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
  const d = data as Record<string, unknown>
  // active: string | null (per SessionData; tolerate absence in old files).
  if (d.active !== undefined && d.active !== null && !isStr(d.active)) return false
  // expanded drives the tree walk — must be all strings.
  if (!Array.isArray(d.expanded) || !d.expanded.every(isStr)) return false
  if (d.sidebarOpen !== undefined && typeof d.sidebarOpen !== 'boolean') return false
  if (d.sidebarWidth !== undefined && typeof d.sidebarWidth !== 'number') return false
  if (d.previewRatio !== undefined && typeof d.previewRatio !== 'number') return false
  if (d.groups !== undefined) {
    if (!Array.isArray(d.groups) || !d.groups.every(isValidSessionGroup)) return false
  }
  // Pre-groups format (one implicit group).
  if (d.tabs !== undefined) {
    if (!Array.isArray(d.tabs) || !d.tabs.every(isValidSessionTab)) return false
  }
  if (d.layout !== undefined) {
    if (typeof d.layout !== 'object' || d.layout === null) return false
    const l = d.layout as Record<string, unknown>
    if (!Array.isArray(l.rowSizes) || !l.rowSizes.every((n) => typeof n === 'number')) return false
    if (!Array.isArray(l.rowRatios) || !l.rowRatios.every((n) => typeof n === 'number'))
      return false
  }
  return true
}

export async function restoreSession() {
  const data = await kv('session.json')
    .then((k) => k.get<SessionData>('session'))
    .catch(() => undefined)
  // Untrusted at-rest data: one bad shape discards the whole session.
  if (!data || !isValidSessionData(data)) return

  const s = useWorkspace.getState()
  useWorkspace.setState({
    sidebarOpen: data.sidebarOpen ?? s.sidebarOpen,
    // A saved width equal to the OLD default (260) means the user never
    // dragged the splitter — migrate it so the wider default (320) applies
    // to existing sessions too instead of hiding behind the persisted value.
    sidebarWidth:
      data.sidebarWidth === undefined || data.sidebarWidth === 260
        ? s.sidebarWidth
        : data.sidebarWidth,
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
