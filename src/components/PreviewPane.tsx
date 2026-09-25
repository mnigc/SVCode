import { useEffect, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { extname } from '../lib/paths'
import { useT, tBackend } from '../lib/i18n'
import { MdPreview } from './MdPreview'
import { UnsupportedCard } from './UnsupportedCard'

/**
 * The preview pane of ONE editor group (it lives inside that group, right of
 * its editor). Markdown renders live; SVG text files render through an <img>
 * data URL, which is script-inert by spec — the safest way to show untrusted
 * vector files.
 */
export function PreviewPane({ groupId }: { groupId: number }) {
  const t = useT()
  const tab = useWorkspace((s) => {
    const active = s.groupActive[groupId]
    return s.tabs.find((t) => t.group === groupId && t.path === active) ?? null
  })
  const togglePreview = useWorkspace((s) => s.togglePreview)
  const [svgUrl, setSvgUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!tab || tab.kind !== 'text' || extname(tab.path) !== 'svg') {
      setSvgUrl(null)
      return
    }
    const url = URL.createObjectURL(new Blob([tab.text], { type: 'image/svg+xml' }))
    setSvgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [tab?.path, tab?.text, tab?.kind, tab])

  return (
    <aside className="preview">
      <div className="preview-head">
        <span>{t('preview.title')}</span>
        <button className="btn-icon" title={t('preview.close')} onClick={() => togglePreview(groupId)}>
          ×
        </button>
      </div>
      <div className="preview-body">
        {!tab ? (
          <p className="preview-hint">{t('preview.empty')}</p>
        ) : tab.kind === 'markdown' ? (
          tab.loading ? (
            <p className="preview-hint">{t('pane.loading')}</p>
          ) : tab.error ? (
            <p className="preview-hint">{tBackend(tab.error)}</p>
          ) : (
            <MdPreview tab={tab} />
          )
        ) : svgUrl ? (
          <img className="viewer-svg" src={svgUrl} alt={tab.name} draggable={false} />
        ) : (
          <UnsupportedCard tab={tab} compact />
        )}
      </div>
    </aside>
  )
}
