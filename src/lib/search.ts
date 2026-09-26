import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface SearchHit {
  path: string
  name: string
  isDir: boolean
}

export interface SearchBackendStatus {
  /** Index fully built (local tier) or Everything answering (everything tier). */
  ready: boolean
  /** A build has been kicked off — false while the local index is still idle,
   * which is the normal state until the first search of the session. */
  started: boolean
  files: number
  /** 'everything' = Everything IPC, 'local' = self-built index. */
  source: 'everything' | 'local'
}

interface SearchState {
  query: string
  results: SearchHit[]
  /** null = fewer than LIMIT hits; anything over the cap isn't fetched. */
  truncated: boolean
  status: SearchBackendStatus | null
  /** Folder clicked in the tree, offered as a search scope. Consumed when
   * the search input gains focus — until then nothing runs. */
  pendingScope: string | null

  setQuery: (q: string) => void
  setPendingScope: (dir: string) => void
  runQuery: (q: string) => Promise<void>
  refreshStatus: () => Promise<void>
}

export const SEARCH_LIMIT = 200

/**
 * Query that scopes the search to `dir`: its full path plus a separator and a
 * trailing space, so the next word the user types becomes a separate AND term
 * ("D:\proj\ main") instead of gluing onto the path. A bare term already in
 * the box is carried over; a previous scope is replaced.
 */
export function scopedQuery(dir: string, current: string): string {
  const scope = /[/\\]$/.test(dir) ? dir : dir + (dir.includes('\\') ? '\\' : '/')
  const q = current.trim()
  if (!q || /[/\\]$/.test(q)) return `${scope} `
  // The term starts after the first "separator + space" boundary — a space
  // inside the scope path itself ("D:\my proj\ main") doesn't split it.
  const m = q.match(/[/\\]\s+/)
  const term = (m ? q.slice(m.index! + m[0].length) : q).trim()
  return term ? `${scope} ${term}` : `${scope} `
}

export const useSearch = create<SearchState>((set) => ({
  query: '',
  results: [],
  truncated: false,
  status: null,
  pendingScope: null,

  setQuery: (q) => set({ query: q }),

  // Called from the file tree on folder clicks: purely passive — the tree
  // keeps its plain expand/collapse behavior, the box just shows a hint.
  // SearchBox consumes the scope when the input gains focus.
  setPendingScope: (dir) => set({ pendingScope: dir }),

  runQuery: async (q) => {
    if (!q.trim()) {
      set({ results: [], truncated: false })
      return
    }
    try {
      const res = await invoke<{ hits: SearchHit[]; truncated: boolean }>('search_files', {
        query: q,
        limit: SEARCH_LIMIT,
      })
      // Ignore stale responses that arrive after a newer query.
      if (useSearch.getState().query === q) set({ results: res.hits, truncated: res.truncated })
    } catch {
      if (useSearch.getState().query === q) set({ results: [], truncated: false })
    }
  },

  refreshStatus: async () => {
    try {
      const status = await invoke<SearchBackendStatus>('search_status')
      set({ status })
    } catch {
      set({ status: null })
    }
  },
}))

/**
 * Tell the backend which drives the local index may walk. It rebuilds only
 * when the value actually changes, so pushing the stored setting on boot is
 * free. Typed as a plain string to keep this module off settings.ts.
 */
export function applySearchScope(mode: string) {
  void invoke('search_set_scope', { mode }).catch(() => {})
}
