import { create } from 'zustand'
import type { Arrangement } from './orreryBed'

// A tiny live read-out of the orrery music engine, published by the bed driver and shown in the audio
// settings "under the hood" inspector. It mirrors what is actually PLAYING (not just what would play).
export interface BedStatus {
  /** True while the bed driver is mounted and audible (orrery open, ≥1 shape, not muted/paused). */
  playing: boolean
  /** The arrangement currently on the audible deck (null when nothing is mounted/playing). */
  current: Arrangement | null
  /** Bars between section crossfades — so the inspector can say how often the mood shifts. */
  sectionBars: number
  /** Live Transport position, published in sync with the audio (for the beat meter). */
  step16: number // current sixteenth within the bar (0–15)
  sectionBar: number // current bar within the section (0 … sectionBars-1) → progress toward the next crossfade
  chordIdx: number // index into the current progression of the chord actually playing now (−1 when silent)
  publish: (s: Partial<Omit<BedStatus, 'publish'>>) => void
}

export const useBedStatus = create<BedStatus>((set) => ({
  playing: false,
  current: null,
  sectionBars: 8,
  step16: 0,
  sectionBar: 0,
  chordIdx: -1,
  publish: (s) => set(s),
}))
