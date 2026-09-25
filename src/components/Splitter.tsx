import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

interface Props {
  /** 'left' grows when dragged right; 'right' grows when dragged left. */
  side: 'left' | 'right'
  width: number
  onWidth: (px: number) => void
}

export function Splitter({ side, width, onWidth }: Props) {
  const drag = useRef<{ x: number; w: number } | null>(null)

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { x: e.clientX, w: width }
      // The pane wrappers animate width for open/close; that transition must
      // not run during a drag or the pane lags every pointer move and the
      // edge visibly oscillates (the "accordion" effect).
      document.documentElement.classList.add('pane-resizing')
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag.current) return
      const delta = e.clientX - drag.current.x
      onWidth(side === 'left' ? drag.current.w + delta : drag.current.w - delta)
    },
    [side, onWidth],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null
    document.documentElement.classList.remove('pane-resizing')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => onWidth(side === 'left' ? 260 : 420)}
    />
  )
}
