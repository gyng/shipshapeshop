import { useEffect, useRef, useState, type CSSProperties } from 'react'

// Animated counter: the displayed number eases toward `value` (a feel-layer tween — the truth is whatever
// the store passes). Tabular figures so it doesn't jitter. The juice layer adds a glow on increase via CSS.
export function Numeral({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  duration = 650,
  style,
  className,
}: {
  value: number
  format?: (n: number) => string
  duration?: number
  style?: CSSProperties
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const displayRef = useRef(value)
  displayRef.current = display

  useEffect(() => {
    const from = displayRef.current
    const to = value
    if (Math.abs(to - from) < 0.5) {
      setDisplay(to)
      return
    }
    let raf = 0
    let start = 0
    const step = (t: number) => {
      if (!start) start = t
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
      setDisplay(from + (to - from) * eased)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {format(display)}
    </span>
  )
}
