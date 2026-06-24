// Small inline SVG icons for the HUD — crisp at any DPI and theme-aware (they inherit `currentColor`), unlike
// the emoji they replace. Stroke-based, 24×24 viewBox. A `muted` variant draws the slash for sound/music.

interface IconProps {
  size?: number
  muted?: boolean
}

const base = (size: number) =>
  // `display: block` drops the inline-SVG baseline gap so the glyph sits dead-centre in its (icon-only) button
  // instead of riding the text baseline.
  ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } }) as const

/** Speaker — with sound waves when on, an ✕ when muted. */
export function SoundIcon({ size = 16, muted = false }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M4 9v6h3.5L13 19V5L7.5 9H4z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />
      ) : (
        <>
          <path d="M16 9.5a4 4 0 0 1 0 5" />
          <path d="M18.5 7.5a7 7 0 0 1 0 9" />
        </>
      )}
    </svg>
  )
}

/** Music — two beamed notes, with a diagonal slash when muted. */
export function MusicIcon({ size = 16, muted = false }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M9 17V5l11-2v12" />
      <circle cx="6.5" cy="17" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="15" r="2.5" fill="currentColor" stroke="none" />
      {muted && <path d="M3.5 3.5l17 17" stroke="currentColor" />}
    </svg>
  )
}

/** Dialogue log — a page with text lines. */
export function LogIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 9h6M9 13h6M9 17h4" />
    </svg>
  )
}

/** Settings — a cog: hub circle + eight spokes. */
export function SettingsIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 1.6v3.1M12 19.3v3.1M1.6 12h3.1M19.3 12h3.1M4.4 4.4l2.2 2.2M17.4 17.4l2.2 2.2M19.6 4.4l-2.2 2.2M6.6 17.4l-2.2 2.2" />
    </svg>
  )
}

/** Dev tools — a wrench. */
export function WrenchIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M15.2 6.1a4 4 0 0 0-5.4 5.2l-5.4 5.4a1.6 1.6 0 0 0 2.3 2.3l5.4-5.4a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.2-.6-.6-2.2 2.6-2.6z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Cosmetics — a faceted gem (table + girdle + crown/pavilion facets). */
export function CosmeticsIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} aria-hidden="true">
      <path d="M6 3h12l4 6-10 12L2 9z" />
      <path d="M2 9h20" />
      <path d="M6 3l3 6 3 12 3-12 3-6" />
    </svg>
  )
}
