// Display text for gacha banners (keyed to core/src/content.rs BANNERS). Standard is always available; the
// themed banners ROTATE — one is featured at a time, cycling daily. Banners only add a rate-up (bias the
// within-tier pick toward their featured shapes); rarity odds + pity are unchanged.
export const BANNER_INFO: Record<string, { name: string; blurb: string; icon: string }> = {
  standard: { name: 'Standard', blurb: 'The whole pool, evenly — pity steers you toward shapes you’re still missing.', icon: '✦' },
  knots: { name: 'Knots & Links', blurb: 'Rate-up on tangled things — trefoils, the figure-eight, Borromean rings, the Hopf link.', icon: '🪢' },
  fourth_dim: { name: 'The Fourth Dimension', blurb: 'Rate-up on the 4D polytopes — tesseract, 24-cell, the 120- and 600-cell.', icon: '🧩' },
  nonorientable: { name: 'Non-Orientable', blurb: 'Rate-up on one-sided wonders — Möbius, Klein, Boy’s surface, the Klein quartic.', icon: '🍶' },
}

// Which themed banner (id 1..themedCount) is featured right now — rotates once per day. Standard (0) is always on.
export function rotatingBannerId(now: number, themedCount: number): number {
  if (themedCount <= 0) return 0
  const day = Math.floor(now / 86_400_000)
  return 1 + (day % themedCount)
}
