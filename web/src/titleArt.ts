import { create } from 'zustand'

// The 12 hand-made title pieces (optimized to WebP in /public/titles). The player's pick persists across
// sessions; click-to-rotate on the welcome screen and in Settings.
export const TITLE_COUNT = 12
const KEY = 'shapegacha.title'

// The title is RANDOM on every launch (a fresh piece each session); click-to-rotate then steps from there.
function load(): number {
  return Math.floor(Math.random() * TITLE_COUNT)
}

function save(i: number) {
  try {
    localStorage.setItem(KEY, String(i))
  } catch {
    /* no-op */
  }
}

interface TitleStore {
  idx: number
  next: () => void
  prev: () => void
  set: (i: number) => void
}

export const useTitle = create<TitleStore>((set, get) => ({
  idx: load(),
  next: () => {
    const i = (get().idx + 1) % TITLE_COUNT
    save(i)
    set({ idx: i })
  },
  prev: () => {
    const i = (get().idx - 1 + TITLE_COUNT) % TITLE_COUNT
    save(i)
    set({ idx: i })
  },
  set: (i) => {
    save(i)
    set({ idx: i })
  },
}))

export const titleSrc = (i: number) => `${import.meta.env.BASE_URL}titles/title${i + 1}.webp`
