import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { tBackend } from './i18n'

export interface SearchHit {
  path: string
  name: string
  isDir: boolean
  /** Text around the first content hit — only on content searches. */
  snippet: string | null
  /** Total hits in the file across all content terms — only on content searches. */
  contentMatches: number | null
}

/** Engine bookkeeping for a content search's scan phase. */
export interface ScanInfo {
  scanned: number
  /** The candidate window ran out — results may be incomplete. */
  truncated: boolean
  /** The engine's scan budget ran out — results are partial. */
  timedOut: boolean
}

/** Shape of a search_files reply — `error` arrives (zh) when the backend
 * could not run the search at all (e.g. full-text scan unavailable). */
interface SearchReply {
  hits: SearchHit[]
  truncated: boolean
  content?: ScanInfo | null
  error?: string
}

export interface SearchBackendStatus {
  /** Engine answering and at least one drive fully indexed. */
  ready: boolean
  /** Engine answering but still building its index. */
  building: boolean
  files: number
  /** 'wfs' = the bundled WFSearch engine. */
  source: 'wfs'
}

/** Which sidebar pane is shown. Content results auto-refresh when the query
 * settles (longer debounce than the name search — the scan reads real files
 * engine-side), so the 文档内容 tab's count is live without a click. */
export type SearchTab = 'explorer' | 'name' | 'content'

/** Word tokens that the backend turns into `content:` terms — mirroring
 * `content_query` in search.rs: plain words qualify, and a path-like token
 * donates its trailing segment (`D:\测` → 测) while pure scopes (`D:\`,
 * `src\`), drive filters and wildcard tails do not. */
export function contentTermsOf(query: string): string[] {
  const terms: string[] = []
  for (const w of query.split(/\s+/)) {
    if (!w) continue
    if (
      !w.includes('*') &&
      !w.includes('?') &&
      !w.includes('\\') &&
      !w.includes('/') &&
      !(w.length === 2 && w[1] === ':')
    ) {
      terms.push(w)
      continue
    }
    const sep = Math.max(w.lastIndexOf('\\'), w.lastIndexOf('/'))
    if (sep >= 0 && sep < w.length - 1) {
      const tail = w.slice(sep + 1)
      if (tail && !tail.includes('*') && !tail.includes('?')) terms.push(tail)
    }
  }
  return terms
}

interface SearchState {
  query: string
  /** File-name search results. */
  results: SearchHit[]
  /** null = fewer than LIMIT hits; anything over the cap isn't fetched. */
  truncated: boolean
  /** Document-content search results, plus the query they belong to. */
  contentResults: SearchHit[]
  contentTruncated: boolean
  scanInfo: ScanInfo | null
  /** Backend-reported failure of the last content scan (already localized);
   * null = the results (if any) are a clean answer. */
  contentError: string | null
  /** The query the current content results are for; also the in-flight marker. */
  contentQuery: string | null
  contentRunning: boolean
  status: SearchBackendStatus | null
  /** Which sidebar panel is shown while a query has results; the tree and
   * the results lists both stay mounted, so reveals/定位 never clear it. */
  tab: SearchTab
  /** Folder clicked in the tree, offered as a search scope. Consumed when
   * the search input gains focus — until then nothing runs. */
  pendingScope: string | null

  setQuery: (q: string) => void
  setPendingScope: (dir: string) => void
  runQuery: (q: string) => Promise<void>
  runContentQuery: (q: string) => Promise<void>
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
  contentResults: [],
  contentTruncated: false,
  scanInfo: null,
  contentError: null,
  contentQuery: null,
  contentRunning: false,
  status: null,
  tab: 'explorer',
  pendingScope: null,

