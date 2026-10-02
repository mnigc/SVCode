import { useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useWorkspace } from '../store/workspace'
import { useT } from '../lib/i18n'
import { revealInTree } from '../lib/reveal'
import { scrollIntoContainer } from '../lib/scrollIntoContainer'
import { useDismiss } from '../lib/useDismiss'
import { NodeIcon } from './NodeIcon'
import { NodeMenu } from './NodeMenu'

/**
 * Payload of the tab currently being HTML5-dragged. Module scope on purpose:
 * every group's TabStrip must see it, and `dataTransfer` is unreadable while
 * a dragover is in flight.
 */
let dragPayload: { path: string; fromGroup: number } | null = null

/**
 * Tab rects captured once at dragstart: dragover fires per pixel and used to
 * re-run a querySelector per tab on every event. Keyed by path so any strip
 * (this one or a drop target in another group) reads its own tabs' rects.
 */
let dragRects: Map<string, DOMRect> | null = null

function captureDragRects() {
  dragRects = new Map()
  document.querySelectorAll<HTMLElement>('.tab[data-path]').forEach((el) => {
    dragRects!.set(el.dataset.path!, el.getBoundingClientRect())
  })
}

/** End-of-gesture cleanup. Runs a tick late so every strip's drop handler
 * (including drops into other groups) has read the payload. */
function finishDrag() {
  setTimeout(() => {
    dragPayload = null
    dragRects = null
  }, 0)
}

/**
 * Tab bar of ONE editor group. Shows that group's tabs and per-group close
 * actions; the split button opens a menu to spawn an empty group to the
 * left/right of, or a new row above/below, this group. Tabs drag: reorder
 * within the strip, or drop onto another group's strip to move between
 * groups (the caret line marks the insertion gap).
 */
