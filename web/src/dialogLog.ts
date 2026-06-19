import { create } from 'zustand'

// A running log of EVERY character line the player has heard — tap-to-chat, inspector greetings, idle
// chatter, and cutscene dialogue all feed it. Viewable from a HUD button. Capped, session-only (flavour).
export interface DialogEntry {
  nick: string
  line: string
  color: string
}

interface DialogLogStore {
  entries: DialogEntry[]
  open: boolean
  log: (e: DialogEntry) => void
  setOpen: (v: boolean) => void
}

export const useDialogLog = create<DialogLogStore>((set, get) => ({
  entries: [],
  open: false,
  log: (e) => {
    const prev = get().entries
    // skip an exact immediate repeat (e.g. re-render echoes)
    const last = prev[prev.length - 1]
    if (last && last.nick === e.nick && last.line === e.line) return
    set({ entries: [...prev.slice(-149), e] })
  },
  setOpen: (v) => set({ open: v }),
}))
