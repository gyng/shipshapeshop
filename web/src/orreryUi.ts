import { create } from 'zustand'

// Shared orrery view state (not game truth — pure presentation): pause the clock, which shape's lane is
// highlighted (hover from the 3D scene OR the active list), and whether to show every lane at once.
interface OrreryUi {
  paused: boolean
  togglePause: () => void
  hoverId: number | null
  setHover: (id: number | null) => void
  showAllLines: boolean
  toggleAllLines: () => void
}

export const useOrreryUi = create<OrreryUi>((set) => ({
  paused: false,
  togglePause: () => set((s) => ({ paused: !s.paused })),
  hoverId: null,
  setHover: (hoverId) => set({ hoverId }),
  showAllLines: false,
  toggleAllLines: () => set((s) => ({ showAllLines: !s.showAllLines })),
}))
