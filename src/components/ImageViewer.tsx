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
/**
 * Per-path reference count of rendered <img>s. Eviction used to revoke the
 * URL outright — a URL still shown by another group's image viewer died on
 * screen. Now: a URL is revoked on evict only when nothing references it,
 * and on final release it is revoked if it has already left the cache.
 */
const refs = new Map<string, number>()

function acquireRef(path: string) {
  refs.set(path, (refs.get(path) ?? 0) + 1)
}

function releaseRef(path: string, url: string) {
  const n = (refs.get(path) ?? 1) - 1
  if (n > 0) {
    refs.set(path, n)
    return
  }
  refs.delete(path)
  // Revoke once nothing renders it and the cache no longer owns it (either
  // evicted, or evicted and replaced by a newer blob for the same path).
  if (cache.get(path) !== url) URL.revokeObjectURL(url)
}

async function urlFor(path: string): Promise<string> {
  const hit = cache.get(path)
  if (hit) {
    cache.delete(path)
    cache.set(path, hit)
    acquireRef(path)
    return hit
  }
  const buf = await invoke<ArrayBuffer>('read_bytes', { path })
  useWorkspace.getState().setTabSize(path, buf.byteLength)
  const url = URL.createObjectURL(new Blob([buf]))
  cache.set(path, url)
  acquireRef(path)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
    // Still-referenced URLs (another group rendering this file) must not
    // have their blob pulled out from under the <img>.
    if ((refs.get(oldest) ?? 0) === 0) {
      const old = cache.get(oldest)
      if (old) URL.revokeObjectURL(old)
    }
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
    let url: string | null = null
    urlFor(path)
      .then((u) => {
        if (alive) {
          url = u
          setState({ url: u })
        } else {
          // Resolved after the viewer moved on — drop the ref we took.
          releaseRef(path, u)
        }
      })
      .catch((err) => {
        if (alive) setState({ error: String(err) })
      })
    return () => {
      alive = false
      if (url) releaseRef(path, url)
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
