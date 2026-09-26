import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { SEARCH_LIMIT, useSearch, scopedQuery } from '../lib/search'
import { basename, dirname } from '../lib/paths'
import { useT } from '../lib/i18n'
import { useSettings } from '../lib/settings'
import { scrollIntoContainer } from '../lib/scrollIntoContainer'
import { DIR_ICON, fileIcon } from '../lib/fileIcons'
import { NodeIcon } from './NodeIcon'

/** Input debounce — Everything-tier queries are instant anyway, this keeps
 * local-index keystroke storms cheap. */
const QUERY_DEBOUNCE_MS = 150
const ROW_H = 26

/** Sidebar search box: input + backend status line. */
export function SearchBox() {
  const t = useT()
  const query = useSearch((s) => s.query)
  const setQuery = useSearch((s) => s.setQuery)
  const runQuery = useSearch((s) => s.runQuery)
  const status = useSearch((s) => s.status)
  const pendingScope = useSearch((s) => s.pendingScope)
  const refreshStatus = useSearch((s) => s.refreshStatus)
  const searchScope = useSettings((s) => s.searchScope)
  // Drive roots have an empty basename ("C:\") — prefer the tree node's
  // display name ("系统 (C:)"), falling back to the path itself.
  const scopeName =
    useWorkspace((s) => (pendingScope ? s.nodes[pendingScope]?.name : undefined)) ??
    (pendingScope ? basename(pendingScope) || pendingScope : '')
  const input = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // One probe to learn the tier, then poll only while a local build is really
  // running: the index now starts on the first query, so an idle session must
  // not keep asking the backend.
  useEffect(() => {
    void refreshStatus()
    const poll = setInterval(() => {
      const st = useSearch.getState().status
      if (st && st.source === 'local' && st.started && !st.ready) void refreshStatus()
    }, 2000)
    return () => clearInterval(poll)
  }, [refreshStatus])

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
      useSearch.setState({ results: [], truncated: false })
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
              onChange('')
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
      {searchScope === 'off' && status?.source !== 'everything' ? (
        // Scope off silences the local tier entirely — say so instead of
        // letting queries return silent empty results. Everything, when it is
        // running, answers regardless of the scope, hence the exception.
        <div className="search-status" title={t('search.scopeOffHint')}>
          {t('search.scopeOff')}
        </div>
      ) : (
        status &&
        !query.trim() &&
        (status.source === 'everything' || status.started) && (
          <div
            className="search-status"
            title={status.source === 'everything' ? t('search.viaEverything') : t('search.viaLocal')}
          >
            {status.source === 'everything'
              ? t('search.everythingReady')
              : status.ready
                ? t('search.indexed', { n: status.files.toLocaleString() })
                : t('search.indexing', { n: status.files.toLocaleString() })}
          </div>
        )
      )}
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
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSelected(0), [results])

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
    <div className="search-results" tabIndex={0} onKeyDown={onKeyDown} role="listbox" ref={listRef}>
      <ListWindow
        results={results}
        selected={selected}
        onSelect={setSelected}
        onActivate={activate}
        query={query.trim()}
      />
      {results.length === 0 && <div className="tree-note search-empty">{t('search.noMatches')}</div>}
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
}: {
  results: { path: string; name: string; isDir: boolean }[]
  selected: number
  onSelect: (i: number) => void
  onActivate: (hit: { path: string; name: string; isDir: boolean }) => void
  query: string
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
