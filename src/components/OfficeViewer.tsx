import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspace } from '../store/workspace'
import { extname } from '../lib/paths'
import { useT } from '../lib/i18n'
import { clampZoom } from '../lib/viewerZoom'
import { parseXlsxInWorker } from '../lib/xlsxParse'
import type { ParsedSheet } from '../lib/xlsxParse'
import { XLSX_MAX_COLS, XLSX_MAX_ROWS } from '../lib/xlsxLimits'

/**
 * Read-only preview for OOXML documents (.docx/.xlsx/.pptx), rendered in the
 * editor pane like PdfViewer. Each format lazy-imports its parser on first
 * use. Zoom (toolbar + Ctrl+wheel) is shared across the three renderers and
 * scales via the Chromium `zoom` layout property, so scrolling and anchored
 * zoom stay sane. The legacy binary formats (.doc/.xls/.ppt) are intentionally
 * not handled — no usable pure-JS parser exists for them.
 */

interface ViewState {
  loading: boolean
  error: string | null
}

const useDocument = (path: string, parse: (buf: ArrayBuffer) => Promise<void>) => {
  const [state, setState] = useState<ViewState>({ loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null })
    void (async () => {
      try {
        const buf = await invoke<ArrayBuffer>('read_bytes', { path })
        if (cancelled) return
        useWorkspace.getState().setTabSize(path, buf.byteLength)
        await parse(buf)
        if (!cancelled) setState({ loading: false, error: null })
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: String(err) })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  return state
}

/* ---------- shared zoom (toolbar + Ctrl+wheel), mirrors PdfViewer ---------- */

const ZOOM_STEP = 1.25

type ZoomAt = (
  next: number,
  scroller: HTMLElement | null,
  anchor?: { x: number; y: number },
) => void

/**
 * Zoom from the workspace store keyed by path — the group status bar's
 * − %/＋ controls drive the same value these views render with.
 */
function useViewerZoom(path: string) {
  const zoom = useWorkspace((s) => s.zoom[path] ?? 1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom
  const zoomAt = useCallback<ZoomAt>(
    (next, scroller, anchor) => {
      const prev = zoomRef.current
      const target = clampZoom('office', next)
      if (!scroller || target === prev) return
      const rect = scroller.getBoundingClientRect()
      const ox = anchor ? anchor.x - rect.left : scroller.clientWidth / 2
      const oy = anchor ? anchor.y - rect.top : scroller.clientHeight / 2
      const cx = ox + scroller.scrollLeft
      const cy = oy + scroller.scrollTop
      const ratio = target / prev
      useWorkspace.getState().setZoom(path, target)
      requestAnimationFrame(() => {
        scroller.scrollLeft = cx * ratio - ox
        scroller.scrollTop = cy * ratio - oy
      })
    },
    [path],
  )
  return { zoom, zoomRef, zoomAt }
}

/**
 * Ctrl+wheel anchored zoom (non-passive so preventDefault blocks webview zoom)
 * plus keyboard zoom (Ctrl+= / Ctrl+- / Ctrl+0, anchored to the viewport
 * center). Keys are answered only while `isActive` — the focused group — so
 * two viewers open at once never double-step. `ready` re-runs the effect when
 * the scroller first renders (xlsx/pptx only mount it after parsing), which
 * otherwise left the listeners permanently unattached.
 */
function useCtrlWheelZoom(
  scrollerRef: RefObject<HTMLElement | null>,
  zoomAt: ZoomAt,
  zoomRef: RefObject<number>,
  isActive: boolean,
  ready: boolean,
) {
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      zoomAt(zoomRef.current * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), el, {
        x: e.clientX,
        y: e.clientY,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })

    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key !== '=' && e.key !== '+' && e.key !== '-' && e.key !== '0') return
      e.preventDefault()
      if (e.key === '0') {
        zoomAt(1, el)
        return
      }
      const rect = el.getBoundingClientRect()
      zoomAt(
        e.key === '-' ? zoomRef.current / ZOOM_STEP : zoomRef.current * ZOOM_STEP,
        el,
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      )
    }
    if (isActive) window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (isActive) window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, ready])
}


