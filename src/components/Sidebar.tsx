import { useWorkspace } from '../store/workspace'
import { FileTree } from './FileTree'
import { SearchBox, SearchResults } from './SearchPanel'
import { useSearch } from '../lib/search'
import { useT } from '../lib/i18n'

export function Sidebar() {
  const t = useT()
  const selectedDir = useWorkspace((s) => s.selectedDir)
  const openInTerminal = useWorkspace((s) => s.openInTerminal)
  const query = useSearch((s) => s.query)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">{t('sidebar.explorer')}</span>
        <button
          className="btn-icon"
          title={selectedDir ? t('sidebar.terminal', { path: selectedDir }) : t('sidebar.terminalHint')}
          disabled={!selectedDir}
          onClick={() => void openInTerminal()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <rect
              x="1.5"
              y="2.5"
              width="13"
              height="11"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M4.2 6 6.6 8l-2.4 2M8.2 10.6h3.6"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <SearchBox />
      <div className="sidebar-body">{query.trim() ? <SearchResults /> : <FileTree />}</div>
    </aside>
  )
}
