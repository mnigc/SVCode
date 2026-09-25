import { useEffect, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { extname } from '../lib/paths'
import { useT, tBackend } from '../lib/i18n'
import { useViewerZoom } from '../lib/useViewerZoom'
import { MdPreview } from './MdPreview'
import { HtmlPreview } from './HtmlPreview'
import { UnsupportedCard } from './UnsupportedCard'

const HTML_EXTS = new Set(['html', 'htm'])

/** Viewer padding (kept in sync with .viewer-img-wrap). */
const PAD = 18

/**
 * Zoomable SVG preview, same interaction model as the image viewer: default
 * size is fit-to-pane (no scrollbars), Ctrl+wheel / double-click / the group
 * status bar's − %/＋ zoom on top of that. Unlike raster images, fit may
 * upscale — SVG is resolution-independent, and a small logo should fill the
 * pane instead of sitting stamp-sized in the corner.
 */
function SvgPreview({ path, url, isActive }: { path: string; url: string; isActive: boolean }) {
  const { zoom, wrap, wrapBox, zoomAt } = useViewerZoom(path, 'image', isActive)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  const fitScale =
    natural && wrapBox && natural.w > 0 && natural.h > 0
      ? Math.min((wrapBox.w - PAD * 2) / natural.w, (wrapBox.h - PAD * 2) / natural.h)
      : null
  const dispW = natural && fitScale !== null ? natural.w * fitScale * zoom : null

  return (
    <div className="viewer-img-wrap" ref={wrap}>
      <img
        className="viewer-img viewer-svg"
        src={url}
        alt=""
        draggable={false}
        onLoad={(e) =>
          setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
        }
        style={
          dispW !== null && natural
            ? { width: dispW, height: natural.h * (dispW / natural.w) }
            : // No intrinsic size (bare <svg> without viewBox) — degrade to
              // plain fit, which is still scrollbar-free.
              { maxWidth: '100%', maxHeight: '100%' }
        }
        onDoubleClick={() => zoomAt(zoom >= 2 ? 1 : 2)}
      />
    </div>
  )
}

/**
 * The preview pane of ONE editor group (it lives inside that group, right of
 * its editor). Markdown renders live; SVG text files render through an <img>
 * data URL, which is script-inert by spec — the safest way to show untrusted
 * vector files. HTML files load into a fully sandboxed iframe.
 */
export function PreviewPane({ groupId }: { groupId: number }) {
  const t = useT()
  const tab = useWorkspace((s) => {
    const active = s.groupActive[groupId]
    return s.tabs.find((t) => t.group === groupId && t.path === active) ?? null
  })
  const togglePreview = useWorkspace((s) => s.togglePreview)
  const isActive = useWorkspace((s) => s.activeGroup === groupId)
  const [svgUrl, setSvgUrl] = useState<string | null>(null)
  const isHtml = tab?.kind === 'text' && HTML_EXTS.has(extname(tab.path))

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
      <div className={`preview-body${svgUrl || isHtml ? ' is-media' : ''}`}>
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
          <SvgPreview path={tab.path} url={svgUrl} isActive={isActive} />
        ) : isHtml ? (
          <HtmlPreview text={tab.text} />
        ) : (
          <UnsupportedCard tab={tab} compact />
        )}
      </div>
    </aside>
  )
}
