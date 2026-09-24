import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { activeTab, useWorkspace } from '../store/workspace'

export function TitleBar() {
  const maximized = useMaximized()
  const tab = useWorkspace(activeTab)
  const win = getCurrentWindow()

  return (
    <header className="titlebar" data-tauri-drag-region="deep">
      <span className="titlebar-brand">SVCode</span>
      {tab && (
        <span className="titlebar-file">
          {tab.dirty ? '● ' : ''}
          {tab.path}
        </span>
      )}
      <span className="titlebar-spacer" />
      <div className="caption-buttons">
        <button className="caption" title="最小化" onClick={() => void win.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className="caption"
          title={maximized ? '向下还原' : '最大化'}
          onClick={() => void win.toggleMaximize()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
              <path d="M2.5 0.5h7v7" stroke="currentColor" strokeWidth="1" />
              <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button className="caption is-close" title="关闭" onClick={() => void win.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </header>
  )
}

/** The restore glyph has to follow the real window state, not our guess. */
function useMaximized() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    let alive = true
    const read = () => {
      void win.isMaximized().then((value) => {
        if (alive) setMaximized(value)
      })
    }
    read()
    const unlisten = win.onResized(read)
    return () => {
      alive = false
      void unlisten.then((stop) => stop())
    }
  }, [])

  return maximized
}
