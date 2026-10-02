import { useState } from 'react'
import { FileTree } from './FileTree'
import { IndexStatus, SearchBox, SearchResults } from './SearchPanel'
import { QuickAccess } from './QuickAccess'
import { reloadApp } from './TitleBar'
import { useSearch } from '../lib/search'
import { useT } from '../lib/i18n'
import { useDismiss } from '../lib/useDismiss'

export function Sidebar() {
  const t = useT()
  const results = useSearch((s) => s.results)
  const contentResults = useSearch((s) => s.contentResults)
  const tab = useSearch((s) => s.tab)
  // All three panes stay mounted (only hidden) so the tree's scroll position
  // and both result lists survive tab switches — see .sidebar-body CSS.
  const showExplorer = tab === 'explorer'
  const showName = tab === 'name'
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null)
  useDismiss(!!blankMenu, () => setBlankMenu(null), '.ctx-menu')

  // The content tab click is a fallback trigger (the scan normally fires
  // from SearchBox's debounce); it never rescans a settled query.
  const openContentTab = () => {
    useSearch.setState({ tab: 'content' })
    const q = useSearch.getState().query.trim()
    if (q) void useSearch.getState().runContentQuery(q)
  }

  // Blank-space context menu closes on any outside pointerdown or Escape.

  return (
    <aside
      className="sidebar"
      onContextMenu={(e) => {
        // Rows (tree, quick access, results) open their own menus and stop
        // propagation; inputs are typing surfaces and an open menu is its own
        // context. Everything else is blank space — offer the app-level
        // refresh (same whole-program reload as F5), wherever it sits.
        const target = e.target
        if (!(target instanceof Element)) return
        if (target.closest('.ctx-menu, input, textarea')) return
        e.preventDefault()
        setBlankMenu({
          x: Math.min(e.clientX, window.innerWidth - 190),
          y: Math.min(e.clientY, window.innerHeight - 60),
        })
      }}
    >
      <SearchBox />
      <div className="sidebar-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={showExplorer}
          className={`sidebar-tab${showExplorer ? ' is-active' : ''}`}
          onClick={() => useSearch.setState({ tab: 'explorer' })}
        >
          {t('sidebar.explorer')}
        </button>
        <button
          role="tab"
          aria-selected={showName}
          className={`sidebar-tab${showName ? ' is-active' : ''}`}
          onClick={() => useSearch.setState({ tab: 'name' })}
        >
          {t('sidebar.nameTab')}
          <span className="sidebar-tab-count">{results.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'content'}
          className={`sidebar-tab${tab === 'content' ? ' is-active' : ''}`}
          onClick={openContentTab}
        >
          {t('sidebar.contentTab')}
          <span className="sidebar-tab-count">{contentResults.length}</span>
        </button>
      </div>
      <div className="sidebar-body">
        <div className="sidebar-pane sidebar-pane-explorer" hidden={!showExplorer}>
          <QuickAccess />
          <FileTree />
        </div>
        <div className="sidebar-pane" hidden={!showName}>
          <SearchResults mode="name" />
        </div>
        <div className="sidebar-pane" hidden={tab !== 'content'}>
          <SearchResults mode="content" />
        </div>
      </div>
      <IndexStatus />
      {blankMenu && (
        <div
          className="ctx-menu menu-panel"
          role="menu"
          style={{ left: blankMenu.x, top: blankMenu.y }}
        >
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setBlankMenu(null)
              reloadApp()
            }}
          >
            <span className="menu-label">{t('menu.refresh')}</span>
            <span className="menu-hint">F5</span>
          </button>
        </div>
      )}
    </aside>
  )
}
