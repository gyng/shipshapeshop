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

// Live screen positions (as % of the orrery canvas) of each deployed gem — written by the 3D scene every
// frame, read by the DOM flux-number overlay so a "+N ✦" pops over an actual shape rather than a fixed spot.
// A plain ref (not store state) so the per-frame writes never trigger a React re-render.
export const gemScreens: { current: { x: number; y: number }[] } = { current: [] }

export const useOrreryUi = create<OrreryUi>((set) => ({
  paused: false,
  togglePause: () => set((s) => ({ paused: !s.paused })),
  hoverId: null,
  setHover: (hoverId) => set({ hoverId }),
  showAllLines: false,
  toggleAllLines: () => set((s) => ({ showAllLines: !s.showAllLines })),
}))
