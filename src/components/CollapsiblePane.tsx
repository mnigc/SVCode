import { useEffect, useState, type ReactNode } from 'react'

/** How long the exit animation runs before unmounting the pane. */
const EXIT_MS = 220

/**
 * Width-collapse wrapper for the sidebar/preview panes. Content stays at a
 * fixed width and gets clipped while the wrapper animates, so nothing
 * reflows mid-transition.
 */
export function CollapsiblePane({
  open,
  width,
  className = '',
  children,
}: {
  open: boolean
  width: number
  className?: string
  children: ReactNode
}) {
  // Mount/unmount is separate from the expanded class so the 0→width
  // transition has a painted starting frame on entry.
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setExpanded(true)),
      )
      return () => cancelAnimationFrame(raf)
    }
    setExpanded(false)
    const timer = setTimeout(() => setMounted(false), EXIT_MS)
    return () => clearTimeout(timer)
  }, [open])

  if (!mounted) return null

  return (
    <div
      className={`pane-anim${expanded ? ' is-open' : ''} ${className}`}
      style={{ width: expanded ? width : 0 }}
    >
      <div className="pane-anim-inner" style={{ width }}>
        {children}
      </div>
    </div>
  )
}
