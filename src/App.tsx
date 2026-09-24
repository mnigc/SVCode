import { useEffect } from 'react'
import { useWorkspace } from './store/workspace'
import { Sidebar } from './components/Sidebar'
import { TabStrip } from './components/TabStrip'
import { EditorPane } from './components/EditorPane'
import { PreviewPane } from './components/PreviewPane'
import { StatusBar } from './components/StatusBar'
import { Splitter } from './components/Splitter'

export default function App() {
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen)
  const previewOpen = useWorkspace((s) => s.previewOpen)
  const sidebarWidth = useWorkspace((s) => s.sidebarWidth)
  const previewWidth = useWorkspace((s) => s.previewWidth)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const s = useWorkspace.getState()
      const key = e.key.toLowerCase()

      if (key === 'k') {
        e.preventDefault()
        void s.openFolderDialog()
      } else if (key === 's') {
        e.preventDefault()
        void s.saveActive()
      } else if (key === 'w') {
        e.preventDefault()
        if (s.activePath) s.closeTab(s.activePath)
      } else if (key === 'b') {
        e.preventDefault()
        s.toggleSidebar()
      } else if (key === 'v' && e.shiftKey) {
        e.preventDefault()
        s.togglePreview()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <div className="panes">
        {sidebarOpen && (
          <>
            <div className="pane-sidebar" style={{ width: sidebarWidth }}>
              <Sidebar />
            </div>
            <Splitter side="left" width={sidebarWidth} onWidth={useWorkspace.getState().setSidebarWidth} />
          </>
        )}

        <section className="pane-editor">
          <TabStrip />
          <EditorPane />
        </section>

        {previewOpen && (
          <>
            <Splitter side="right" width={previewWidth} onWidth={useWorkspace.getState().setPreviewWidth} />
            <div className="pane-preview" style={{ width: previewWidth }}>
              <PreviewPane />
            </div>
          </>
        )}
      </div>
      <StatusBar />
    </div>
  )
}
