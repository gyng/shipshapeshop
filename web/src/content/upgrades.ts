// Display text for the Workshop upgrades (keyed to core/src/content.rs UPGRADES). The effects are
// rule-changing, not just flat multipliers.
// `step`/`unit` (optional, multi-level only) drive the "now → next" delta shown on the card.
// `short` (optional, ≤24 chars) is the compact effect chip shown on the one-line Workshop card; the full
// `desc` moves to the card's title= hover. Plain-language, cozy — NOT a stat dump.
export const UPGRADE_INFO: Record<string, { name: string; desc: string; icon: string; short?: string; step?: number; unit?: string }> = {
  expand_floor: { name: 'Expand the Floor', icon: '🏗️', short: '+2 floor space', desc: '+2 floor space — deploy more (or more exotic) shapes at once.', step: 2, unit: ' χ' },
  genus_resonance: { name: 'Genus Resonance', icon: '🌀', short: '+4%/lvl per hole-type', desc: '+4% production PER LEVEL for every DISTINCT hole-count on your floor — a scaling reward for a varied board (L3 = +12% per genus).' },
  twin_bond: { name: 'Twin Bond', icon: '💞', short: 'Kin pairs ×2', desc: 'Kin-pair synergy doubled (+16% per deployed pair instead of +8%).' },
  patience: { name: 'Patience Rewarded', icon: '🌙', short: '+12h offline cap', desc: '+12h to the offline cap — the Atlas keeps working longer while you’re away.', step: 12, unit: 'h' },
  shard_dividend: { name: 'Shard Dividend', icon: '◈', short: '+50% dup shards', desc: 'Duplicate pulls yield 50% more shards.' },
  forge_mastery: { name: 'Connected-Sum Mastery', icon: '🔨', short: 'Forge: 25 shards', desc: 'Forging costs 25 shards instead of 50.' },
  affinity_bloom: { name: 'Affinity Bloom', icon: '♥', short: 'Bonds +50% faster', desc: 'All bonds grow 50% faster — idle, inspect, and pat alike.' },
  overflow_cap: { name: 'Overflow Capacitor', icon: '⚡', short: '+8%/lvl ceiling', desc: '+8% to the production ceiling, per level — MULTIPLICATIVE, so the cap keeps scaling with your economy instead of falling behind.', step: 8, unit: '%' },
  auto_pull: { name: 'Auto-Pull Servo', icon: '🤖', short: 'Auto-pull toggle', desc: 'Unlocks an auto-pull toggle — the Atlas spends spare Flux on pulls for you (no reveal ceremony, just the haul).' },
  // ── Orrery branch ──
  lens_polish: { name: 'Lens Polish', icon: '🔆', short: '+8%/lvl all lenses', desc: '+8% to EVERY multiplier lens on the orrery, per level — sharpens every ×amplify a shape applies to passing flux.', step: 8, unit: '%' },
  second_lens: { name: 'Second Lens', icon: '✨', short: 'C/R gain ×1.2', desc: 'Common & Rare shapes gain a gentle ×1.2 SECOND effect — the compound kit rares already enjoy, opened to the whole board.' },
  solver_mk2: { name: 'Solver Mk II', icon: '🧭', short: 'Auto-arrange ×3', desc: 'Auto-Arrange searches ~3× harder, packing beams through more multiplier chains for a stronger layout.' },
  offline_efficiency: { name: 'Resonant Idle', icon: '🌙', short: '+15%/lvl idle flux', desc: 'The orrery banks +15% more ORRERY flux while you’re away, per level — your beams keep chaining at higher efficiency offline.', step: 15, unit: '%' },
  // ── Doctrine fork (mutually exclusive — picking one permanently locks the other) ──
  mastery_doctrine: { name: 'Doctrine of Mastery', icon: '⬆️', short: '+4% per ★ (go tall)', desc: 'Go TALL — +4% production per ★ across your deployed shapes. Rewards starring up a focused board. Locks out Variety.' },
  variety_doctrine: { name: 'Doctrine of Variety', icon: '↔️', short: '+5% per family (wide)', desc: 'Go WIDE — +5% production per DISTINCT shape family on your floor. Rewards a broad, varied board. Locks out Mastery.' },
  // ── Deeper levers (each changes a RULE, not a flat ×) ──
  sink_doctrine: { name: 'Sink Doctrine', icon: '🕳️', short: 'Open anchors absorb', desc: 'Cones, disks & cylinders become SINKS — a beam crossing one is boosted ×2.5 and banked on the spot, but stops there (no longer chaining). Lock in a fat beam now, or leave the lane open to compound further.' },
  euler_surplus: { name: 'Euler Surplus', icon: '🧮', short: '+6%/lvl per spare χ', desc: 'Leftover floor budget pays rent — +6% production per LEVEL for each point of Euler-characteristic (χ) headroom you leave UNSPENT, up to 6. Run a lean board (deploy by hand below your budget) and the slack works for you.', step: 6, unit: '%' },
  overpressure_valve: { name: 'Overpressure Valve', icon: '💧', short: 'Over-cap flux → shards', desc: 'The production ceiling stops wasting your overflow — flux above the cap spills into Shards (+10%/level of the over-cap, up to 30%) instead of vanishing. Over-build on purpose to farm shards, or sit under the cap for pure flux.', step: 10, unit: '%' },
  overclock: { name: 'Overclock the Lattice', icon: '🔴', short: '+60% cap, −offline', desc: 'Unlocks a reversible session toggle: +60% production ceiling while you play, BUT offline catch-up is clamped to 4h while ON. For long active sessions — leave it OFF to idle in peace.' },
  mirrored_rim: { name: 'Mirrored Rim', icon: '🪞', short: 'Beams reflect off walls', desc: 'Silver the walls — a beam leaving the grid bounces back inward once per LEVEL (up to 3), so it can re-cross your lenses on the way home. Aim AT the rim and edge cells finally earn their keep.', step: 1, unit: '× reflect' },
}

// Mutually-exclusive doctrine pairs (mirrors core EXCLUSIONS, keyed by name) — drives the "you chose the other
// doctrine" locked-card message instead of a misleading "requires" line.
export const DOCTRINE_EXCLUSIONS: Record<string, string> = {
  mastery_doctrine: 'variety_doctrine',
  variety_doctrine: 'mastery_doctrine',
}
