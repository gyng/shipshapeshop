import { create } from 'zustand'

// Dismissible help/intro blurbs. Each HelpNote has a stable id; dismissing hides it forever (persisted).
// Settings ▸ "Show all tips again" resets them.
const KEY = 'shapegacha.help-dismissed'

function load(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

interface HelpStore {
  dismissed: string[]
  dismiss: (id: string) => void
  reset: () => void
}

export const useHelp = create<HelpStore>((set, get) => ({
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
  reset: () => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
    set({ dismissed: [] })
  },
}))
