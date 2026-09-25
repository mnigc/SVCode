import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { extname } from '../lib/paths'
import { t as tNow, useT } from '../lib/i18n'
import { useViewerZoom } from '../lib/useViewerZoom'
import { useWorkspace } from '../store/workspace'

/** WebView2 can't decode TIFF natively; be upfront instead of a broken img. */
const UNSUPPORTED = new Set(['tiff', 'tif'])

/** Viewer padding (kept in sync with .viewer-img-wrap). */
const PAD = 18

/** Small blob-URL cache shared across tab switches; revoked on evict. */
const cache = new Map<string, string>()
const CACHE_MAX = 6

async function urlFor(path: string): Promise<string> {
  const hit = cache.get(path)
  if (hit) {
    cache.delete(path)
    cache.set(path, hit)
    return hit
  }
  const buf = await invoke<ArrayBuffer>('read_bytes', { path })
  useWorkspace.getState().setTabSize(path, buf.byteLength)
  const url = URL.createObjectURL(new Blob([buf]))
  cache.set(path, url)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    const old = cache.get(oldest)
    cache.delete(oldest)
    if (old) URL.revokeObjectURL(old)
  }
  return url
}

export function ImageViewer({ path, name, isActive }: { path: string; name: string; isActive: boolean }) {
  const t = useT()
  const [state, setState] = useState<{ url?: string; error?: string }>({})
  // Zoom plumbing (store-backed per path, Ctrl+wheel, keyboard) is shared
  // with the SVG preview via the hook.
  const { zoom, wrap, wrapBox, zoomAt } = useViewerZoom(path, 'image', isActive)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  // New file: reset to fit.
  useEffect(() => {
    setNatural(null)
    if (UNSUPPORTED.has(extname(path))) {
      setState({ error: tNow('img.tiff') })
      return
    }
    setState({})
    let alive = true
    urlFor(path)
      .then((url) => alive && setState({ url }))
      .catch((err) => alive && setState({ error: String(err) }))
    return () => {
      alive = false
    }
  }, [path])

  // Fit size: contain within the padded viewport, never upscaling at fit.
  const fitScale =
    natural && wrapBox
      ? Math.min(
          (wrapBox.w - PAD * 2) / natural.w,
          (wrapBox.h - PAD * 2) / natural.h,
          1,
        )
      : null
  const dispW = natural && fitScale !== null ? natural.w * fitScale * zoom : null

  return (
    <div className="viewer-img-wrap" ref={wrap}>
      {state.error ? (
        <div className="pane-placeholder viewer-error">{state.error}</div>
      ) : !state.url ? (
        <div className="pane-placeholder">{t('img.loading')}</div>
      ) : (
        <img
          className="viewer-img"
          src={state.url}
          alt={name}
          draggable={false}
          onLoad={(e) =>
            setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
          style={
            dispW !== null && natural
              ? { width: dispW, height: natural.h * (dispW / natural.w) }
              : { maxWidth: '100%', maxHeight: '100%' }
          }
          onDoubleClick={() => zoomAt(zoom >= 2 ? 1 : 2)}
        />
      )}
    </div>
  )
}