/* ---------- .docx ---------- */

const PAPER_FIT_MARGIN = 24

function DocxView({ path, isActive }: { path: string; isActive: boolean }) {
  const t = useT()
  const scroller = useRef<HTMLDivElement>(null)
  // Fit-to-width scale measured after render, kept separate from the user
  // zoom so the % control multiplies both (100% = fitted).
  const fitRef = useRef(1)
  const { zoom, zoomRef, zoomAt } = useViewerZoom(path)

  const applyZoom = useCallback(() => {
    const wrap = scroller.current?.querySelector<HTMLElement>('.docx-wrapper')
    if (wrap) wrap.style.zoom = String(fitRef.current * zoomRef.current)
  }, [])

  const state = useDocument(path, async (buf) => {
    const el = scroller.current
    if (!el) return
    const { renderAsync } = await import('docx-preview')
    if (!scroller.current) return
    await renderAsync(buf, scroller.current, undefined, {
      inWrapper: true,
      // Images become data URLs — no blob URLs to track for revocation.
      useBase64URL: true,
    })
    const wrap = el.querySelector<HTMLElement>('.docx-wrapper')
    fitRef.current = 1
    if (wrap) {
      wrap.style.zoom = ''
      const avail = el.clientWidth - PAPER_FIT_MARGIN
      if (avail > 0 && wrap.scrollWidth > avail) fitRef.current = avail / wrap.scrollWidth
    }
    applyZoom()
  })

  useEffect(() => {
    applyZoom()
  }, [zoom, applyZoom])
  useCtrlWheelZoom(scroller, zoomAt, zoomRef, isActive, !state.error)

  return (
    <div className="office-view">
      <ViewStatus {...state} label={t('office.parsingDoc')} />
      {!state.error && (
        <>
          <div className="docx-scroll" ref={scroller} />
        </>
      )}
    </div>
  )
}

/* ---------- .xlsx ---------- */

