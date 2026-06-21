// Display text for Facet perks (keyed to core/src/content.rs FACET_PERKS). Facets are the prestige
// meta-currency earned by ascending; these perks persist across every New Game+.
export const FACET_INFO: Record<string, { name: string; desc: string; icon: string }> = {
  meta_production: { name: 'Resonant Core', icon: '💎', desc: '+5% global production — forever, across every New Game+.' },
  resonant_floor: { name: 'Wider Foundation', icon: '🏛️', desc: '+1 base floor space that persists through every ascent.' },
  crystalline_start: { name: 'Crystalline Start', icon: '✨', desc: '+600 Flux head-start each time you ascend.' },
  collectors_eye: { name: "Collector’s Eye", icon: '◈', desc: '+15% shards from duplicates — permanently.' },
  ascendant: { name: 'Ascendant', icon: '🌌', desc: '+0.1 to the prestige base — every ascension compounds harder.' },
  overflow_resonance: { name: 'Overflow Resonance', icon: '⚡', desc: '+10% to the production ceiling, per level — MULTIPLICATIVE, so the cap scales with your prestige instead of falling behind.' },
  facet_yield: { name: 'Facet Bloom', icon: '🔮', desc: '+1 Facet every time you ascend, per level — keeps the meta-tree growing deep into New Game+.' },
}
