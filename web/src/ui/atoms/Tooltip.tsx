import { useCallback, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { COLOR, RADIUS } from '../tokens'
import { MAT_MODAL } from '../tokens/materials'

// A positioned HTML tooltip primitive — the substrate for the rich Paradox-style tooltips. Wraps a trigger;
// shows arbitrary `content` on hover / focus / tap, in a portal (never clipped), with smart edge-flipping.
// Keep `content` cheap to render; it mounts only while open.
export function Tooltip({
  content,
  children,
  maxWidth = 280,
  trigger = 'inline-flex',
}: {
  content: ReactNode
  children: ReactNode
  maxWidth?: number
  trigger?: CSSProperties['display']
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<{ x: number; y: number; above: boolean } | null>(null)
  const id = useId()

  const open = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vh = window.innerHeight
    const above = r.bottom + 12 + 160 > vh && r.top > 180 // flip up if little room below
    setBox({ x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above })
  }, [])
  const close = useCallback(() => setBox(null), [])

  const panel: CSSProperties = {
    position: 'fixed',
    left: box ? clamp(box.x, maxWidth, 8) : 0,
    top: box?.y ?? 0,
    transform: `translate(-50%, ${box?.above ? '-100%' : '0'})`,
    maxWidth,
    width: 'max-content',
    zIndex: 9000,
    ...MAT_MODAL,
    borderRadius: RADIUS.xl,
    padding: '10px 12px',
    color: COLOR.textSecondary,
    fontSize: 12.5,
    lineHeight: 1.5,
    pointerEvents: 'none',
    animation: 'tip-in .12s ease-out',
  }

  return (
    <span
      ref={ref}
      style={{ display: trigger }}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onClick={() => (box ? close() : open())}
      tabIndex={0}
      aria-describedby={box ? id : undefined}
    >
      {children}
      {box &&
        createPortal(
          <div id={id} role="tooltip" style={panel}>
            {content}
          </div>,
          document.body,
        )}
    </span>
  )
}

// keep the (centered) panel within the viewport horizontally
function clamp(centerX: number, width: number, margin: number): number {
  const half = width / 2
  const min = margin + half
  const max = window.innerWidth - margin - half
  return Math.max(min, Math.min(max, centerX))
}