  // Any query change (typing or clearing) stales the content results — they
  // belong to the old query and must never read as current ones. Switching
  // tabs doesn't touch the query, so the settled-query cache still works.
  // `contentRunning` flips on when the new query carries a word to scan for,
  // so the pane reads "scanning" during the debounce gap; a scope-only query
  // has nothing to scan and must not park the flag on.
  setQuery: (q) =>
    set((s) => {
      if (q.trim() === s.query.trim()) return { query: q }
      return {
        query: q,
        contentResults: [],
        contentTruncated: false,
        scanInfo: null,
        contentError: null,
        contentQuery: null,
        contentRunning: contentTermsOf(q).length > 0,
      }
    }),

  // Called from the file tree on folder clicks: purely passive — the tree
  // keeps its plain expand/collapse behavior, the box just shows a hint.
  // SearchBox consumes the scope when the input gains focus.
  setPendingScope: (dir) => set({ pendingScope: dir }),

  runQuery: async (q) => {
    if (!q.trim()) {
      set({
        results: [],
        truncated: false,
        contentResults: [],
        contentTruncated: false,
        scanInfo: null,
        contentError: null,
        contentQuery: null,
        contentRunning: false,
        tab: 'explorer',
      })
      return
    }
    try {
      const res = await invoke<SearchReply>('search_files', {
        query: q,
        limit: SEARCH_LIMIT,
        mode: 'name',
      })
      // Ignore stale responses that arrive after a newer query.
      if (useSearch.getState().query === q) {
        if (res.error) {
          set({ results: [], truncated: false })
          return
        }
        // Auto-switch to the name results only while the view is still "in
        // the search": already on the name tab, or a fresh search that never
        // showed results. A user who deliberately navigated away — the
        // content tab, or parking the results behind the tree (Escape with
        // results showing) — must not be yanked back by a late response.
        const st = useSearch.getState()
        const parked = st.tab === 'content' || (st.tab === 'explorer' && st.results.length > 0)
        set({ results: res.hits, truncated: res.truncated, tab: parked ? st.tab : 'name' })
      }
    } catch {
      if (useSearch.getState().query === q) set({ results: [], truncated: false })
    }
  },

  // Runs on query settle (SearchBox debounce) and on an explicit 文档内容 tab
  // click; `contentQuery` doubles as the in-flight marker, so a re-trigger
  // with the same query never rescans and a newer one stales the older
  // in-flight response. A query with no word tokens (bare scope) has nothing
  // to scan — treated like empty.
  runContentQuery: async (q) => {
    if (!q.trim() || contentTermsOf(q).length === 0) {
      set({
        contentResults: [],
        contentTruncated: false,
        scanInfo: null,
        contentError: null,
        contentQuery: null,
        contentRunning: false,
      })
      return
    }
    if (useSearch.getState().contentQuery === q) return
    set({ contentQuery: q, contentRunning: true, contentError: null })
    try {
      const res = await invoke<SearchReply>('search_files', {
        query: q,
        limit: SEARCH_LIMIT,
        mode: 'content',
      })
      if (useSearch.getState().contentQuery !== q) return
      if (res.error) {
        // A backend-reported failure (zh reason, e.g. full-text scan
        // unavailable) is NOT a settled answer: keep the results empty and
        // release contentQuery so the same query can be re-run (tab click)
        // once the cause is gone.
        set({
          contentResults: [],
          contentTruncated: false,
          scanInfo: null,
          contentError: tBackend(res.error),
          contentQuery: null,
          contentRunning: false,
        })
        return
      }
      set({
        contentResults: res.hits,
        contentTruncated: res.truncated,
        scanInfo: res.content ?? null,
        contentError: null,
        contentRunning: false,
      })
    } catch (err) {
      if (useSearch.getState().contentQuery !== q) return
      // Same as a backend error: contentQuery is released, so re-triggering
      // the same word rescans instead of early-returning on the cached query.
      set({
        contentResults: [],
        contentTruncated: false,
        scanInfo: null,
        contentError: tBackend(String(err)),
        contentQuery: null,
        contentRunning: false,
      })
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
