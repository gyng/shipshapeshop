// The player's "Curator Rank" — a vanity prestige badge derived from real collection progress. Display-only
// (never feeds the economy), so it lives in the feel layer. Ladder: F → D → C → B → A → S → SS → ? (secret apex).

export const RANKS = ['F', 'D', 'C', 'B', 'A', 'S', 'SS', '?'] as const
const THRESH = [0, 25, 55, 90, 130, 175, 220, 300]

export const RANK_COLOR: Record<string, string> = {
  F: '#8a90a8',
  D: '#9aa6c2',
  C: '#5fe0c6',
  B: '#7fd0ff',
  A: '#b985ff',
  S: '#ffb86b',
  SS: '#ff5d8f',
  '?': '#ffd76b',
}

interface RankInput {
  distinct_owned: number
  relics_owned: number
  discovered: boolean[]
  bond_levels: number[]
  ng_cycle: number
  total_pulls: number
}

export function curatorScore(v: RankInput): number {
  const recipes = v.discovered.filter(Boolean).length
  const maxedBonds = v.bond_levels.filter((b) => b >= 5).length
  return Math.round(
    v.distinct_owned * 3 + // collection is the heart of the rank
      v.relics_owned * 5 + // relics are the rare prestige tier
      recipes * 2 + // forge discoveries
      maxedBonds * 4 + // maxed character bonds
      v.ng_cycle * 30 + // prestige cycles (New Game+)
      Math.floor(v.total_pulls / 50), // a slow nod to sheer volume
  )
}

export function curatorRank(v: RankInput): { rank: string; score: number; tier: number; next: string | null; toNext: number } {
  const score = curatorScore(v)
  let tier = 0
  for (let i = 0; i < THRESH.length; i++) if (score >= THRESH[i]) tier = i
  const next = tier < RANKS.length - 1 ? RANKS[tier + 1] : null
  const toNext = next ? THRESH[tier + 1] - score : 0
  return { rank: RANKS[tier], score, tier, next, toNext }
}