export function TabStrip({ groupId }: { groupId: number }) {
  const tr = useT()
  const tabs = useWorkspace((s) => s.tabs)
  const activePath = useWorkspace((s) => s.groupActive[groupId] ?? null)
  const activate = useWorkspace((s) => s.activate)
  const closeTab = useWorkspace((s) => s.closeTab)
  const closeAllTabs = useWorkspace((s) => s.closeAllTabs)
  const closeOthers = useWorkspace((s) => s.closeOthers)
  const closeRight = useWorkspace((s) => s.closeRight)
  const closeGroup = useWorkspace((s) => s.closeGroup)
  const splitEditor = useWorkspace((s) => s.splitEditor)
  const moveTab = useWorkspace((s) => s.moveTab)

  // Tabs of this group only (the store keeps them flat).
  const groupTabs = tabs.filter((t) => t.group === groupId)

  const scroller = useRef<HTMLDivElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const [splitOpen, setSplitOpen] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  // Tab-drag state: which of this strip's tabs is being dragged (dims it),
  // and where a hovered drop would land (insertion index among this group's
  // tabs excluding the dragged one — matches store.moveTab's indexing).
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const hasCaret = dropAt !== null

  // The caret renders in whichever strip the pointer hovers; a drag that ends
  // elsewhere (Esc, drop into another group) must clear it here too — and the
  // shared drag payload/rects get their end-of-gesture cleanup in the same
  // window-level events (a tab unmounting mid-drag would otherwise leak them).
  useEffect(() => {
    if (!hasCaret) return
    const clear = () => {
      setDropAt(null)
      finishDrag()
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [hasCaret])

  /** Insertion index for a drop at `clientX`, counted over this group's tabs
   * excluding the dragged one, from the rects captured at dragstart. */
  const insertionIndex = (clientX: number, payloadPath: string): number => {
    const others = groupTabs.filter((t) => t.path !== payloadPath)
    for (let i = 0; i < others.length; i++) {
      const r = dragRects?.get(others[i].path)
      if (!r) continue
      if (clientX < r.left + r.width / 2) return i
    }
    return others.length
  }

  const onStripDragOver = (e: ReactDragEvent) => {
    if (!dragPayload) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const idx = insertionIndex(e.clientX, dragPayload.path)
    setDropAt((prev) => (prev === idx ? prev : idx))
  }

  const onStripDrop = (e: ReactDragEvent) => {
    const payload = dragPayload
    dragPayload = null
    setDropAt(null)
    if (!payload) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    moveTab(payload.path, groupId, insertionIndex(e.clientX, payload.path))
  }

  // Context menu dismissal — same pattern as the file tree's TreeMenu.
  useDismiss(!!menu, () => setMenu(null), '.ctx-menu')

  // Split-direction dropdown dismissal — same pattern as the ⋯ menu below.
  useDismiss(splitOpen, () => setSplitOpen(false), splitRef)

  // Overlay scroll indicator: thumb size/pos in percent, null when no overflow.
  const [bar, setBar] = useState<{ w: number; l: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    startX: number
    startLeft: number
    pxPerPx: number
    /** pressed on the thumb (drag only, never jump) */
    jumped: boolean
    /** became a drag gesture once the pointer moved past a few px */
    moved: boolean
  } | null>(null)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => {
      if (el.scrollWidth <= el.clientWidth + 1) {
        setBar(null)
        return
      }
      // Same 6% floor as the drag math so the visual thumb and the drag
      // mapping always agree.
      const w = Math.max((el.clientWidth / el.scrollWidth) * 100, 6)
      const max = el.scrollWidth - el.clientWidth
      const l = max > 0 ? (el.scrollLeft / max) * (100 - w) : 0
      setBar({ w, l })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const bringActiveIntoView = () => {
      const tab = el.querySelector('.tab.is-active')
      if (tab) scrollIntoContainer(tab, el)
    }
    const ro = new ResizeObserver(() => {
      update()
      // When the strip is resized (e.g. the preview pane squeezes the
      // editor), the active tab can fall outside the narrowed view —
      // follow it, same as on activation.
      bringActiveIntoView()
    })
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [groupTabs.length])

  // No native scrollbar: follow the active tab into view instead.
  useEffect(() => {
    const el = scroller.current
    if (!activePath || !el) return
    const tab = el.querySelector('.tab.is-active')
    if (tab) scrollIntoContainer(tab, el)
  }, [activePath, groupTabs.length])

  useDismiss(moreOpen, () => setMoreOpen(false), moreRef)

  const activeIdx = groupTabs.findIndex((t) => t.path === activePath)
  const reference = activePath ?? groupTabs[0]?.path

  // Roving-tabindex tablist navigation: ←/→ move focus to the previous/next
  // tab and activate it (simplest compliant form; the active tab carries
  // tabIndex 0, the rest -1). No clash with middle-click close or drag.
  const onTablistKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (groupTabs.length < 2) return
    e.preventDefault()
    const step = e.key === 'ArrowRight' ? 1 : -1
    const next = groupTabs[(activeIdx + step + groupTabs.length) % groupTabs.length]
    activate(next.path)
    requestAnimationFrame(() => {
      scroller.current
        ?.querySelector<HTMLElement>(`.tab[data-path="${CSS.escape(next.path)}"]`)
        ?.focus()
    })
  }

  const onBarPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scroller.current
    const track = barRef.current
    if (!el || !track) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = track.getBoundingClientRect()
    const maxScroll = el.scrollWidth - el.clientWidth
    const thumbW = Math.max((el.clientWidth / el.scrollWidth) * rect.width, rect.width * 0.06)
    const maxThumb = rect.width - thumbW
    const pxPerPx = maxThumb > 0 ? maxScroll / maxThumb : 0
    drag.current = {
      startX: e.clientX,
      startLeft: el.scrollLeft,
      pxPerPx,
      jumped: (e.target as Element).classList.contains('tabstrip-scrollbar-thumb'),
      moved: false,
    }
  }

  const onBarPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scroller.current
    const d = drag.current
    if (!el || !d) return
    const delta = e.clientX - d.startX
    if (Math.abs(delta) > 4) d.moved = true
    // Hold without moving: wait — it may still be a click-to-jump. Once the
    // pointer travels, scroll relative to the gesture (no teleporting jump).
    if (d.jumped || d.moved) {
      el.scrollLeft = d.startLeft + delta * d.pxPerPx
    }
  }

  const onBarPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // A clean track click (press + release, no travel) jumps to the spot.
    const el = scroller.current
    const track = barRef.current
    if (!d || d.jumped || d.moved || !el || !track) return
    const rect = track.getBoundingClientRect()
    const maxScroll = el.scrollWidth - el.clientWidth
    const thumbW = Math.max((el.clientWidth / el.scrollWidth) * rect.width, rect.width * 0.06)
    const maxThumb = rect.width - thumbW
    if (maxThumb <= 0) return
    const x = e.clientX - rect.left - thumbW / 2
    el.scrollLeft = Math.min(1, Math.max(0, x / maxThumb)) * maxScroll
  }

  return (
    <div className="tabstrip" onContextMenu={(e) => e.preventDefault()}>
      <div
        className="tabstrip-scroll"
        ref={scroller}
        role="tablist"
        onKeyDown={onTablistKeyDown}
        onWheel={(e) => {
          const el = scroller.current
          if (el) el.scrollLeft += e.deltaY + e.deltaX
        }}
        onDragOver={onStripDragOver}
        onDrop={onStripDrop}
      >
        {(() => {
          // Caret placement: the drop would land before others[dropAt], or
          // after the last remaining tab for an append.
          const others = dragging ? groupTabs.filter((t) => t.path !== dragging) : groupTabs
          const caretBefore =
            dropAt !== null && dropAt < others.length ? others[dropAt].path : null
          const caretAfter =
            dropAt !== null && dropAt >= others.length && others.length > 0
              ? others[others.length - 1].path
              : null
          return groupTabs.map((t) => (
            <div
              key={t.path}
              role="tab"
              aria-selected={t.path === activePath}
              // Roving tabindex: only the reference tab is in the Tab order.
              tabIndex={t.path === reference ? 0 : -1}
              data-path={t.path}
              draggable
              className={[
                'tab',
                t.path === activePath ? 'is-active' : '',
                t.path === dragging ? 'is-dragging' : '',
                t.path === caretBefore ? 'is-drop-before' : '',
                t.path === caretAfter ? 'is-drop-after' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={t.path}
              onClick={() => {
                activate(t.path)
                // Locate the file in the tree as well: expand its ancestor
                // chain (expand-only) and scroll the row into view. Expand-only
                // means re-clicking a tab never folds the tree back up.
                void revealInTree(t.path)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, path: t.path })
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void closeTab(t.path)
                }
              }}
              onDragStart={(e) => {
                dragPayload = { path: t.path, fromGroup: groupId }
                captureDragRects()
                setDragging(t.path)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', t.path)
              }}
              onDragEnd={() => {
                dragPayload = null
                dragRects = null
                setDragging(null)
                setDropAt(null)
              }}
            >
              <NodeIcon spec={t.icon} size={14} />
              <span className="tab-name">{t.name}</span>
              <span className={`tab-dirty${t.dirty ? ' is-on' : ''}`}>●</span>
              <button
                className="tab-close"
                title={tr('tab.close')}
                onClick={(e) => {
                  e.stopPropagation()
                  void closeTab(t.path)
                }}
              >
                ×
              </button>
            </div>
          ))
        })()}
      </div>

      {bar && (
        <div
          className="tabstrip-scrollbar"
          ref={barRef}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
        >
          <div
            className="tabstrip-scrollbar-thumb"
            style={{ width: `${bar.w}%`, left: `${bar.l}%` }}
          />
        </div>
      )}

      <div className="tabstrip-more" ref={splitRef}>
        <button
          className={`tab-more-btn${splitOpen ? ' is-open' : ''}`}
          title={tr('tab.split')}
          onClick={() => setSplitOpen((o) => !o)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
            <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
            <path d="M8 2.8v10.4" />
          </svg>
        </button>
        {splitOpen && (
          <div className="menu-panel is-right" role="menu">
            {(
              [
                ['right', 'tab.split.right'],
                ['down', 'tab.split.down'],
                ['left', 'tab.split.left'],
                ['up', 'tab.split.up'],
              ] as const
            ).map(([dir, key]) => (
              <button
                key={dir}
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  setSplitOpen(false)
                  splitEditor(dir)
                }}
              >
                <span>{tr(key)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tabstrip-more" ref={moreRef}>
        <button
          className={`tab-more-btn${moreOpen ? ' is-open' : ''}`}
          title={tr('tab.actions')}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="13" cy="8" r="1.4" />
          </svg>
        </button>
        {moreOpen && (
          <div className="menu-panel is-right" role="menu">
            <button
              className="menu-item"
              role="menuitem"
              disabled={groupTabs.length < 2}
              onClick={() => {
                setMoreOpen(false)
                if (reference) void closeOthers(reference)
              }}
            >
              <span>{tr('tab.closeOthers')}</span>
            </button>
            <button
              className="menu-item"
              role="menuitem"
              disabled={activeIdx < 0 || activeIdx >= groupTabs.length - 1}
              onClick={() => {
                setMoreOpen(false)
                if (reference) void closeRight(reference)
              }}
            >
              <span>{tr('tab.closeRight')}</span>
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false)
                void closeAllTabs()
              }}
            >
              <span>{tr('tab.closeAll')}</span>
            </button>
            <button
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false)
                void closeGroup(groupId)
              }}
            >
              <span>{tr('tab.closeGroup')}</span>
            </button>
          </div>
        )}
      </div>

      {menu && <NodeMenu path={menu.path} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  )
}
