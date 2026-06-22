// Display text for Facet perks (keyed to core/src/content.rs FACET_PERKS). Facets are the prestige
// meta-currency earned by ascending; these perks persist across every New Game+.
// `step`/`unit` drive the "now → next" delta shown on each facet card (the scarcest currency — it deserves the
// most decision support, so every multi-level perk shows its accumulated + next-level effect).
export const FACET_INFO: Record<string, { name: string; desc: string; icon: string; step?: number; unit?: string }> = {
  meta_production: { name: 'Resonant Core', icon: '💎', desc: '+5% global production — forever, across every New Game+.', step: 5, unit: '%' },
  resonant_floor: { name: 'Wider Foundation', icon: '🏛️', desc: '+1 base floor space that persists through every ascent.', step: 1, unit: ' χ' },
  crystalline_start: { name: 'Crystalline Start', icon: '✨', desc: '+600 Flux head-start each time you ascend.', step: 600, unit: ' ✦' },
  collectors_eye: { name: "Collector’s Eye", icon: '◈', desc: '+15% shards from duplicates — permanently.', step: 15, unit: '%' },
  ascendant: { name: 'Ascendant', icon: '🌌', desc: '+0.1 to the prestige base — every ascension compounds harder.', step: 0.1, unit: ' base' },
  overflow_resonance: { name: 'Overflow Resonance', icon: '⚡', desc: '+10% to the production ceiling, per level — MULTIPLICATIVE, so the cap scales with your prestige instead of falling behind.', step: 10, unit: '%' },
  facet_yield: { name: 'Facet Bloom', icon: '🔮', desc: '+1 Facet every time you ascend, per level — keeps the meta-tree growing deep into New Game+.', step: 1, unit: ' 🔮/ascent' },
  polymath: { name: 'Polymath', icon: '🧠', desc: 'RULE-CHANGER — dissolves the Workshop’s Doctrine choke: own BOTH Mastery & Variety at once and stack their bonuses. Go tall AND wide.' },
}
