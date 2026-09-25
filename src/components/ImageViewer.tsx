import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspace } from '../store/workspace'
import { extname } from '../lib/paths'
import { t as tNow, useT } from '../lib/i18n'
import { ZOOM_STEP, clampZoom } from '../lib/viewerZoom'

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
  // Zoom lives in the workspace store keyed by path — the group status bar's
  // − %/＋ controls drive the same value this viewer renders with.
  const zoom = useWorkspace((s) => s.zoom[path] ?? 1)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [wrapBox, setWrapBox] = useState<{ w: number; h: number } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(1)
  zoomRef.current = zoom

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

  // Track the viewport so "fit" follows window/panel resizes.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setWrapBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  /**
   * Zoom keeping `anchor` (viewport coords) fixed on the same image point.
   * Content size scales linearly with zoom, so one rAF after the style
   * commits, scroll = contentPoint * ratio - offset puts it back.
   */
  const zoomAt = (next: number, anchor?: { x: number; y: number }) => {
    const el = wrap.current
    const prev = zoomRef.current
    const target = clampZoom('image', next)
    if (!el || target === prev) return
    const rect = el.getBoundingClientRect()
    const ox = anchor ? anchor.x - rect.left : el.clientWidth / 2
    const oy = anchor ? anchor.y - rect.top : el.clientHeight / 2
    const cx = ox + el.scrollLeft
    const cy = oy + el.scrollTop
    const ratio = target / prev
    useWorkspace.getState().setZoom(path, target)
    requestAnimationFrame(() => {
      el.scrollLeft = cx * ratio - ox
      el.scrollTop = cy * ratio - oy
    })
  }

  // Ctrl+wheel zoom (non-passive so preventDefault blocks webview zoom) plus
  // keyboard zoom (Ctrl+= / Ctrl+- / Ctrl+0, viewport-center anchor). Keys are
  // answered only while `isActive` — the focused group — so two viewers open
  // at once never double-step.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      zoomAt(zoomRef.current * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), {
        x: e.clientX,
        y: e.clientY,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })

    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key !== '=' && e.key !== '+' && e.key !== '-' && e.key !== '0') return
      e.preventDefault()
      zoomAt(
        e.key === '-' ? zoomRef.current / ZOOM_STEP : e.key === '0' ? 1 : zoomRef.current * ZOOM_STEP,
      )
    }
    if (isActive) window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (isActive) window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.url, isActive])

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
          onDoubleClick={() => zoomAt(zoomRef.current >= 2 ? 1 : 2)}
        />
      )}
    </div>
  )
}
