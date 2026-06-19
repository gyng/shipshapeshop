import type { CSSProperties } from 'react'
import { COLOR } from '../tokens'
import { MAT_WELL, MAT_FILL } from '../tokens/materials'

// A milled gauge channel with a backlit fill. `value` is 0..1; `color` is the accent (also drives the glow).
export function Meter({
  value,
  color = COLOR.teal,
  height = 7,
  label,
  style,
}: {
  value: number
  color?: string
  height?: number
  label?: string
  style?: CSSProperties
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div style={style}>
      {label && <div style={{ fontSize: 12, color: COLOR.textMuted, marginBottom: 4 }}>{label}</div>}
      <div style={{ ...MAT_WELL, height, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ ...MAT_FILL, width: `${pct}%`, height: '100%', background: color, color, borderRadius: 4, transition: 'width .3s ease' }} />
      </div>
    </div>
  )
}
