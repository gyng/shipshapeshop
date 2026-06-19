import type { CSSProperties } from 'react'

// TS mirror of the CSS design tokens declared in juice.css :root. Component code references these named
// tokens instead of magic values; colours return `var(--…)` strings that resolve to the :root values.

export const COLOR = {
  bgBase: 'var(--c-bg-base)',
  bgStage: 'var(--c-bg-stage)',
  surface0: 'var(--c-surface-0)',
  surface1: 'var(--c-surface-1)',
  surface2: 'var(--c-surface-2)',
  surface3: 'var(--c-surface-3)',
  surface4: 'var(--c-surface-4)',
  surface5: 'var(--c-surface-5)',
  surface6: 'var(--c-surface-6)',
  hairline: 'var(--c-hairline)',
  hairlineSoft: 'var(--c-hairline-soft)',
  border: 'var(--c-border)',
  borderRaised: 'var(--c-border-raised)',
  borderRaisedLit: 'var(--c-border-raised-lit)',
  text: 'var(--c-text)',
  textBright: 'var(--c-text-bright)',
  textSecondary: 'var(--c-text-secondary)',
  textMuted: 'var(--c-text-muted)',
  textDim: 'var(--c-text-dim)',
  textFaint: 'var(--c-text-faint)',
  teal: 'var(--c-accent-teal)',
  tealBright: 'var(--c-accent-teal-bright)',
  tealSoft: 'var(--c-accent-teal-soft)',
  pink: 'var(--c-accent-pink)',
  pinkBright: 'var(--c-accent-pink-bright)',
  pinkLight: 'var(--c-accent-pink-light)',
  coral: 'var(--c-accent-coral)',
  gold: 'var(--c-accent-gold)',
  goldBright: 'var(--c-accent-gold-bright)',
  goldDeep: 'var(--c-accent-gold-deep)',
  amber: 'var(--c-accent-amber)',
  violet: 'var(--c-accent-violet)',
  violetBright: 'var(--c-accent-violet-bright)',
  magenta: 'var(--c-accent-magenta)',
  shard: 'var(--c-shard)',
  danger: 'var(--c-danger)',
  dangerBorder: 'var(--c-danger-border)',
} as const

type SpStep = '0_5' | '1' | '1_5' | '2' | '2_5' | '3' | '3_5' | '4' | '4_5' | '5' | '6' | '7'
export const sp = (step: SpStep): string => `var(--sp-${step})`

export const RADIUS = {
  xs: 'var(--r-xs)',
  sm: 'var(--r-sm)',
  md: 'var(--r-md)',
  lg: 'var(--r-lg)',
  xl: 'var(--r-xl)',
  '2xl': 'var(--r-2xl)',
  '3xl': 'var(--r-3xl)',
  '4xl': 'var(--r-4xl)',
  pill: 'var(--r-pill)',
} as const

// Type-scale presets — size + weight + line-height in one object, for atoms.
export const TYPE: Record<string, CSSProperties> = {
  micro: { fontSize: 'var(--fs-micro)', fontWeight: 800, lineHeight: 1 },
  eyebrow: { fontSize: 'var(--fs-eyebrow)', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' },
  caption: { fontSize: 'var(--fs-caption)', lineHeight: 1.5 },
  bodySm: { fontSize: 'var(--fs-body-sm)', lineHeight: 1.5 },
  body: { fontSize: 'var(--fs-body)', lineHeight: 1.5 },
  h4: { fontSize: 'var(--fs-h4)', fontWeight: 700, lineHeight: 1.4 },
  h3: { fontSize: 'var(--fs-h3)', fontWeight: 700, lineHeight: 1.35 },
  h2: { fontSize: 'var(--fs-h2)', fontWeight: 700, lineHeight: 1.3 },
  numeral: { fontSize: 'var(--fs-numeral)', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  display: { fontSize: 'var(--fs-display)', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
}

export * from './materials'
