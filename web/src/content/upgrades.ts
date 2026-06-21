// Display text for the Workshop upgrades (keyed to core/src/content.rs UPGRADES). The effects are
// rule-changing, not just flat multipliers.
// `step`/`unit` (optional, multi-level only) drive the "now → next" delta shown on the card.
export const UPGRADE_INFO: Record<string, { name: string; desc: string; icon: string; step?: number; unit?: string }> = {
  expand_floor: { name: 'Expand the Floor', icon: '🏗️', desc: '+2 floor space — deploy more (or more exotic) shapes at once.', step: 2, unit: ' χ' },
  genus_resonance: { name: 'Genus Resonance', icon: '🌀', desc: '+6% production for every DISTINCT hole-count among your deployed shapes — rewards a varied floor.' },
  twin_bond: { name: 'Twin Bond', icon: '💞', desc: 'Kin-pair synergy doubled (+16% per deployed pair instead of +8%).' },
  patience: { name: 'Patience Rewarded', icon: '🌙', desc: '+12h to the offline cap — the Atlas keeps working longer while you’re away.', step: 12, unit: 'h' },
  shard_dividend: { name: 'Shard Dividend', icon: '◈', desc: 'Duplicate pulls yield 50% more shards.' },
  forge_mastery: { name: 'Connected-Sum Mastery', icon: '🔨', desc: 'Forging costs 25 shards instead of 50.' },
  affinity_bloom: { name: 'Affinity Bloom', icon: '♥', desc: 'All bonds grow 50% faster — idle, inspect, and pat alike.' },
  overflow_cap: { name: 'Overflow Capacitor', icon: '⚡', desc: '+36K Flux/hr to the production ceiling, per level — keeps the numbers climbing past the cap.', step: 36000, unit: ' ✦/hr' },
  auto_pull: { name: 'Auto-Pull Servo', icon: '🤖', desc: 'Unlocks an auto-pull toggle — the Atlas spends spare Flux on pulls for you (no reveal ceremony, just the haul).' },
  // ── Orrery branch ──
  lens_polish: { name: 'Lens Polish', icon: '🔆', desc: '+8% to EVERY multiplier lens on the orrery, per level — sharpens every ×amplify a shape applies to passing flux.', step: 8, unit: '%' },
  second_lens: { name: 'Second Lens', icon: '✨', desc: 'Common & Rare shapes gain a gentle ×1.2 SECOND effect — the compound kit rares already enjoy, opened to the whole board.' },
  solver_mk2: { name: 'Solver Mk II', icon: '🧭', desc: 'Auto-Arrange searches ~3× harder, packing beams through more multiplier chains for a stronger layout.' },
  offline_efficiency: { name: 'Resonant Idle', icon: '🌙', desc: 'The orrery banks +15% more ORRERY flux while you’re away, per level — your beams keep chaining at higher efficiency offline.', step: 15, unit: '%' },
}
