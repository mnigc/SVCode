import { useWorkspace, flatGroups } from '../store/workspace'
import { useT } from '../lib/i18n'
import { CodeEditor } from './CodeEditor'
import { ImageViewer } from './ImageViewer'
import { OfficeViewer } from './OfficeViewer'
import { PdfViewer } from './PdfViewer'
import { UnsupportedCard } from './UnsupportedCard'

/** The editor area of ONE group: its active tab, or the welcome card. */
export function EditorPane({ groupId }: { groupId: number }) {
  const t = useT()
  const activeGroup = useWorkspace((s) => s.activeGroup)
  const hasSiblings = useWorkspace((s) => flatGroups(s.rows).length > 1)
  const tab = useWorkspace((s) => {
    const active = s.groupActive[groupId]
    return s.tabs.find((t) => t.group === groupId && t.path === active) ?? null
  })

  if (!tab) {
    return (
      <div className="welcome">
        <div className="welcome-logo">
          <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5.4 4.6 2 8l3.4 3.4M10.6 4.6 14 8l-3.4 3.4" />
          </svg>
        </div>
        <h1>SVCode</h1>
        <p className="welcome-sub">{t('welcome.tagline')}</p>
        <p className="welcome-sub">{t('welcome.start')}</p>
        <ul className="welcome-keys">
          <li>
            <kbd>Ctrl</kbd>
            <kbd>F</kbd> <span>{t('welcome.find')}</span>
          </li>
          <li>
            <kbd>Ctrl</kbd>
            <kbd>S</kbd> <span>{t('welcome.save')}</span>
          </li>
          <li>
            <kbd>Ctrl</kbd>
            <kbd>B</kbd> <span>{t('welcome.sidebar')}</span>
          </li>
          <li>
            <kbd>Ctrl</kbd>
            <kbd>Shift</kbd>
            <kbd>V</kbd> <span>{t('welcome.preview')}</span>
          </li>
          <li>
            <kbd>Ctrl</kbd>
            <kbd>\</kbd> <span>{t('welcome.split')}</span>
          </li>
        </ul>
        {hasSiblings && (
          <button className="welcome-close" onClick={() => void useWorkspace.getState().closeGroup(groupId)}>
            {t('group.close')}
          </button>
        )}
      </div>
    )
  }

  if (tab.kind === 'image') {
    return <ImageViewer path={tab.path} name={tab.name} isActive={groupId === activeGroup} />
  }

  if (tab.kind === 'pdf') {
    return <PdfViewer path={tab.path} isActive={groupId === activeGroup} />
  }

  if (tab.kind === 'office') {
    return <OfficeViewer path={tab.path} isActive={groupId === activeGroup} />
  }

  if (tab.kind === 'binary') {
    return <UnsupportedCard tab={tab} />
  }

  if (tab.loading) return <div className="pane-placeholder">{t('pane.loading')}</div>
  if (tab.error) return <UnsupportedCard tab={tab} error={tab.error} />

  return (
    <div className="editor-pane">
      {tab.readOnly && <div className="banner">{t('pane.readonly')}</div>}
      <CodeEditor tab={tab} group={groupId} active={groupId === activeGroup} />
    </div>
  )
}
