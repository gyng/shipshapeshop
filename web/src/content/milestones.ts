// Display text for achievements ("milestones", keyed to core/src/content.rs MILESTONES). Each latches
// permanently the first time its condition holds and grants a permanent gameplay EFFECT (the truth lives in
// Rust; here we only name + format it). The checklist itself is the dopamine; the effect is the cherry.

// The effect kinds the Rust core emits per achievement (milestones_json → MilestoneDef.kind).
export type MilestoneKind = 'production' | 'offline' | 'shards' | 'forge' | 'affinity' | 'euler' | 'flux'

const fmtNum = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

// A short, human reward label for an achievement's effect — shown beside it in the Ledger + the unlock toast.
// `value` is in the effect's natural unit (fraction for the %-effects; hours / floor-count / flux otherwise).
export function milestoneReward(kind: MilestoneKind, value: number): string {
  switch (kind) {
    case 'production':
      return `+${Math.round(value * 100)}% production`
    case 'offline':
      return `+${value}h away cap`
    case 'shards':
      return `+${Math.round(value * 100)}% shards`
    case 'forge':
      return `−${Math.round(value * 100)}% forge cost`
    case 'affinity':
      return `+${Math.round(value * 100)}% bond speed`
    case 'euler':
      return `+${value} floor space`
    case 'flux':
      return `+${fmtNum(value)} ✦ once`
    default:
      return ''
  }
}

// A glyph per effect kind — a quick visual tell for "what does this reward me" in dense lists.
export const MILESTONE_KIND_ICON: Record<MilestoneKind, string> = {
  production: '⚙️',
  offline: '🌙',
  shards: '🔹',
  forge: '🔥',
  affinity: '💗',
  euler: '🧩',
  flux: '✦',
}

export const MILESTONE_INFO: Record<string, { name: string; icon: string }> = {
  // ── the original 9 ──
  own_10: { name: 'Collector — own 10 shapes', icon: '🔟' },
  own_25: { name: 'Curator — own 25 shapes', icon: '🗂️' },
  core_complete: { name: 'The Atlas is full — all core shapes', icon: '🏆' },
  forge_3: { name: 'Glued — discover 3 forge recipes', icon: '🔨' },
  bond_5: { name: 'Soulbound — reach Bond 5 with anyone', icon: '💖' },
  kin_3: { name: 'Matchmaker — 3 kin pairs deployed at once', icon: '💞' },
  all_relics: { name: 'Reference Wing complete — every Relic', icon: '🫖' },
  platonic: { name: 'Platonic ideal — all five solids', icon: '⬛' },
  ascend: { name: 'Ascended — reach New Game+', icon: '🌌' },
  // ── collection ──
  own_40: { name: 'Almost everything — own 40 core shapes', icon: '📚' },
  all_commons: { name: 'Common ground — every Common shape', icon: '⚪' },
  all_rares: { name: 'Rare earth — every Rare shape', icon: '🔵' },
  all_epics: { name: 'Epic sweep — every Epic shape', icon: '🟣' },
  all_ur: { name: 'Beyond rare — every Ultra shape', icon: '🌟' },
  first_ur: { name: 'First light — pull your first Ultra', icon: '✨' },
  // ── stars (duplicates) ──
  first_star: { name: 'Twinkle — star a shape for the first time', icon: '⭐' },
  star_master: { name: 'Supernova — take a shape to ★★★★★', icon: '💫' },
  constellation: { name: 'Constellation — 10 shapes starred', icon: '🌠' },
  // ── economy ──
  flux_million: { name: 'Millionaire — a million lifetime Flux', icon: '💰' },
  flux_billion: { name: 'Billionaire — a billion lifetime Flux', icon: '🤑' },
  flux_trillion: { name: 'Flux tycoon — a trillion lifetime Flux', icon: '🏦' },
  // ── shards ──
  shards_100: { name: 'Shard saver — 100 lifetime shards', icon: '🔹' },
  shards_5k: { name: 'Shard hoard — 5,000 lifetime shards', icon: '💠' },
  shards_50k: { name: 'Shard baron — 50,000 lifetime shards', icon: '👑' },
  flush: { name: 'Flush — bank 2,000 shards', icon: '🪙' },
  // ── forge ──
  first_forge: { name: 'First fusion — forge anything once', icon: '🔥' },
  forge_10: { name: 'Smith — forge 10 times', icon: '⚒️' },
  forge_50: { name: 'Master smith — forge 50 times', icon: '🛠️' },
  all_recipes: { name: 'Recipe book — discover every forge recipe', icon: '📖' },
  fusion_adept: { name: 'Fusion adept — forge 5 different shapes', icon: '🧪' },
  // ── bonds ──
  first_bond: { name: 'New friend — reach Bond 1 with anyone', icon: '🤝' },
  soulbound_3: { name: 'Inner circle — Bond 5 with three', icon: '💕' },
  soulbound_5: { name: 'Beloved — Bond 5 with five', icon: '💗' },
  soulbound_10: { name: 'Heart of gold — Bond 5 with ten', icon: '💞' },
  // ── orrery / board ──
  deploy_5: { name: 'Getting set up — deploy 5 shapes', icon: '🔩' },
  deploy_10: { name: 'Full workshop — deploy 10 shapes', icon: '🏗️' },
  synergy_5: { name: 'Kindred — 5 kin pairs at once', icon: '🔗' },
  floor_full: { name: 'No vacancy — fill your floor budget', icon: '🧩' },
  // ── shop / cosmetics ──
  first_cosmetic: { name: 'Window shopping — buy your first cosmetic', icon: '🛍️' },
  cosmetics_5: { name: 'Wardrobe — own 5 cosmetics', icon: '🧥' },
  cosmetics_15: { name: 'Stylist — own 15 cosmetics', icon: '👗' },
  equip_3: { name: 'Dressed up — equip 3 cosmetic slots', icon: '🎀' },
  fully_dressed: { name: 'Full ensemble — equip every cosmetic slot', icon: '💅' },
  redecorated: { name: 'Redecorated — change your scene', icon: '🌅' },
  // ── prestige ──
  ascend_2: { name: 'Twice around — reach New Game+2', icon: '🔄' },
  ascend_3: { name: 'Veteran — reach New Game+3', icon: '🎖️' },
  reach_4d: { name: 'Into the fourth — unlock 4D', icon: '🧊' },
  // ── gacha ──
  pull_100: { name: 'Regular — 100 pulls', icon: '🎰' },
  pull_1000: { name: 'High roller — 1,000 pulls', icon: '🎲' },
  ur_5: { name: 'Lucky star — pull 5 Ultras', icon: '🍀' },
  // ── dedication / meta ──
  completionist: { name: 'Completionist — full Atlas + every Relic', icon: '🥇' },
  grand_tour: { name: 'Grand tour — complete a New Game+ run', icon: '🗺️' },
  devoted: { name: 'Devoted — full Atlas + five soulmates', icon: '😇' },
}
