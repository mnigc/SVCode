import { activeTab, useWorkspace } from '../store/workspace'
import { KIND_LABEL } from '../lib/paths'

export function StatusBar() {
  const tab = useWorkspace(activeTab)
  const selectedDir = useWorkspace((s) => s.selectedDir)
  const notice = useWorkspace((s) => s.notice)
  const dismissNotice = useWorkspace((s) => s.dismissNotice)
  const tabCount = useWorkspace((s) => s.tabs.length)

  return (
    <footer className="statusbar">
      <span className="status-cell" title={selectedDir ?? undefined}>
        {selectedDir ?? '此电脑'}
      </span>
      <span className="status-spacer" />
      {notice && (
        <button className="status-cell status-error" onClick={dismissNotice} title="点击忽略">
          {notice}
        </button>
      )}
      {tab && (
        <>
          <span className="status-cell">{KIND_LABEL[tab.kind]}</span>
          {tab.encoding !== 'utf-8' && <span className="status-cell">{tab.encoding}</span>}
          <span className="status-cell">
            {tab.readOnly ? '只读' : `${tab.text.length.toLocaleString()} 字符`}
          </span>
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
