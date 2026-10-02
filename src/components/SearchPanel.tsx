import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { SEARCH_LIMIT, useSearch, scopedQuery, contentTermsOf } from '../lib/search'
import type { SearchHit } from '../lib/search'
import { basename, dirname } from '../lib/paths'
import { useT } from '../lib/i18n'
import { scrollIntoContainer } from '../lib/scrollIntoContainer'
import { isModalOpen } from '../lib/isModalOpen'
import { useDismiss } from '../lib/useDismiss'
import { DIR_ICON, fileIcon } from '../lib/fileIcons'
import { NodeIcon } from './NodeIcon'
import { NodeMenu } from './NodeMenu'

/** Input debounce — WFSearch answers in milliseconds, this only absorbs
 * keystroke storms. */
const QUERY_DEBOUNCE_MS = 150
/** Content scans read real files engine-side — they wait for a longer pause
 * than the name search before firing, but they DO fire without the user
 * visiting the 文档内容 tab, so its count stays live. */
const CONTENT_DEBOUNCE_MS = 600
const ROW_H = 26
/** Content hits render two lines: the file row plus the snippet. */
const SNIPPET_ROW_H = 42

/** Sidebar search box. */
export function SearchBox() {
  const t = useT()
  const query = useSearch((s) => s.query)
  const setQuery = useSearch((s) => s.setQuery)
  const runQuery = useSearch((s) => s.runQuery)
  const runContentQuery = useSearch((s) => s.runContentQuery)
  const pendingScope = useSearch((s) => s.pendingScope)
  // Drive roots have an empty basename ("C:\") — prefer the tree node's
  // display name ("系统 (C:)"), falling back to the path itself.
  const scopeName =
    useWorkspace((s) => (pendingScope ? s.nodes[pendingScope]?.name : undefined)) ??
    (pendingScope ? basename(pendingScope) || pendingScope : '')
  const input = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        // Another handler (CM keymap, dialogs) already claimed it; and while
        // a modal dialog is open the focus must stay there.
        if (e.defaultPrevented || isModalOpen()) return
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    // Unmount clears pending debounces — a timer firing after the box is gone
    // would run a query against stale state for nothing.
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer.current) clearTimeout(timer.current)
      if (contentTimer.current) clearTimeout(contentTimer.current)
    }
  }, [])

  const onChange = (value: string) => {
    setQuery(value)
    if (timer.current) clearTimeout(timer.current)
    if (contentTimer.current) clearTimeout(contentTimer.current)
    if (!value.trim()) {
      // runQuery('') is the single clear path: both result sets go, tab
      // returns to the tree.
      void runQuery('')
      return
    }
    timer.current = setTimeout(() => void runQuery(value), QUERY_DEBOUNCE_MS)
    // The content tab's count stays live without a visit: scan on settle,
    // but only when the query actually carries a word to search for.
    if (contentTermsOf(value).length > 0) {
      contentTimer.current = setTimeout(
        () => void runContentQuery(value.trim()),
        CONTENT_DEBOUNCE_MS,
      )
    }
  }

  return (
    <div className="search-panel">
      <div className="search-box">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
          <path d="m10.6 10.6 3.4 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          value={query}
          placeholder={
            pendingScope ? t('search.placeholderScope', { name: scopeName }) : t('search.placeholder')
          }
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            // A folder click only arms the scope (placeholder hint); the
            // search actually starts when the input gains focus.
            const scope = useSearch.getState().pendingScope
            let caret = input.current?.value.length ?? 0
            if (scope) {
              useSearch.setState({ pendingScope: null })
              const q = scopedQuery(scope, useSearch.getState().query)
              setQuery(q)
              caret = q.length
              if (timer.current) clearTimeout(timer.current)
              void runQuery(q)
            }
            // Click-to-position would win over focus, so park the caret at
            // the end one tick later — edits/backspaces start from the tail.
            setTimeout(() => {
              const el = input.current
              if (el) el.setSelectionRange(caret, caret)
            }, 0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Escape just parks the results behind the tree — the × button
              // (or Ctrl+A, Delete) is the way to actually clear the query.
              useSearch.setState({ tab: 'explorer' })
              input.current?.blur()
            }
          }}
        />
        {query && (
          <button className="btn-icon search-clear" title={t('search.clear')} onClick={() => onChange('')}>
            ×
          </button>
        )}
      </div>
    </div>
  )
}

