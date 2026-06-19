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
