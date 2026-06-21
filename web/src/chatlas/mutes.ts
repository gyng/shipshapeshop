// Client-side mute list for Chatlas Plus chat. With no backend there's no global moderation, so mute is the
// player's own lever: muted handles' chat lines (and waves) are hidden locally. Persisted on-device, keyed by
// display handle (identities are throwaway, but muting by handle is the affordance players expect).
import { create } from 'zustand'

const KEY = 'shipshape-chatlas-mutes'

function load(): string[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

interface MuteStore {
  muted: string[]
  toggle: (handle: string) => void
  isMuted: (handle: string) => boolean
}

export const useMutes = create<MuteStore>((set, get) => ({
  muted: load(),
  toggle: (handle) => {
    const muted = get().muted.includes(handle) ? get().muted.filter((h) => h !== handle) : [...get().muted, handle]
    try {
      localStorage.setItem(KEY, JSON.stringify(muted))
    } catch {
      /* ignore persistence failure */
    }
    set({ muted })
  },
  isMuted: (handle) => get().muted.includes(handle),
}))
