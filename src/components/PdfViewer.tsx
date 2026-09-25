import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspace } from '../store/workspace'
import { useT } from '../lib/i18n'
import { ZOOM_STEP, clampZoom } from '../lib/viewerZoom' 

/**
 * PDF preview via pdf.js, lazy-imported on first use (README decision #1).
 * Pages render one by one into a scrolling column so the first page shows
 * while the rest are still decoding. Zoom scales the canvases' CSS size —
 * they are rendered at devicePixelRatio resolution, so quality holds for
 * the practical zoom range without re-rendering.
 */
export function PdfViewer({ path, isActive }: { path: string; isActive: boolean }) {
  const t = useT()
  const scroller = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Zoom lives in the workspace store keyed by path — the group status bar's
  // − %/＋ controls drive the same value this viewer renders with.
  const zoom = useWorkspace((s) => s.zoom[path] ?? 1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom

  // New file: reset to fit.
  useEffect(() => {
    setError(null)
    setProgress(null)
    const host = scroller.current
    if (host) host.replaceChildren()

    let cancelled = false
    let loadingTask: { destroy: () => void } | null = null

    void (async () => {
      try {
        const [pdfjs, workerUrl] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default),
        ])
        if (cancelled) return
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

        const buf = await invoke<ArrayBuffer>('read_bytes', { path })
        if (cancelled) return
        useWorkspace.getState().setTabSize(path, buf.byteLength)

        const task = pdfjs.getDocument({ data: new Uint8Array(buf) })
        loadingTask = task
        const doc = await task.promise
        if (cancelled) return

        setProgress({ done: 0, total: doc.numPages })
        const containerWidth = () => Math.max(host!.clientWidth - 24, 320)

        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const scale = Math.min((containerWidth() / base.width) * window.devicePixelRatio, 4)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.className = 'pdf-page'
          canvas.dataset.page = String(n)
          host!.appendChild(canvas)
          const ctx = canvas.getContext('2d')!
          await page.render({ canvasContext: ctx, viewport, canvas }).promise
          // Shown size is CSS pixels; the canvas stays at DPR resolution.
          const cssW = Math.floor(viewport.width / window.devicePixelRatio)
          const cssH = Math.floor(viewport.height / window.devicePixelRatio)
          canvas.dataset.baseW = String(cssW)
          canvas.dataset.baseH = String(cssH)
          canvas.style.width = `${cssW * zoomRef.current}px`
          canvas.style.height = `${cssH * zoomRef.current}px`
          if (!cancelled) setProgress({ done: n, total: doc.numPages })
        }
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    })()

    return () => {
      cancelled = true
      try {
        loadingTask?.destroy()
      } catch {
        // Destroying a settled task can throw; nothing left to clean up.
      }
    }
  }, [path])

  // Apply zoom to every rendered page.
  useEffect(() => {
    const host = scroller.current
    if (!host) return
    host.querySelectorAll<HTMLCanvasElement>('.pdf-page').forEach((c) => {
      const bw = Number(c.dataset.baseW)
      const bh = Number(c.dataset.baseH)
      if (!bw || !bh) return
      c.style.width = `${bw * zoom}px`
      c.style.height = `${bh * zoom}px`
    })
  }, [zoom])

  const zoomAt = (next: number, anchor?: { x: number; y: number }) => {
    const el = scroller.current
    const prev = zoomRef.current
    const target = clampZoom('pdf', next)
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
    const el = scroller.current
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
  }, [isActive])

  return (
    <div className="pdf-view">
      {error ? (
        <div className="pane-placeholder viewer-error">{t('pdf.loadFailed', { msg: error })}</div>
      ) : (
        <>
          {progress && progress.done < progress.total && (
            <div className="pdf-progress">
              {t('pdf.rendering', { done: progress.done, total: progress.total })}
            </div>
          )}
          <div className="pdf-pages" ref={scroller} />
        </>
      )}
    </div>
  )
}
