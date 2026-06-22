import { create } from 'zustand'

// Open/close state for the Cosmetics quick-popup — a compact cosmetics picker reachable from the app bar on
// any tab, so you can change finish/scene/atmosphere/etc. (and buy) without opening the full Shop. The button
// (in the HUD) and the popup (mounted at app root) share this store.
interface CosmeticsQuickStore {
  open: boolean
  setOpen: (v: boolean) => void
}

export const useCosmeticsQuick = create<CosmeticsQuickStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
