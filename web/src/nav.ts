import { create } from 'zustand'

// The active tab lives as local state in App, but a few places (e.g. the orrery's Euler meter pointing the
// player at the Workshop) need to REQUEST a tab change from outside. This holds a one-shot request the App
// drains in an effect — keeps App's own state authoritative while letting any component deep-link.
export type Tab = 'gacha' | 'room' | 'chatlas' | 'gallery' | 'engine' | 'workshop' | 'forge' | 'shop' | 'ledger'

export const useNav = create<{ pending: Tab | null; goTo: (t: Tab) => void; clear: () => void }>((set) => ({
  pending: null,
  goTo: (t) => set({ pending: t }),
  clear: () => set({ pending: null }),
}))
