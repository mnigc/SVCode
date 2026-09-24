import { activeTab, useWorkspace } from '../store/workspace'
import { KIND_LABEL } from '../lib/paths'

export function PreviewPane() {
  const tab = useWorkspace(activeTab)
  const togglePreview = useWorkspace((s) => s.togglePreview)

  return (
    <aside className="preview">
      <div className="preview-head">
        <span>预览</span>
        <button className="btn-icon" title="关闭预览 (Ctrl+Shift+V)" onClick={togglePreview}>
          ×
        </button>
      </div>
      <div className="preview-body">
        {!tab ? (
          <p className="preview-hint">打开一个文件后这里会显示预览。</p>
        ) : tab.kind === 'markdown' ? (
          <p className="preview-hint">Markdown 渲染在 M2 接入，当前显示原文。</p>
        ) : tab.kind === 'image' || tab.kind === 'pdf' ? (
          <p className="preview-hint">
            {KIND_LABEL[tab.kind]} 预览在 M3 接入。
          </p>
        ) : (
          <p className="preview-hint">
            <code>{KIND_LABEL[tab.kind]}</code> 没有预览形态。
          </p>
        )}
      </div>
    </aside>
  )
}
