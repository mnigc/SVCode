import { activeTab, useWorkspace } from '../store/workspace'
import { KIND_LABEL } from '../lib/paths'

export function StatusBar() {
  const tab = useWorkspace(activeTab)
  const root = useWorkspace((s) => s.root)
  const tabCount = useWorkspace((s) => s.tabs.length)

  return (
    <footer className="statusbar">
      <span className="status-cell" title={root ?? undefined}>
        {root ?? '未打开文件夹'}
      </span>
      <span className="status-spacer" />
      {tab && (
        <>
          <span className="status-cell">{KIND_LABEL[tab.kind]}</span>
          <span className="status-cell">{tab.readOnly ? '只读' : `${tab.text.length.toLocaleString()} 字符`}</span>
          <span className="status-cell">{lineCount(tab.text)}</span>
        </>
      )}
      <span className="status-cell">{tabCount} 个标签</span>
    </footer>
  )
}

function lineCount(text: string) {
  if (!text) return '1 行'
  return `${text.split('\n').length.toLocaleString()} 行`
}
