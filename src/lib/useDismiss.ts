import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Close a floating panel on any document-level pointerdown outside it, or on
 * Escape. `guard` is either a CSS selector (presses inside `closest(guard)`
 * keep the panel open — shared menus) or a ref to the panel's anchor element
 * (presses inside `contains(guard)` keep it open — per-instance dropdowns).
 * The two forms preserve the exact semantics of the call sites this hook
 * replaced: shared menus must not dismiss each other, anchored dropdowns
 * must (each anchor only protects its own panel).
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  guard?: string | RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null): boolean => {
      if (typeof guard === 'string') {
        return target instanceof Element && target.closest(guard) !== null
      }
      const el = guard?.current
      return !!el && target instanceof Node && el.contains(target)
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close, guard])
}
