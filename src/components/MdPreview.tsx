import { useEffect, useRef, useState } from 'react'
import { renderMarkdown, openExternalSafe } from '../lib/markdown'
import type { TabInfo } from '../store/workspace'

/** Debounce for re-rendering markdown as the user types. */
const RENDER_DEBOUNCE_MS = 180

/**
 * Rendered markdown for the preview pane. Scroll sync is ratio-based and
 * bidirectional: editor scroll → here (via `svcode:editorscroll`), here →
 * editor (via `svcode:previewscroll`). The suppress flag breaks the echo
 * loop when one side's programmatic scroll would fire the other.
 */
export function MdPreview({ tab }: { tab: TabInfo }) {
  // The scroller is this component's own root (not the shared .preview-body):
  // scroll sync needs an element it both reads and drives reliably.
  const scroller = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState('')
  // Echo-guard timestamp, per component instance — a module-level one would
  // let one group's preview swallow another group's scroll echoes.
  const ignoreScrollUntil = useRef(0)

  useEffect(() => {
    openExternalSafe(scroller.current!)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setHtml(renderMarkdown(tab.text)), RENDER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [tab.text])

  useEffect(() => {
    const onEditorScroll = (e: Event) => {
      const { path, ratio } = (e as CustomEvent<{ path: string; ratio: number }>).detail
      if (path !== tab.path || !scroller.current) return
      const el = scroller.current
      const max = el.scrollHeight - el.clientHeight
      if (max > 0) {
        // Programmatic write: its own scroll event must not echo back.
        ignoreScrollUntil.current = Date.now() + ECHO_GUARD_MS
        el.scrollTop = ratio * max
      }
    }
    window.addEventListener('svcode:editorscroll', onEditorScroll)
    return () => window.removeEventListener('svcode:editorscroll', onEditorScroll)
  }, [tab.path])

  return (
    <div
      className="md-scroll"
      ref={scroller}
      onScroll={() => {
        const el = scroller.current
        if (!el) return
        const max = el.scrollHeight - el.clientHeight
        if (max <= 0) return
        // Skip the programmatic scroll we just wrote (echo guard), so only
        // genuine user scrolls mirror back into the editor.
        if (Date.now() < ignoreScrollUntil.current) return
        window.dispatchEvent(
          new CustomEvent('svcode:previewscroll', {
            detail: { path: tab.path, ratio: el.scrollTop / max },
          }),
        )
      }}
    >
      <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

/** How long a programmatically-scrolled pane suppresses its own echo. */
const ECHO_GUARD_MS = 150
