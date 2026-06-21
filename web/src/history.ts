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
  t: number // epoch ms when it happened (stamped by recordEvent; drives the Ledger's "at X time")
}

const PKEY = 'shapegacha.pulls'
const EKEY = 'shapegacha.events'
function load<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}

interface HistoryStore {
  pulls: PullRec[]
  events: EventRec[]
  recordPull: (r: PullRec) => void
  recordEvent: (e: Omit<EventRec, 't'>) => void
}

export const useHistory = create<HistoryStore>((set, get) => ({
  pulls: load<PullRec>(PKEY),
  events: load<EventRec>(EKEY),
  recordPull: (r) => {
    const pulls = [r, ...get().pulls].slice(0, 250)
    try {
      localStorage.setItem(PKEY, JSON.stringify(pulls))
    } catch {
      /* no-op */
    }
    set({ pulls })
  },
  // Events are a persisted activity log (forges, milestones, relics, prestige…) — survives reload so you can
  // see what happened while idle/auto-forging. Newest first, capped.
  recordEvent: (e) => {
    const events = [{ ...e, t: Date.now() }, ...get().events].slice(0, 200)
    try {
      localStorage.setItem(EKEY, JSON.stringify(events))
    } catch {
      /* no-op */
    }
    set({ events })
  },
}))
