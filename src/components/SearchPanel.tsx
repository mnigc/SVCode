import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { SEARCH_LIMIT, useSearch, scopedQuery } from '../lib/search'
import { basename, dirname } from '../lib/paths'
import { useT } from '../lib/i18n'
import { scrollIntoContainer } from '../lib/scrollIntoContainer'
import { DIR_ICON, fileIcon } from '../lib/fileIcons'
import { NodeIcon } from './NodeIcon'
import { NodeMenu } from './NodeMenu'

/** Input debounce — WFSearch answers in milliseconds, this only absorbs
 * keystroke storms. */
const QUERY_DEBOUNCE_MS = 150
const ROW_H = 26

/** Sidebar search box. */
export function SearchBox() {
  const t = useT()
  const query = useSearch((s) => s.query)
  const setQuery = useSearch((s) => s.setQuery)
  const runQuery = useSearch((s) => s.runQuery)
  const pendingScope = useSearch((s) => s.pendingScope)
  // Drive roots have an empty basename ("C:\") — prefer the tree node's
  // display name ("系统 (C:)"), falling back to the path itself.
  const scopeName =
    useWorkspace((s) => (pendingScope ? s.nodes[pendingScope]?.name : undefined)) ??
    (pendingScope ? basename(pendingScope) || pendingScope : '')
  const input = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onChange = (value: string) => {
    setQuery(value)
    if (timer.current) clearTimeout(timer.current)
    if (!value.trim()) {
      useSearch.setState({ results: [], truncated: false, tab: 'explorer' })
      return
    }
    timer.current = setTimeout(() => void runQuery(value), QUERY_DEBOUNCE_MS)
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

/** Flat results list, replacing the tree while a query is active. */
export function SearchResults() {
  const t = useT()
  const results = useSearch((s) => s.results)
  const truncated = useSearch((s) => s.truncated)
  const query = useSearch((s) => s.query)
  const openFile = useWorkspace((s) => s.openFile)
  const revealPath = useWorkspace((s) => s.revealPath)
  const [selected, setSelected] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; isDir: boolean } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSelected(0), [results])

  useEffect(() => {
    if (!menu) return
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.ctx-menu')) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

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
        query={query.trim()}
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
      {results.length === 0 && (
        <div className="tree-note search-empty">
          {query.trim() ? t('search.noMatches') : t('search.typeToSearch')}
        </div>
      )}
      {truncated && (
        <div className="search-status">{t('search.truncated', { n: SEARCH_LIMIT })}</div>
      )}
    </div>
  )
}

/** Fixed-height windowed list: only rows in view (± overscan) are mounted. */
function ListWindow({
  results,
  selected,
  onSelect,
  onActivate,
  query,
  onContextMenu,
}: {
  results: { path: string; name: string; isDir: boolean }[]
  selected: number
  onSelect: (i: number) => void
  onActivate: (hit: { path: string; name: string; isDir: boolean }) => void
  query: string
  onContextMenu: (hit: { path: string; name: string; isDir: boolean }, i: number, e: React.MouseEvent) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 60 })
  const OVERSCAN = 12

  const recompute = useMemo(
    () => () => {
      const el = scroller.current
      if (!el) return
      const start = Math.max(0, Math.floor(el.scrollTop / ROW_H) - OVERSCAN)
      const visible = Math.ceil(el.clientHeight / ROW_H) + OVERSCAN * 2
      setRange({ start, end: start + visible })
    },
    [],
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
      <div style={{ height: results.length * ROW_H, position: 'relative' }}>
        {results.slice(range.start, range.end).map((hit, k) => {
          const i = range.start + k
          return (
            <div
              key={hit.path}
              role="option"
              aria-selected={i === selected}
              className={`search-row${i === selected ? ' is-selected' : ''}`}
              style={{ top: i * ROW_H, height: ROW_H }}
              title={hit.path}
              onClick={() => {
                onSelect(i)
                onActivate(hit)
              }}
              onContextMenu={(e) => onContextMenu(hit, i, e)}
              onMouseEnter={() => onSelect(i)}
            >
              <NodeIcon spec={hit.isDir ? DIR_ICON : fileIcon(hit.path)} />
              <span className="search-name">{highlight(hit.name, query)}</span>
              <span className="search-dir">{dirname(hit.path)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function highlight(name: string, query: string) {
  const idx = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (idx < 0) return name
  return (
    <>
      {name.slice(0, idx)}
      <mark>{name.slice(idx, idx + query.length)}</mark>
      {name.slice(idx + query.length)}
    </>
  )
}
