import { useWorkspace } from '../store/workspace'

export function TabStrip() {
  const tabs = useWorkspace((s) => s.tabs)
  const activePath = useWorkspace((s) => s.activePath)
  const activate = useWorkspace((s) => s.activate)
  const closeTab = useWorkspace((s) => s.closeTab)

  if (tabs.length === 0) return <div className="tabstrip is-empty" />

  return (
    <div className="tabstrip" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.path}
          role="tab"
          aria-selected={t.path === activePath}
          className={`tab${t.path === activePath ? ' is-active' : ''}`}
          title={t.path}
          onClick={() => activate(t.path)}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              closeTab(t.path)
            }
          }}
        >
          <span className={`tab-kind kind-${t.kind}`} />
          <span className="tab-name">{t.name}</span>
          <span className={`tab-dirty${t.dirty ? ' is-on' : ''}`}>●</span>
          <button
            className="tab-close"
            title="关闭"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.path)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
