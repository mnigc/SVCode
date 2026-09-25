import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { ZOOM_STEP, clampZoom, type ZoomKind } from './viewerZoom'

/**
 * Shared zoom plumbing for the fit-based viewers (raster image, SVG
 * preview): store-backed zoom keyed by path, viewport tracking via
 * ResizeObserver, and anchored Ctrl+wheel / keyboard zooming. The fit math
 * and content sizing stay with the caller — `zoomAt` only assumes content
 * scales linearly with zoom, like the image viewer's.
 */
export function useViewerZoom(path: string, kind: ZoomKind, isActive: boolean) {
  const zoom = useWorkspace((s) => s.zoom[path] ?? 1)
  const wrap = useRef<HTMLDivElement>(null)
  const [wrapBox, setWrapBox] = useState<{ w: number; h: number } | null>(null)
  const zoomRef = useRef(1)
  zoomRef.current = zoom

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
   * Zoom keeping `anchor` (viewport coords) fixed on the same content point.
   * Content size scales linearly with zoom, so one rAF after the style
   * commits, scroll = contentPoint * ratio - offset puts it back.
   */
  const zoomAt = (next: number, anchor?: { x: number; y: number }) => {
    const el = wrap.current
    const prev = zoomRef.current
    const target = clampZoom(kind, next)
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
  }, [path, kind, isActive])

  return { zoom, wrap, wrapBox, zoomAt }
}
