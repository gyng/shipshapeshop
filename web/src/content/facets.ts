// Display text for Facet perks (keyed to core/src/content.rs FACET_PERKS). Facets are the prestige
// meta-currency earned by recrystallizing; these perks persist across every New Game+.
export const FACET_INFO: Record<string, { name: string; desc: string; icon: string }> = {
  meta_production: { name: 'Resonant Core', icon: '💎', desc: '+5% global production — forever, across every New Game+.' },
  resonant_floor: { name: 'Wider Foundation', icon: '🏛️', desc: '+1 base floor space that persists through every ascent.' },
  crystalline_start: { name: 'Crystalline Start', icon: '✨', desc: '+600 Flux head-start each time you recrystallize.' },
  collectors_eye: { name: "Collector’s Eye", icon: '◈', desc: '+15% shards from duplicates — permanently.' },
  ascendant: { name: 'Ascendant', icon: '🌌', desc: '+0.1 to the prestige base — every ascension compounds harder.' },
}
