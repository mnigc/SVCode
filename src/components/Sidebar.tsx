import { FileTree } from './FileTree'
import { IndexStatus, SearchBox, SearchResults } from './SearchPanel'
import { QuickAccess } from './QuickAccess'
import { useSearch } from '../lib/search'
import { useT } from '../lib/i18n'

export function Sidebar() {
  const t = useT()
  const results = useSearch((s) => s.results)
  const tab = useSearch((s) => s.tab)
  // Both panels stay mounted (only hidden) so the tree's scroll position and
  // the results list survive tab switches — see .sidebar-body CSS.
  const showSearch = tab === 'search'

  return (
    <aside className="sidebar">
      <SearchBox />
      <div className="sidebar-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={!showSearch}
          className={`sidebar-tab${!showSearch ? ' is-active' : ''}`}
          onClick={() => useSearch.setState({ tab: 'explorer' })}
        >
          {t('sidebar.explorer')}
        </button>
        <button
          role="tab"
          aria-selected={showSearch}
          className={`sidebar-tab${showSearch ? ' is-active' : ''}`}
          onClick={() => useSearch.setState({ tab: 'search' })}
        >
          {t('sidebar.searchTab')}
          <span className="sidebar-tab-count">{results.length}</span>
        </button>
      </div>
      <div className="sidebar-body">
        <div className="sidebar-pane sidebar-pane-explorer" hidden={showSearch}>
          <QuickAccess />
          <FileTree />
        </div>
        <div className="sidebar-pane" hidden={!showSearch}>
          <SearchResults />
        </div>
      </div>
      <IndexStatus />
    </aside>
  )
}
