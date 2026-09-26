import { Fragment, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspace, activePathOf, flatGroups, hasPreview } from './store/workspace'
import { useQuickAccess } from './store/quickAccess'
import { Sidebar } from './components/Sidebar'
import { TabStrip } from './components/TabStrip'
import { EditorPane } from './components/EditorPane'
import { PreviewPane } from './components/PreviewPane'
import { StatusBar, GroupStatusBar } from './components/StatusBar'
import { Splitter } from './components/Splitter'
import { TitleBar } from './components/TitleBar'
import { CollapsiblePane } from './components/CollapsiblePane'
import { useSettings } from './lib/settings'
import { restoreSession, scheduleSessionSave } from './lib/session'
import { checkOnStartup } from './lib/update'

export default function App() {
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen)
  const sidebarWidth = useWorkspace((s) => s.sidebarWidth)
  const rows = useWorkspace((s) => s.rows)
  const rowRatios = useWorkspace((s) => s.rowRatios)
  const groupRatios = useWorkspace((s) => s.groupRatios)
  const activeGroup = useWorkspace((s) => s.activeGroup)

  // The group/row splitters convert a px drag into a flex-grow delta, which
  // needs the editor area's own size — measured like the preview panes below.
  const groupsRef = useRef<HTMLDivElement>(null)
  const [groupsW, setGroupsW] = useState(0)
  const [groupsH, setGroupsH] = useState(0)
  useEffect(() => {
    const el = groupsRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setGroupsW(el.clientWidth)
      setGroupsH(el.clientHeight)
    })
    ro.observe(el)
    setGroupsW(el.clientWidth)
    setGroupsH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    void useSettings.getState().load().then(() => useWorkspace.getState().loadSystemTree())
    void restoreSession().catch((e) => console.error('[svcode] session restore failed:', e))
    void useQuickAccess.getState().load()
    // Behind a delay so the update request never competes with session restore.
    const check = setTimeout(() => void checkOnStartup().catch(() => {}), 3000)
    const saveSession = useWorkspace.subscribe(scheduleSessionSave)
    return () => {
      clearTimeout(check)
      saveSession()
    }
  }, [])

  // Tree root labels ("This PC", drive names) are stored data: re-translate
  // them when the UI language changes mid-session.
  useEffect(
    () =>
      useSettings.subscribe((s, prev) => {
        if (s.lang !== prev.lang) useWorkspace.getState().retranslateRoots()
      }),
    [],
  )

  // Mirror the close-to-tray setting into the backend, which owns the
  // window-close decision (default true fires once on mount — harmless).
  const closeToTray = useSettings((s) => s.closeToTray)
  useEffect(() => {
    void invoke('set_close_to_tray', { enabled: closeToTray })
  }, [closeToTray])

  // External mutations of watched (expanded) directories → refresh the tree;
  // touched file paths → reload matching open tabs (unless they have unsaved
  // edits). The payload used to be a bare dir array — accept both shapes.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<{ dirs: string[]; files: string[] }>('fs:change', (event) => {
      const payload = event.payload as { dirs: string[]; files: string[] } | string[]
      const dirs = Array.isArray(payload) ? payload : payload.dirs
      const files = Array.isArray(payload) ? [] : payload.files
      const ws = useWorkspace.getState()
      void ws.handleFsChanges(dirs)
      void ws.handleFileChanges(files)
    }).then((stop) => {
      unlisten = stop
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const s = useWorkspace.getState()
      const key = e.key.toLowerCase()

      if (key === 's') {
        e.preventDefault()
        void s.saveActive()
      } else if (key === 'w') {
        e.preventDefault()
        const active = activePathOf(s)
        if (active) void s.closeTab(active)
      } else if (e.code === 'Backslash') {
        // Ctrl+\ splits right; Ctrl+Shift+\ splits down (a new row below).
        e.preventDefault()
        s.splitEditor(e.shiftKey ? 'down' : 'right')
      } else if (key === 'b') {
        e.preventDefault()
        s.toggleSidebar()
      } else if (key === 'v' && e.shiftKey) {
        e.preventDefault()
        s.togglePreview()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        cycleTab(e.shiftKey ? -1 : 1)
      } else if (key === 'f' || key === 'h') {
        // Let the editor's own keymap win when it has focus; this catches the
        // case where focus is elsewhere in the UI.
        const el = document.activeElement
        if (el?.closest('.cm-editor')) return
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('svcode:find'))
      } else if (key === '`' && s.selectedDir) {
        e.preventDefault()
        void s.openInTerminal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <div className="workbench">
        <CollapsiblePane className="pane-sidebar" open={sidebarOpen} width={sidebarWidth}>
          <Sidebar />
        </CollapsiblePane>
        {sidebarOpen && (
          <Splitter side="left" width={sidebarWidth} onWidth={useWorkspace.getState().setSidebarWidth} />
        )}

        <div className="pane-main">
          <div className="editor-rows" ref={groupsRef}>
            {rows.map((row, ri) => (
              <Fragment key={row.id}>
                {ri > 0 && <RowSplitter top={rows[ri - 1].id} bottom={row.id} mainH={groupsH} />}
                <section className="editor-row" style={{ flexGrow: rowRatios[row.id] ?? 1, flexBasis: 0 }}>
                  <div className="editor-groups">
                    {row.groups.map((gid, i) => (
                      <Fragment key={gid}>
                        {i > 0 && (
                          <GroupSplitter
                            left={row.groups[i - 1]}
                            right={gid}
                            rowGroups={row.groups}
                            mainW={groupsW}
                          />
                        )}
                        <section
                          className={`pane-editor${gid === activeGroup && flatGroups(rows).length > 1 ? ' is-active' : ''}`}
                          style={{ flexGrow: groupRatios[gid] ?? 1, flexBasis: 0 }}
                          // Clicking anywhere in a group focuses it: subsequent tree
                          // clicks and edits land here.
                          onPointerDownCapture={() => useWorkspace.getState().setActiveGroup(gid)}
                        >
                          <TabStrip groupId={gid} />
                          <GroupBody gid={gid} />
                          <GroupStatusBar groupId={gid} />
                        </section>
                      </Fragment>
                    ))}
                  </div>
                </section>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  )
}

/**
 * One group's content area: three view modes for previewable files — editor
 * only, editor + preview side by side, or preview only — plus the shared
 * splitter that drives `previewRatio` in the both view.
 */
function GroupBody({ gid }: { gid: number }) {
  const view = useWorkspace((s) => s.groupView[gid] ?? 'both')
  const previewRatio = useWorkspace((s) => s.previewRatio)
  const activeTab = useWorkspace((s) => {
    const active = s.groupActive[gid]
    return s.tabs.find((t) => t.group === gid && t.path === active) ?? null
  })
  const hasTab = !!activeTab
  // The mode is sticky, but a non-previewable file always renders as editor
  // (the stored mode is kept for when a previewable file is active again).
  const previewable = hasTab && hasPreview(activeTab.path)

  // The preview is a fraction of THIS group's width, so editor:preview stays
  // proportional when the group is resized. The splitter works in px, so
  // measure the body and convert both ways.
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyW, setBodyW] = useState(0)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBodyW(el.clientWidth))
    ro.observe(el)
    setBodyW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const previewWidth = bodyW > 0 ? Math.round(bodyW * previewRatio) : 420

  const previewOpen = previewable && view !== 'edit'
  const previewOnly = previewable && view === 'preview'
  return (
    <div className="group-body" ref={bodyRef}>
      {previewOnly ? (
        // Preview IS the group body — no editor, no splitter.
        <PreviewPane groupId={gid} />
      ) : (
        <>
          <EditorPane groupId={gid} />
          {previewOpen && (
            <Splitter
              side="right"
              width={previewWidth}
              onWidth={(px) => useWorkspace.getState().setPreviewRatio(px / bodyW)}
            />
          )}
          <CollapsiblePane className="pane-preview" open={previewOpen} width={previewWidth}>
            <PreviewPane groupId={gid} />
          </CollapsiblePane>
        </>
      )}
    </div>
  )
}

/**
 * Drag handle between two editor groups of one row: rebalances their
 * flex-grow shares (fractions of the row), exactly like the sidebar/preview
 * splitters work in px. Double-click resets both to equal halves.
 */
function GroupSplitter({
  left,
  right,
  rowGroups,
  mainW,
}: {
  left: number
  right: number
  rowGroups: number[]
  mainW: number
}) {
  const drag = useRef<{ x: number; l: number; r: number } | null>(null)

  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = useWorkspace.getState()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      x: e.clientX,
      l: s.groupRatios[left] ?? 1,
      r: s.groupRatios[right] ?? 1,
    }
    document.documentElement.classList.add('pane-resizing')
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || mainW <= 0) return
    const s = useWorkspace.getState()
    const total = rowGroups.reduce((acc, g) => acc + (s.groupRatios[g] ?? 1), 0)
    if (total <= 0) return
    // px delta → flex-grow delta: width share = grow / totalGrow.
    const delta = ((e.clientX - d.x) / mainW) * total
    useWorkspace.getState().adjustGroupSplit(left, right, d.l + delta, d.r - delta)
  }
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null
    document.documentElement.classList.remove('pane-resizing')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      className="group-splitter"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onDoubleClick={() => useWorkspace.getState().adjustGroupSplit(left, right, 1, 1)}
    />
  )
}

