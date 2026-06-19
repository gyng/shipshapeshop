import { create } from 'zustand'

// Which shape's detail sheet is open (null = none). A tiny global store so ANY screen — Gallery, Pull
// preview, Engine floor, Room — can open a shape's full details without prop-drilling.
export const useInspector = create<{ id: number | null; set: (id: number | null) => void }>((set) => ({
  id: null,
  set: (id) => set({ id }),
}))