/** Engine/index readout, parked at the bottom of the sidebar. */
export function IndexStatus() {
  const t = useT()
  const status = useSearch((s) => s.status)
  const refreshStatus = useSearch((s) => s.refreshStatus)

  // One probe at boot, then poll only until the engine is ready — the
  // backend starts its sidecar on the first probe/status call, and the MFT
  // index takes a few seconds to land.
  useEffect(() => {
    void refreshStatus()
    const poll = setInterval(() => {
      const st = useSearch.getState().status
      if (!st || !st.ready) void refreshStatus()
    }, 2000)
    return () => clearInterval(poll)
  }, [refreshStatus])

  if (!status) return null
  return (
    <div
      className="sidebar-foot"
      title={status.ready || status.building ? t('search.viaWfs') : t('search.notReadyHint')}
    >
      {status.ready
        ? t('search.indexed', { n: status.files.toLocaleString() })
        : status.building
          ? t('search.indexing', { n: status.files.toLocaleString() })
          : t('search.notReady')}
    </div>
  )
}

/** Flat results list for one sidebar tab: 'name' shows file-name hits,
 * 'content' shows document-content hits with their snippet lines. */
export function SearchResults({ mode }: { mode: 'name' | 'content' }) {
  const t = useT()
  const isContent = mode === 'content'
  const results = useSearch((s) => (isContent ? s.contentResults : s.results))
  const truncated = useSearch((s) => (isContent ? s.contentTruncated : s.truncated))
  const scanInfo = useSearch((s) => (isContent ? s.scanInfo : null))
  const running = useSearch((s) => (isContent ? s.contentRunning : false))
  const contentError = useSearch((s) => (isContent ? s.contentError : null))
  const query = useSearch((s) => s.query)
  const openFile = useWorkspace((s) => s.openFile)
  const revealPath = useWorkspace((s) => s.revealPath)
  const [selected, setSelected] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; isDir: boolean } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // The needles are derived once per query: word tokens highlight the
  // snippet, the rest (wildcards stripped) highlight the file name.
  const { nameTerms, contentTerms } = useMemo(() => queryNeedles(query.trim()), [query])
  // Fixed height per mode: content rows are always two lines tall, so hits
  // without a snippet keep the same geometry as their neighbors (mixed
  // result sets used to shift every row when the first snippet appeared).
  const rowH = isContent ? SNIPPET_ROW_H : ROW_H

  useEffect(() => setSelected(0), [results])

  useDismiss(!!menu, () => setMenu(null), '.ctx-menu')

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const row = list.querySelector('.search-row.is-selected')
    if (row) scrollIntoContainer(row, list)
  }, [selected])

  const activate = (hit: (typeof results)[number]) => {
    if (hit.isDir) {
      void revealPath(hit.path)
    } else {
      void openFile(hit.path)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(results.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[selected]
      if (hit) activate(hit)
    }
  }

  return (
    <div
      className="search-results"
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="listbox"
      ref={listRef}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ListWindow
        results={results}
        selected={selected}
        onSelect={setSelected}
        onActivate={activate}
        nameTerms={nameTerms}
        contentTerms={contentTerms}
        rowH={rowH}
        onContextMenu={(hit, i, e) => {
          e.preventDefault()
          e.stopPropagation()
          setSelected(i)
          setMenu({ x: e.clientX, y: e.clientY, path: hit.path, isDir: hit.isDir })
        }}
      />
      {menu && (
        <NodeMenu
          path={menu.path}
          x={menu.x}
          y={menu.y}
          hint={{ isDir: menu.isDir }}
          variant="search"
          onClose={() => setMenu(null)}
        />
      )}
      {results.length === 0 &&
        (() => {
          const note = isContent
            ? contentError
              ? contentError
              : running
              ? t('search.contentScanning')
              : contentTermsOf(query.trim()).length
                ? t('search.noMatches')
                : t('search.contentNoTerm')
            : query.trim()
              ? t('search.noMatches')
              : t('search.typeToSearch')
          return (
            <div className="tree-note search-empty" title={note}>
              {note}
            </div>
          )
        })()}
      {scanInfo?.truncated && (
        <div className="search-status" title={t('search.contentTruncated')}>
          {t('search.contentTruncated')}
        </div>
      )}
      {scanInfo?.timedOut && (
        <div className="search-status" title={t('search.contentTimedOut')}>
          {t('search.contentTimedOut')}
        </div>
      )}
      {truncated && (
        <div className="search-status" title={t('search.truncated', { n: SEARCH_LIMIT })}>
          {t('search.truncated', { n: SEARCH_LIMIT })}
        </div>
      )}
    </div>
  )
}

