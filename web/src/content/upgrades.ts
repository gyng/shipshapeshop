// Display text for the Workshop upgrades (keyed to core/src/content.rs UPGRADES). The effects are
// rule-changing, not just flat multipliers.
export const UPGRADE_INFO: Record<string, { name: string; desc: string; icon: string }> = {
  expand_floor: { name: 'Expand the Floor', icon: '🏗️', desc: '+2 floor space — deploy more (or more exotic) shapes at once.' },
  genus_resonance: { name: 'Genus Resonance', icon: '🌀', desc: '+6% production for every DISTINCT hole-count among your deployed shapes — rewards a varied floor.' },
  twin_bond: { name: 'Twin Bond', icon: '💞', desc: 'Kin-pair synergy doubled (+16% per deployed pair instead of +8%).' },
  patience: { name: 'Patience Rewarded', icon: '🌙', desc: '+12h to the offline cap — the Atlas keeps working longer while you’re away.' },
  shard_dividend: { name: 'Shard Dividend', icon: '◈', desc: 'Duplicate pulls yield 50% more shards.' },
  forge_mastery: { name: 'Connected-Sum Mastery', icon: '🔨', desc: 'Forging costs 25 shards instead of 50.' },
  affinity_bloom: { name: 'Affinity Bloom', icon: '♥', desc: 'All bonds grow 50% faster — idle, inspect, and pat alike.' },
  overflow_cap: { name: 'Overflow Capacitor', icon: '⚡', desc: '+300 Flux/hr to the production ceiling — keeps the numbers climbing past the cap.' },
}
