import type { CSSProperties, ReactNode } from 'react'
import { COLOR, RADIUS } from '../tokens'

// Small shared primitives.

/** A rarity/accent dot. */
export function RarityDot({ color, size = 8, style }: { color: string; size?: number; style?: CSSProperties }) {
  return <span style={{ width: size, height: size, borderRadius: RADIUS.pill, background: color, display: 'inline-block', flexShrink: 0, ...style }} />
}

/** A rounded pill (optionally tappable / selected, with a leading dot). */
export function Chip({
  children,
  dot,
  selected,
  onClick,
  title,
  style,
}: {
  children: ReactNode
  dot?: string
  selected?: boolean
  onClick?: () => void
  title?: string
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--c-surface-2)',
        border: `1px solid ${selected ? COLOR.teal : COLOR.hairline}`,
        borderRadius: RADIUS.pill,
        padding: '6px 12px',
        fontSize: 13,
        color: COLOR.textSecondary,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: selected ? '0 0 10px rgba(95,224,198,0.33)' : 'none',
        ...style,
      }}
    >
      {dot && <RarityDot color={dot} />}
      {children}
    </button>
  )
}

/** A tiny inline label badge. */
export function Badge({ children, color = COLOR.teal, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 800, color, border: `1px solid ${color}`, borderRadius: RADIUS.sm, padding: '1px 6px', lineHeight: 1.4, ...style }}>
      {children}
    </span>
  )
}

/** A consistently-sized line-icon frame (pass SVG children: paths/circles/etc.). */
export function Icon({ children, size = 16, stroke = 1.9, style }: { children: ReactNode; size?: number; stroke?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {children}
    </svg>
  )
}
