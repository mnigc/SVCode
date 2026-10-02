import { useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { dirname } from '../lib/paths'
import { useT } from '../lib/i18n'
import { useViewerZoom } from '../lib/useViewerZoom'

/** Viewer padding, kept in sync with .viewer-img-wrap. */
const PAD = 18

/**
 * Static HTML preview, same interaction model as the image/SVG viewers: fit
 * to the pane at zoom 1 (never upscaling), Ctrl+wheel / double-click /
 * statusbar −%/＋ to zoom, wrap scrolls past the pane. The document loads via
 * `srcdoc` — not a blob URL: the Tauri CSP has no frame-src, so
 * `default-src 'self'` forbids frame navigation to `blob:` and WebView2 shows
 * its "blocked content" error page instead of the preview. `allow-same-origin`
 * is granted so the fit math can read the document's scroll size; scripts,
 * forms and popups stay inert because those sandbox flags are never granted.
 * The iframe is pointer-inert for the same reason — gestures land on the
 * scroll wrap instead of vanishing into the frame.
 *
 * Relative assets resolve through the Tauri asset protocol via an injected
 * `<base>`; needs `app.security.assetProtocol` and `http://asset.localhost`
 * in the CSP's img/style/media/font-src (tauri.conf.json).
 */
export function HtmlPreview({ text, path, isActive }: { text: string; path: string; isActive: boolean }) {
  const t = useT()
  // The trailing slash is load-bearing: without it the whole encoded dir
  // path is the base URL's last segment, and relative refs would resolve
  // off the host root (`/assets/…`) instead of inside the file's directory.
  const base = path ? convertFileSrc(dirname(path)) + '/' : null
  const srcDoc = base ? injectBase(text, base) : text
  const { zoom, wrap, wrapBox, zoomAt } = useViewerZoom(path, 'image', isActive)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [docSize, setDocSize] = useState<{ w: number; h: number } | null>(null)

  // The fit math needs the document's own size. Fixed-canvas pages (posters
  // declaring `body { width: 1242px }`) report their canvas via scrollWidth
  // even though they hide their own overflow; flowing pages report the pane
  // width and fit at ~100%. srcdoc reloads on every keystroke, so measure on
  // each load event; webfonts can shift metrics after first paint.
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => {
      const d = el.contentDocument
      if (!d || d.location.href !== 'about:srcdoc' || !d.documentElement) return
      const read = () => {
        const root = d.documentElement
        const w = Math.max(root.scrollWidth, d.body?.scrollWidth ?? 0)
        const h = Math.max(root.scrollHeight, d.body?.scrollHeight ?? 0)
        if (w > 0 && h > 0) {
          setDocSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
        }
      }
      read()
      d.fonts?.ready.then(read).catch(() => {})
    }
    el.addEventListener('load', measure)
    return () => el.removeEventListener('load', measure)
  }, [])

  // Same fit semantics as the SVG preview: content size = natural × fit × zoom.
  const fitScale =
    docSize && wrapBox && docSize.w > 0 && docSize.h > 0
      ? Math.min(1, (wrapBox.w - PAD * 2) / docSize.w, (wrapBox.h - PAD * 2) / docSize.h)
      : null
  const scale = fitScale === null ? null : fitScale * zoom

  return (
    <div className="viewer-img-wrap" ref={wrap} onDoubleClick={() => zoomAt(zoom >= 2 ? 1 : 2)}>
      <iframe
        ref={frameRef}
        className="preview-html-frame viewer-img"
        sandbox="allow-same-origin"
        title={t('preview.htmlTitle')}
        srcDoc={srcDoc}
        style={
          scale !== null && docSize
            ? { width: docSize.w, height: docSize.h, zoom: scale, pointerEvents: 'none' }
            : { width: '100%', height: '100%', pointerEvents: 'none' }
        }
      />
    </div>
  )
}

function injectBase(html: string, base: string): string {
  const tag = `<base href="${base}">`
  const stripped = html.replace(/<base\b[^>]*>/gi, '')
  return /<head[^>]*>/i.test(stripped)
    ? stripped.replace(/<head[^>]*>/i, (m) => m + tag)
    : tag + stripped
}