/** Fixed-height windowed list: only rows in view (± overscan) are mounted.
 * All rows share one height per result set — name rows are single-line,
 * content rows carry a snippet line. */
function ListWindow({
  results,
  selected,
  onSelect,
  onActivate,
  nameTerms,
  contentTerms,
  rowH,
  onContextMenu,
}: {
  results: SearchHit[]
  selected: number
  onSelect: (i: number) => void
  onActivate: (hit: SearchHit) => void
  nameTerms: string[]
  contentTerms: string[]
  rowH: number
  onContextMenu: (hit: SearchHit, i: number, e: React.MouseEvent) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 60 })
  const OVERSCAN = 12

  const recompute = useMemo(
    () => () => {
      const el = scroller.current
      if (!el) return
      const start = Math.max(0, Math.floor(el.scrollTop / rowH) - OVERSCAN)
      const visible = Math.ceil(el.clientHeight / rowH) + OVERSCAN * 2
      setRange({ start, end: start + visible })
    },
    [rowH],
  )

  useEffect(() => {
    recompute()
  }, [results.length, recompute])

  // The list can sit display:none on its tab; coming back fires no scroll
  // event, so recompute the window from the (restored) scrollTop when the
  // scroller's box changes size — hidden (0) to shown covers tab switches.
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(el)
    return () => ro.disconnect()
  }, [recompute])

  return (
    <div ref={scroller} className="search-window" onScroll={recompute}>
      <div style={{ height: results.length * rowH, position: 'relative' }}>
        {results.slice(range.start, range.end).map((hit, k) => {
          const i = range.start + k
          return (
            <div
              key={hit.path}
              role="option"
              aria-selected={i === selected}
              className={`search-row${i === selected ? ' is-selected' : ''}${hit.snippet ? ' has-snip' : ''}`}
              style={{ top: i * rowH, height: rowH }}
              title={hit.path}
              onClick={() => {
                onSelect(i)
                onActivate(hit)
              }}
              onContextMenu={(e) => onContextMenu(hit, i, e)}
              onMouseEnter={() => onSelect(i)}
            >
              <div className="search-main">
                <NodeIcon spec={hit.isDir ? DIR_ICON : fileIcon(hit.path)} />
                <span className="search-name">{markHits(hit.name, nameTerms)}</span>
                <span className="search-dir">{dirname(hit.path)}</span>
              </div>
              {hit.snippet && (
                <div className="search-snip">
                  <span className="snip-text">{markHits(hit.snippet, contentTerms)}</span>
                  {(hit.contentMatches ?? 0) > 1 && (
                    <span className="snip-hits">×{hit.contentMatches}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Splits a query for highlighting: every token (wildcards stripped) is a
 * file-name needle, and the word tokens — the ones the backend turns into
 * `content:` terms — also highlight the snippet. */
function queryNeedles(query: string): { nameTerms: string[]; contentTerms: string[] } {
  const nameTerms = query
    .split(/\s+/)
    .map((t) => t.replace(/[*?]/g, ''))
    .filter(Boolean)
  return { nameTerms, contentTerms: contentTermsOf(query) }
}

/** Case-insensitive occurrences of every needle, merged into non-overlapping
 * ranges ordered by position. */
function matchRanges(text: string, needles: string[]): [number, number][] {
  if (!needles.length) return []
  const lower = text.toLowerCase()
  const ranges: [number, number][] = []
  for (const n of needles) {
    const l = n.toLowerCase()
    if (!l) continue
    let i = lower.indexOf(l)
    while (i !== -1) {
      ranges.push([i, i + l.length])
      i = lower.indexOf(l, i + l.length)
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push(r)
  }
  return merged
}

/** Text with every needle occurrence wrapped in <mark>; plain text when
 * nothing matches (e.g. a path-scope term against a file name). */
function markHits(text: string, needles: string[]): React.ReactNode {
  const ranges = matchRanges(text, needles)
  if (!ranges.length) return text
  const out: React.ReactNode[] = []
  let pos = 0
  for (const [s, e] of ranges) {
    if (s > pos) out.push(text.slice(pos, s))
    out.push(<mark key={s}>{text.slice(s, e)}</mark>)
    pos = e
  }
  if (pos < text.length) out.push(text.slice(pos))
  return out
}
