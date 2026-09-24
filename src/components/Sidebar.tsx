import { useWorkspace } from '../store/workspace'
import { FileTree } from './FileTree'

export function Sidebar() {
  const selectedDir = useWorkspace((s) => s.selectedDir)
  const openInTerminal = useWorkspace((s) => s.openInTerminal)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">资源管理器</span>
        <button
          className="btn-icon"
          title={selectedDir ? `在终端中打开 ${selectedDir}` : '先在左侧选中一个文件夹'}
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
      <div className="sidebar-body">
        <FileTree />
      </div>
    </aside>
  )
}
