import type { CSSProperties } from 'react'

// Composite skeuomorphic "Vitrine" material recipes — the multi-property box-shadow stacks that a single CSS
// var can't hold. Built from the design tokens in juice.css :root. These are the canonical home for what the
// VITRINE/CAP consts were in App.tsx; App.tsx now aliases to them.

/** Recessed frosted pane sunk into a bezel — every container surface. (= the old VITRINE) */
export const MAT_RECESSED: CSSProperties = {
  background: 'linear-gradient(180deg, var(--c-surface-0) 0%, var(--c-surface-1) 60%, var(--c-surface-3) 100%)',
  border: '1px solid var(--c-border)',
  boxShadow: 'inset 0 2px 4px var(--ink-6), inset 0 -1px 0 var(--metal-fleck), inset 0 0 0 1px var(--brass-1), 0 1px 0 var(--edge-1)',
}

/** Domed metal cap proud of the surface — every neutral button. (= the old CAP; gradient kept exact so
 *  the hundreds of small buttons stay pixel-identical.) Press physics live in juice.css. */
export const MAT_CAP: CSSProperties = {
  background: 'linear-gradient(180deg, #2a2d3b 0%, #20222e 52%, #181922 100%)',
  // All-longhand borders (no `border` shorthand): callers that toggle a selected state set `borderColor`,
  // which must be a value *change* here — if the base only had the shorthand, that toggle would ADD then
  // REMOVE borderColor while borderTopColor stayed put, and React warns about the shorthand/longhand mix.
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--c-border-raised)',
  borderTopColor: 'var(--c-border-raised-lit)',
  borderBottomColor: '#14151d',
  color: 'var(--c-text)',
  boxShadow: 'inset 0 1px 0 var(--edge-4), inset 0 -1px 2px var(--ink-2), 0 2px 3px var(--ink-3), 0 1px 0 var(--ink-1)',
  cursor: 'pointer',
}

/** Lit display-case door — the hero modal plate (was copy-pasted across 4 cards). */
export const MAT_MODAL: CSSProperties = {
  background: 'radial-gradient(120% 90% at 50% 0%, var(--c-surface-4) 0%, #121320 55%, var(--c-surface-0) 100%)',
  border: '1px solid var(--c-border-raised)',
  boxShadow: 'inset 0 1px 0 var(--edge-2), inset 0 0 0 1px var(--brass-2), inset 0 0 40px var(--ink-4), 0 24px 60px var(--ink-7), 0 0 0 1px var(--ink-6)',
}

/** Milled channel behind a meter fill. */
export const MAT_WELL: CSSProperties = {
  background: 'linear-gradient(180deg, var(--c-surface-2), var(--c-surface-5))',
  border: '1px solid var(--ink-4)',
  boxShadow: 'inset 0 2px 3px var(--ink-7), inset 0 -1px 0 var(--metal-fleck), 0 1px 0 var(--edge-1)',
}

/** Backlit lozenge that fills a meter (pair with an inline `color`/`background` accent). */
export const MAT_FILL: CSSProperties = {
  boxShadow: '0 0 6px 0 currentColor, inset 0 1px 0 rgba(255,255,255,0.4)',
}

/** Specimen card raised slightly off the surface (recipe/deploy chips, chat slips). */
export const MAT_CARD: CSSProperties = {
  background: 'linear-gradient(180deg, var(--c-surface-3), var(--c-surface-1))',
  boxShadow: 'inset 0 1px 0 var(--edge-2), inset 0 -2px 5px var(--ink-3), 0 2px 4px var(--ink-1)',
}

/** Deep near-black well behind a 3D canvas — KEEP the dark bg so transmission glass still refracts. */
export const MAT_STAGE: CSSProperties = {
  background: 'var(--c-bg-stage)',
  boxShadow: 'inset 0 2px 8px var(--ink-7)',
}

/** A rarity-coloured inner glow + rim (the colour stays dynamic; only the recipe is shared). */
export const glowRarity = (color: string): CSSProperties => ({ boxShadow: `0 0 10px ${color}33, inset 0 0 0 1px ${color}` })

/** The teal selection ring (picked board cell / bench chip). */
export const GLOW_TEAL_RING: CSSProperties = { boxShadow: '0 0 10px var(--c-accent-teal), inset 0 0 0 1px var(--c-accent-teal)' }
