// Display text for milestones (keyed to core/src/content.rs MILESTONES). Each latches permanently and adds a
// small global production bonus — the classic idle "achievement multiplier" + a satisfying checklist.
export const MILESTONE_INFO: Record<string, { name: string; icon: string }> = {
  own_10: { name: 'Collector — own 10 shapes', icon: '🔟' },
  own_25: { name: 'Curator — own 25 shapes', icon: '🗂️' },
  core_complete: { name: 'The Atlas is full — all 41 core shapes', icon: '🏆' },
  forge_3: { name: 'Glued — discover 3 forge recipes', icon: '🔨' },
  bond_5: { name: 'Soulbound — reach Bond 5 with anyone', icon: '💖' },
  kin_3: { name: 'Matchmaker — 3 kin pairs deployed at once', icon: '💞' },
  all_relics: { name: 'Reference Wing complete — every Relic', icon: '🫖' },
  platonic: { name: 'Platonic ideal — all five solids', icon: '⬛' },
  ascend: { name: 'Recrystallized — reach New Game+', icon: '🌌' },
}