function XlsxView({ path, isActive }: { path: string; isActive: boolean }) {
  const t = useT()
  const scroller = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [active, setActive] = useState(0)
  const workerRef = useRef<Worker | null>(null)
  const { zoom, zoomRef, zoomAt } = useViewerZoom(path)

  // Terminated here as well as inside the parse client: switching files or
  // unmounting (the viewer is keyed by path) kills an in-flight parse.
  useEffect(() => () => workerRef.current?.terminate(), [])

  const state = useDocument(path, async (buf) => {
    setSheets(await parseXlsxInWorker(buf, (w) => (workerRef.current = w)))
    setActive(0)
  })

  // `zoom` on the table container survives sheet switches (same element).
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.style.zoom = String(zoom)
  }, [zoom, sheets, active])
  useCtrlWheelZoom(scroller, zoomAt, zoomRef, isActive, sheets.length > 0)

  const sheet = sheets[active]

  return (
    <div className="office-view">
      <ViewStatus {...state} label={t('office.parsingSheet')} />
      {!state.error && sheets.length > 0 && (
        <>
          <div className="xlsx-sheetbar" role="tablist">
            {sheets.map((s, i) => (
              <button
                key={s.name}
                role="tab"
                aria-selected={i === active}
                className={`xlsx-sheet${i === active ? ' is-active' : ''}`}
                onClick={() => setActive(i)}
              >
                {s.name}
              </button>
            ))}
          </div>
          {sheet.truncated && (
            <div className="banner">
              {t('office.truncated', { rows: XLSX_MAX_ROWS, cols: XLSX_MAX_COLS })}
            </div>
          )}
          <div className="xlsx-scroll" ref={scroller}>
            <div className="xlsx-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: sheet.html }} />
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- .pptx (text-level extraction, no layout/images) ---------- */

interface SlideInfo {
  title: string
  paragraphs: string[]
}

async function parsePptx(buf: ArrayBuffer): Promise<SlideInfo[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  const slides: SlideInfo[] = []
  for (const name of names) {
    const xml = await zip.file(name)!.async('text')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) continue
    const slide: SlideInfo = { title: '', paragraphs: [] }
    for (const shape of Array.from(doc.getElementsByTagName('p:sp'))) {
      const ph = shape.getElementsByTagName('p:ph')[0]
      const isTitle = ph?.getAttribute('type') === 'title' || ph?.getAttribute('type') === 'ctrTitle'
      const lines: string[] = []
      for (const p of Array.from(shape.getElementsByTagName('a:p'))) {
        const text = Array.from(p.getElementsByTagName('a:t'))
          .map((t) => t.textContent ?? '')
          .join('')
          .trim()
        if (text) lines.push(text)
      }
      if (lines.length === 0) continue
      if (isTitle && !slide.title) {
        slide.title = lines[0]
        slide.paragraphs.push(...lines.slice(1))
      } else {
        slide.paragraphs.push(...lines)
      }
    }
    slides.push(slide)
  }
  return slides
}

function PptxView({ path, isActive }: { path: string; isActive: boolean }) {
  const t = useT()
  const scroller = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const [slides, setSlides] = useState<SlideInfo[]>([])
  const { zoom, zoomRef, zoomAt } = useViewerZoom(path)

  const state = useDocument(path, async (buf) => {
    const parsed = await parsePptx(buf)
    setSlides(parsed)
  })

  useEffect(() => {
    if (stackRef.current) stackRef.current.style.zoom = String(zoom)
  }, [zoom, slides])
  useCtrlWheelZoom(scroller, zoomAt, zoomRef, isActive, slides.length > 0)

  return (
    <div className="office-view">
      <ViewStatus {...state} label={t('office.parsingSlides')} />
      {!state.error && slides.length > 0 && (
        <>
          <div className="pptx-scroll" ref={scroller}>
            <div className="pptx-stack" ref={stackRef}>
              {slides.map((s, i) => (
                <section className="pptx-slide" key={i}>
                  <div className="pptx-slide-no">{t('office.slideNo', { n: i + 1 })}</div>
                  {s.title && <h3 className="pptx-title">{s.title}</h3>}
                  {s.paragraphs.length > 0 ? (
                    <ul className="pptx-lines">
                      {s.paragraphs.map((line, j) => (
                        <li key={j}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    !s.title && <p className="pptx-empty">{t('office.slideEmpty')}</p>
                  )}
                </section>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- shared chrome ---------- */

/** Which accuracy note applies to this office file (shown persistently in
 * the group's info strip). */
export function officeNoteKey(path: string): 'office.noteDocx' | 'office.noteXlsx' | 'office.notePptx' | null {
  switch (extname(path)) {
    case 'docx':
      return 'office.noteDocx'
    case 'xlsx':
      return 'office.noteXlsx'
    case 'pptx':
      return 'office.notePptx'
    default:
      return null
  }
}

function ViewStatus({
  loading,
  error,
  label,
}: ViewState & {
  label: string
}) {
  const t = useT()
  if (loading) return <div className="pane-placeholder">{label}</div>
  if (error) return <div className="pane-placeholder viewer-error">{t('viewer.parseFailed', { msg: error })}</div>
  return null
}

export function OfficeViewer({ path, isActive }: { path: string; isActive: boolean }) {
  const t = useT()
  switch (extname(path)) {
    case 'docx':
      return <DocxView key={path} path={path} isActive={isActive} />
    case 'xlsx':
      return <XlsxView key={path} path={path} isActive={isActive} />
    case 'pptx':
      return <PptxView key={path} path={path} isActive={isActive} />
    default:
      return <div className="pane-placeholder viewer-error">{t('office.unsupported')}</div>
  }
}
