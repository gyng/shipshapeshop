import type { CSSProperties } from 'react'
import { fluxPattern, type EmitKind, type ActKind } from '../content/effects'

// A small graphical read-out of how a shape plays on the Orrery flux floor: HOW it fires flux (emit) and
// WHAT it does to flux passing through it (act). Stroke-based SVG glyphs (currentColor, theme-aware).

const svgBase: React.SVGProps<SVGSVGElement> = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style: { display: 'block' },
}

// six rays for the "scatter" glyph (all directions at once)
const SCATTER_RAYS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i
  const c = Math.cos(a), s = Math.sin(a)
  return { x1: 12 + 4 * c, y1: 12 + 4 * s, x2: 12 + 9.5 * c, y2: 12 + 9.5 * s }
})

function EmitGlyph({ kind }: { kind: EmitKind }) {
  return (
    <svg {...svgBase} aria-hidden>
      {kind === 'beam' && (
        <>
          <circle cx="4.5" cy="12" r="2.2" fill="currentColor" stroke="none" />
          <line x1="7" y1="12" x2="18.5" y2="12" />
          <polyline points="14.5,8.5 18.5,12 14.5,15.5" />
        </>
      )}
      {kind === 'rotating' && (
        <>
          <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
          <path d="M19 12a7 7 0 1 1-2.05-4.95" />
          <polyline points="17,3.6 17,7.4 13.2,7.4" />
        </>
      )}
      {kind === 'scatter' && (
        <>
          <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
          {SCATTER_RAYS.map((r, i) => (
            <line key={i} x1={r.x1.toFixed(1)} y1={r.y1.toFixed(1)} x2={r.x2.toFixed(1)} y2={r.y2.toFixed(1)} />
          ))}
        </>
      )}
      {kind === 'pulse' && (
        <>
          <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="5.5" opacity="0.7" />
          <circle cx="12" cy="12" r="9.4" opacity="0.4" />
        </>
      )}
    </svg>
  )
}

function ActGlyph({ kind }: { kind: ActKind }) {
  return (
    <svg {...svgBase} aria-hidden>
      {kind === 'pass' && (
        <>
          <line x1="3" y1="12" x2="21" y2="12" />
          <polyline points="17.5,8.5 21,12 17.5,15.5" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === 'multiply' && (
        <>
          <line x1="3" y1="12" x2="10" y2="12" />
          <circle cx="11.5" cy="12" r="2.3" fill="currentColor" stroke="none" />
          <line x1="13.5" y1="11" x2="20" y2="7.5" />
          <polyline points="17.4,7 20,7.5 19.2,9.9" />
          <line x1="13.5" y1="13" x2="20" y2="16.5" />
          <polyline points="19.2,14.1 20,16.5 17.4,17" />
        </>
      )}
      {kind === 'redirect' && (
        <>
          <path d="M3 16.5 H12.5 Q16 16.5 16 13 V6" />
          <polyline points="13,8.5 16,5.2 19,8.5" />
          <circle cx="16" cy="13" r="1.6" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  )
}

const ACT_COLOR: Record<ActKind, string> = { pass: '#8a93a8', multiply: '#ffcf6b', redirect: '#b985ff' }

export function FluxBehaviour({ family, genus, heading }: { family: string; genus: number; heading: string }) {
  const fp = fluxPattern(family, genus)
  const panel: CSSProperties = { border: '1px solid var(--c-border)', background: 'var(--c-surface-2)', borderRadius: 'var(--r-lg)', padding: '8px 11px', textAlign: 'left' }
  const eyebrow: CSSProperties = { fontSize: 'var(--fs-eyebrow)', fontWeight: 'var(--fw-heavy)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, padding: '3px 0' }
  const chip = (color: string): CSSProperties => ({ flexShrink: 0, width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 'var(--r-md)', background: `${color}1c`, color, border: `1px solid ${color}40` })
  const label: CSSProperties = { fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)', lineHeight: 1.3 }
  return (
    <div style={panel}>
      <div style={eyebrow}>{heading}</div>
      <div style={row}>
        <span style={chip('#5fe0c6')}><EmitGlyph kind={fp.emit} /></span>
        <span style={label}>{fp.emitLabel}</span>
      </div>
      <div style={row}>
        <span style={chip(ACT_COLOR[fp.act])}><ActGlyph kind={fp.act} /></span>
        <span style={label}>{fp.actLabel}</span>
      </div>
    </div>
  )
}
