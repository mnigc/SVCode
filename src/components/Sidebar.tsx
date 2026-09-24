import { useWorkspace } from '../store/workspace'
import { FileTree } from './FileTree'

export function Sidebar() {
  const root = useWorkspace((s) => s.root)
  const rootName = useWorkspace((s) => s.rootName)
  const openFolderDialog = useWorkspace((s) => s.openFolderDialog)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">{root ? rootName : '资源管理器'}</span>
        <button className="btn-icon" title="打开文件夹" onClick={() => void openFolderDialog()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="currentColor"
              d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.2c.4 0 .78.16 1.06.44l.9.9H13A1.5 1.5 0 0 1 14.5 4.24v1.26H1.5V3Zm0 3.5h13V12.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V6.5Z"
            />
          </svg>
        </button>
      </div>
      <div className="sidebar-body">
        {root ? <FileTree /> : <EmptySidebar onOpen={() => void openFolderDialog()} />}
      </div>
    </aside>
  )
}

function EmptySidebar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="sidebar-empty">
      <p>还没有打开文件夹。</p>
      <button className="btn" onClick={onOpen}>
        打开文件夹
      </button>
      <p className="hint">
        快捷键 <kbd>Ctrl</kbd>+<kbd>K</kbd>
      </p>
    </div>
  )
}
