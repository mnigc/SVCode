import { useEffect } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Minimal modal focus trap: on open, focus the dialog's first interactive
 * element; while open, Tab/Shift+Tab cycle within it. Focus is NOT restored
 * on close (the opener re-renders without the dialog; nothing needs it).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return
    const root = ref.current
    if (!root) return
    const items = () =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    const first = items()[0]
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = items()
      if (!list.length) return
      const firstEl = list[0]
      const lastEl = list[list.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === firstEl || !root.contains(active)) {
          e.preventDefault()
          lastEl.focus()
        }
      } else if (active === lastEl || !root.contains(active)) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => root.removeEventListener('keydown', onKey)
  }, [ref, open])
}
