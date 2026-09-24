import { activeTab, useWorkspace } from '../store/workspace'
import { KIND_LABEL } from '../lib/paths'

export function EditorPane() {
  const tab = useWorkspace(activeTab)
  const editActive = useWorkspace((s) => s.editActive)

  if (!tab) {
    return (
      <div className="welcome">
        <h1>SVCode</h1>
        <p className="welcome-sub">轻量文本 / 代码编辑器，内置 md、图片、PDF 预览</p>
        <p className="welcome-sub">从左侧「此电脑」里挑一个文件开始。</p>
        <ul className="welcome-keys">
          <li>
            <kbd>Ctrl</kbd>
            <kbd>W</kbd> <span>关闭当前标签</span>
          </li>
          <li>
            <kbd>Ctrl</kbd>
            <kbd>S</kbd> <span>保存</span>
          </li>
          <li>
            <kbd>Ctrl</kbd>
            <kbd>B</kbd> <span>切换侧栏</span>
          </li>
          <li>
            <kbd>Ctrl</kbd>
            <kbd>Shift</kbd>
            <kbd>V</kbd> <span>切换预览</span>
          </li>
        </ul>
      </div>
    )
  }

  if (tab.kind === 'image' || tab.kind === 'pdf') {
    return (
      <div className="pane-placeholder">
        <p>
          <code>{tab.name}</code> 是 {KIND_LABEL[tab.kind]}，预览能力在 M3 接入。
        </p>
      </div>
    )
  }

  if (tab.loading) return <div className="pane-placeholder">读取中…</div>
  if (tab.error) return <div className="pane-error">{tab.error}</div>

  return (
    <div className="editor-m0">
      {tab.readOnly && <div className="banner">文件超过 5MB，已按只读打开。</div>}
      <textarea
        className="editor-m0-area"
        value={tab.text}
        readOnly={tab.readOnly}
        spellCheck={false}
        onChange={(e) => editActive(e.target.value)}
      />
    </div>
  )
}
