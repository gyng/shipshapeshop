import { create } from 'zustand'
import type { RarityName } from './game/store'

// Player-facing history: a persisted gacha pull log (newest first) + a session events feed (forges, relics,
// prestige…). Display-only flavour — not the authoritative save.
export interface PullRec {
  id: number
  nick: string
  rarity: RarityName
  isNew: boolean
}
export interface EventRec {
  icon: string
  text: string
  color?: string
}

const PKEY = 'shapegacha.pulls'
function loadPulls(): PullRec[] {
  try {
    return JSON.parse(localStorage.getItem(PKEY) || '[]')
  } catch {
    return []
  }
}

interface HistoryStore {
  pulls: PullRec[]
  events: EventRec[]
  recordPull: (r: PullRec) => void
  recordEvent: (e: EventRec) => void
}

export const useHistory = create<HistoryStore>((set, get) => ({
  pulls: loadPulls(),
  events: [],
  recordPull: (r) => {
    const pulls = [r, ...get().pulls].slice(0, 250)
    try {
      localStorage.setItem(PKEY, JSON.stringify(pulls))
    } catch {
      /* no-op */
    }
    set({ pulls })
  },
  recordEvent: (e) => set({ events: [e, ...get().events].slice(0, 120) }),
}))
