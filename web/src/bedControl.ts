// Imperative controls the orrery bed driver registers so the "under the hood" inspector can drive it — reroll
// the current section, cycle/pick the sub-style, mute individual layers, or return to automatic rotation. Null
// when no bed is mounted.
export type BedLayer = 'drums' | 'bass' | 'chords' | 'arp'

export interface BedControl {
  /** Force a fresh section RIGHT NOW (re-rolls progression / tempo / voicing and crossfades to it). */
  advance?: () => void
  /** Pin the next sub-style and crossfade into it immediately. */
  cycleStyle?: () => void
  /** Pin a specific sub-style by id and crossfade into it immediately. */
  pickStyle?: (id: string) => void
  /** Drop any pinned style — back to the loadout-driven automatic rotation (also rerolls). */
  clearStyle?: () => void
  /** Solo/mute a layer of the bed (presentation only — for auditioning what each part is doing). */
  setLayerMute?: (layer: BedLayer, muted: boolean) => void
  /** Current mute state of each layer. */
  getLayerMute?: () => Record<BedLayer, boolean>
}

export const bedControl: BedControl = {}
