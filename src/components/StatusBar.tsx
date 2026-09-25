import type { ReactNode } from 'react'
import { useWorkspace, hasPreview, type GroupView, type TabInfo } from '../store/workspace'
import { kindLabel } from '../lib/paths'
import { useT, tBackend } from '../lib/i18n'
import { officeNoteKey } from './OfficeViewer'
import { ZOOM_STEP, clampZoom, type ZoomKind } from '../lib/viewerZoom'

/**
 * Global status bar: workspace-level state only (folder, notice, total tab
 * count). Per-file info — including the Office accuracy note — lives in each
 * group's own strip (GroupStatusBar).
 */
export function StatusBar() {
  const t = useT()
  const selectedDir = useWorkspace((s) => s.selectedDir)
  const notice = useWorkspace((s) => s.notice)
  const dismissNotice = useWorkspace((s) => s.dismissNotice)
  const tabCount = useWorkspace((s) => s.tabs.length)

  return (
    <footer className="statusbar">
      <span className="status-cell" title={selectedDir ?? undefined}>
        {selectedDir ?? t('status.thisPC')}
      </span>
      <span className="status-spacer" />
      {notice && (
        <button className="status-cell status-error" onClick={dismissNotice} title={t('status.dismiss')}>
          {tBackend(notice)}
        </button>
      )}
      <span className="status-cell">{t('status.tabs', { n: tabCount })}</span>
    </footer>
  )
}

/** Always-on accuracy note for office files (no dismissal — user decision). */
function OfficeNoteCell({ tab }: { tab: { kind: string; path: string } }) {
  const t = useT()
  const noteKey = tab.kind === 'office' ? officeNoteKey(tab.path) : null
  if (!noteKey) return null
  return (
    <span className="status-cell status-note">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 7.2v3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="8" cy="5" r="0.9" fill="currentColor" />
      </svg>
      {t(noteKey)}
    </span>
  )
}

/** − %/＋ zoom controls for image/pdf/office tabs; drives the same store
 * zoom the viewer renders with (the % label click = reset to fit). */
function ZoomCells({ tab }: { tab: TabInfo }) {
  const t = useT()
  const kind = (tab.kind === 'image' || tab.kind === 'pdf' ? tab.kind : 'office') as ZoomKind
  const zoom = useWorkspace((s) => s.zoom[tab.path] ?? 1)
  const set = (next: number) =>
    useWorkspace.getState().setZoom(tab.path, clampZoom(kind, next))

  return (
    <span className="status-zoom">
      <button className="btn-icon" title={t('viewer.zoomOut')} onClick={() => set(zoom / ZOOM_STEP)}>
        −
      </button>
      <button className="status-zoom-label" title={t('viewer.fit')} onClick={() => set(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button className="btn-icon" title={t('viewer.zoomIn')} onClick={() => set(zoom * ZOOM_STEP)}>
        ＋
      </button>
    </span>
  )
}

/** 编辑 / 双栏 / 预览 switcher for previewable files, shown in the group's
 * own status strip. Pure view state — never touches the tab's content. */
function ViewModeCells({ groupId }: { groupId: number }) {
  const t = useT()
  const view = useWorkspace((s) => s.groupView[groupId] ?? 'both')
  const setGroupView = useWorkspace((s) => s.setGroupView)
  const modes: { id: GroupView; key: 'viewmode.edit' | 'viewmode.both' | 'viewmode.preview'; icon: ReactNode }[] = [
    {
      id: 'edit',
      key: 'viewmode.edit',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5.2 3.8 1.6 8l3.6 4.2" />
          <path d="M10.8 3.8 14.4 8l-3.6 4.2" />
        </svg>
      ),
    },
    {
      id: 'both',
      key: 'viewmode.both',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
          <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
          <path d="M8 2.8v10.4" />
        </svg>
      ),
    },
    {
      id: 'preview',
      key: 'viewmode.preview',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
          <path d="M1.6 8s2.5-4.2 6.4-4.2S14.4 8 14.4 8 11.9 12.2 8 12.2 1.6 8 1.6 8Z" />
          <circle cx="8" cy="8" r="1.9" />
        </svg>
      ),
    },
  ]
  return (
    <span className="viewmode" role="group" aria-label={t('viewmode.label')}>
      {modes.map((m) => (
        <button
          key={m.id}
          className={`btn-icon${view === m.id ? ' is-active' : ''}`}
          title={t(m.key)}
          aria-pressed={view === m.id}
          onClick={() => setGroupView(groupId, m.id)}
        >
          {m.icon}
        </button>
      ))}
    </span>
  )
}

/**
 * Info strip at the bottom of ONE editor group card: kind/encoding/size of
 * that group's active file — not the globally focused one. Previewable files
 * get the 编辑/双栏/预览 switcher, office files carry the always-on accuracy
 * note, zoomable files get − %/＋ here.
 */
export function GroupStatusBar({ groupId }: { groupId: number }) {
  const t = useT()
  const tab = useWorkspace((s) => {
    const active = s.groupActive[groupId]
    return s.tabs.find((t) => t.group === groupId && t.path === active) ?? null
  })
  if (!tab) return null
  const zoomable = tab.kind === 'image' || tab.kind === 'pdf' || tab.kind === 'office'

  return (
    <div className="group-statusbar">
      <span className="status-cell">{kindLabel(tab.kind)}</span>
      {tab.encoding !== 'utf-8' && <span className="status-cell">{tab.encoding}</span>}
      {(tab.kind === 'text' || tab.kind === 'markdown') && (
        <>
          <span className="status-cell">
            {tab.readOnly ? t('status.readonly') : t('status.chars', { n: tab.text.length.toLocaleString() })}
          </span>
          <span className="status-cell">{t('status.lines', { n: tab.lineCount.toLocaleString() })}</span>
        </>
      )}
      <span className="status-spacer" />
      {hasPreview(tab.path) && <ViewModeCells groupId={groupId} />}
      <OfficeNoteCell tab={tab} />
      {zoomable && <ZoomCells tab={tab} />}
    </div>
  )
}
