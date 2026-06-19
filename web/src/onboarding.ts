import { create } from 'zustand'

// One-time, dismissible onboarding nudges. The core loop is intentionally obvious (big Pull button); only
// the non-obvious systems (deploy, forge, prestige) get a single Ledger-voiced margin note when they first
// become relevant. Dismissals persist, so a hint never nags twice. Calm, not a tutorial.

const KEY = 'shipshape-hints-v1'

function load(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

interface HintStore {
  dismissed: string[]
  dismiss: (id: string) => void
}

export const useHints = create<HintStore>((set, get) => ({
  dismissed: load(),
  dismiss: (id) => {
    const dismissed = Array.from(new Set([...get().dismissed, id]))
    try {
      localStorage.setItem(KEY, JSON.stringify(dismissed))
    } catch {
      /* ignore */
    }
    set({ dismissed })
  },
}))

// A light, skippable, replayable first-run tour over the now-many systems. It only auto-starts for brand-new
// players (off the Welcome modal); anyone can replay it from Settings. Persisted so it never nags twice.
const TOUR_KEY = 'shipshape-tour-v1'
function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === '1'
  } catch {
    return false
  }
}
function setTourSeen(v: boolean) {
  try {
    localStorage.setItem(TOUR_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

interface TourStore {
  seen: boolean
  running: boolean
  step: number
  start: () => void
  next: () => void
  finish: () => void
  restart: () => void
}

export const useTour = create<TourStore>((set, get) => ({
  seen: tourSeen(),
  running: false,
  step: 0,
  start: () => {
    if (!get().seen) set({ running: true, step: 0 })
  },
  next: () => set({ step: get().step + 1 }),
  finish: () => {
    setTourSeen(true)
    set({ running: false, seen: true })
  },
  restart: () => {
    setTourSeen(false)
    set({ running: true, seen: false, step: 0 })
  },
}))
