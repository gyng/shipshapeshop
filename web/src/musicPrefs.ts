import { create } from 'zustand'
import { STYLES } from './orreryBed'

// Player preferences for the generative bed: which premium styles are UNLOCKED (shop opt-in purchases), which
// styles are opted OUT of the rotation (settings), and whether per-section instrument variation is on. Pure
// presentation/feel — persisted in localStorage, never in the (Rust) save. The shop writes `owned` on purchase;
// settings + shop both read it for equip status. Base (non-premium) styles are always owned.
const K = { owned: 'shipshape-music-owned', disabled: 'shipshape-music-disabled', instr: 'shipshape-music-instr' }
const readObj = (k: string): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(k) || '{}')
  } catch {
    return {}
  }
}
const writeObj = (k: string, v: Record<string, boolean>) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

interface MusicPrefs {
  owned: Record<string, boolean> // unlocked PREMIUM styles (base styles are implicitly owned)
  disabled: Record<string, boolean> // styles opted OUT of the rotation
  instrumentVariation: boolean // per-section electric-piano/pad timbre drift on/off
  /** Unlock a premium style (called by the shop on purchase). */
  unlock: (id: string) => void
  /** Lock a premium style again (refund / testing). */
  lock: (id: string) => void
  /** Opt a style in/out of the rotation. */
  toggleStyle: (id: string) => void
  setInstrumentVariation: (v: boolean) => void
  /** A style is owned if it isn't premium, or it's been unlocked. */
  isOwned: (id: string) => boolean
  /** A style actually rotates if it's owned AND not opted out. */
  isEnabled: (id: string) => boolean
  /** The ids the rotation may use (owned ∧ not disabled). */
  enabledStyleIds: () => string[]
}

export const useMusicPrefs = create<MusicPrefs>((set, get) => ({
  owned: readObj(K.owned),
  disabled: readObj(K.disabled),
  instrumentVariation: localStorage.getItem(K.instr) !== '0',
  unlock: (id) => {
    const owned = { ...get().owned, [id]: true }
    writeObj(K.owned, owned)
    set({ owned })
  },
  lock: (id) => {
    const owned = { ...get().owned, [id]: false }
    writeObj(K.owned, owned)
    set({ owned })
  },
  toggleStyle: (id) => {
    const disabled = { ...get().disabled, [id]: !get().disabled[id] }
    writeObj(K.disabled, disabled)
    set({ disabled })
  },
  setInstrumentVariation: (v) => {
    try {
      localStorage.setItem(K.instr, v ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ instrumentVariation: v })
  },
  isOwned: (id) => {
    const style = STYLES.find((s) => s.id === id)
    return !style?.premium || !!get().owned[id]
  },
  isEnabled: (id) => get().isOwned(id) && !get().disabled[id],
  enabledStyleIds: () => STYLES.filter((s) => get().isEnabled(s.id)).map((s) => s.id),
}))