/**
 * Drag handle between two editor rows: rebalances their flex-grow height
 * shares. Same math as GroupSplitter, one axis down.
 */
function RowSplitter({ top, bottom, mainH }: { top: number; bottom: number; mainH: number }) {
  const drag = useRef<{ y: number; t: number; b: number } | null>(null)

  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = useWorkspace.getState()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      y: e.clientY,
      t: s.rowRatios[top] ?? 1,
      b: s.rowRatios[bottom] ?? 1,
    }
    document.documentElement.classList.add('pane-resizing')
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || mainH <= 0) return
    const s = useWorkspace.getState()
    const total = s.rows.reduce((acc, r) => acc + (s.rowRatios[r.id] ?? 1), 0)
    if (total <= 0) return
    const delta = ((e.clientY - d.y) / mainH) * total
    useWorkspace.getState().adjustRowSplit(top, bottom, d.t + delta, d.b - delta)
  }
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null
    document.documentElement.classList.remove('pane-resizing')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      className="row-splitter"
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onDoubleClick={() => useWorkspace.getState().adjustRowSplit(top, bottom, 1, 1)}
    />
  )
}

function cycleTab(direction: 1 | -1) {
  const s = useWorkspace.getState()
  // Cycle within the focused group, like VS Code.
  const groupTabs = s.tabs.filter((t) => t.group === s.activeGroup)
  if (groupTabs.length < 2) return
  const active = s.groupActive[s.activeGroup]
  const idx = groupTabs.findIndex((t) => t.path === active)
  const next = groupTabs[(idx + direction + groupTabs.length) % groupTabs.length]
  s.activate(next.path)
}
