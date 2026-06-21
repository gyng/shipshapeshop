import { create } from 'zustand'
import type { CSSProperties } from 'react'

// Floating "+xxx" reward numbers — the idle-game dopamine drip. Any code can call useFloaters.getState().spawn().
export interface Floater {
  id: number
  text: string
  color: string
  x: number
  y: number
  big: boolean
}

let _id = 0

// A tiny pulse the Shop/Workshop fire on a purchase so their corner mascot reacts (cheer line + flux burst).
export const useMascotCheer = create<{ n: number; cheer: () => void }>((set) => ({ n: 0, cheer: () => set((s) => ({ n: s.n + 1 })) }))

interface FloaterStore {
  items: Floater[]
  spawn: (text: string, opts?: { color?: string; x?: number; y?: number; big?: boolean }) => void
  remove: (id: number) => void
}

export const useFloaters = create<FloaterStore>((set, get) => ({
  items: [],
  spawn: (text, opts = {}) => {
    const id = ++_id
    const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 400
    const x = (opts.x ?? cx) + (Math.random() * 36 - 18)
    const y = (opts.y ?? 150) + (Math.random() * 16 - 8)
    set((s) => ({ items: [...s.items, { id, text, color: opts.color ?? '#ffcf6b', x, y, big: !!opts.big }] }))
    setTimeout(() => get().remove(id), opts.big ? 1700 : 1500)
  },
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}))

export function Floaters() {
  const items = useFloaters((s) => s.items)
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 50 }}>
      {items.map((f) => (
        <span key={f.id} className={f.big ? 'floater floater-big' : 'floater'} style={{ left: f.x, top: f.y, color: f.color }}>
          {f.text}
        </span>
      ))}
    </div>
  )
}

// ── Spark particles ──────────────────────────────────────────────────────────
// A real graphical burst: glowing orbs fan out along an arc (upward bias = a fountain), varying in size +
// hue, then shrink + fade. Each carries its trajectory as CSS custom props consumed by the `spark` keyframe.
export interface Spark {
  id: number
  x: number
  y: number
  dx: number // horizontal drift to landing
  rise: number // apex height (negative = up)
  fall: number // final y vs origin (positive = fallen under gravity)
  sz: number
  col: string
  dur: number
  delay: number
  rot: number
}

interface SparkStore {
  sparks: Spark[]
  burst: (x: number, y: number, opts?: { count?: number; power?: number; hues?: string[] }) => void
}

const SPARK_HUES = ['#fff6dc', '#ffe6a8', '#ffcf6b', '#ffb86b']

export const useSparks = create<SparkStore>((set) => ({
  sparks: [],
  // Each spark is independent: random horizontal speed, its OWN apex, gravity fall, stagger + spin. Reads as a
  // little firework/fountain rather than one expanding ring.
  burst: (x, y, opts = {}) => {
    const n = Math.min(46, opts.count ?? 14)
    const power = opts.power ?? 1
    const hues = opts.hues ?? SPARK_HUES
    const made: Spark[] = []
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1
      made.push({
        id: ++_id,
        x,
        y,
        dx: dir * (8 + Math.random() * 72) * (0.55 + 0.55 * power),
        rise: -(18 + Math.random() * 58) * (0.7 + 0.5 * power),
        fall: (12 + Math.random() * 64) * (0.7 + 0.6 * power),
        sz: (5 + Math.random() * 8) * (0.85 + 0.4 * power),
        col: hues[(Math.random() * hues.length) | 0],
        dur: 800 + Math.random() * 720,
        delay: Math.random() * 160,
        rot: (Math.random() * 2 - 1) * 130,
      })
    }
    set((s) => ({ sparks: [...s.sparks.slice(-90), ...made] }))
    const ids = new Set(made.map((m) => m.id))
    setTimeout(() => set((s) => ({ sparks: s.sparks.filter((p) => !ids.has(p.id)) })), 1900)
  },
}))

// Celebratory spark burst centred on a button/element — the shared "you bought it" pop for the Shop and the
// Workshop. Centralises the getBoundingClientRect → burst so every purchase reads the same.
export function purchaseBurst(el: HTMLElement | null | undefined, opts: { hues?: string[]; count?: number; power?: number } = {}) {
  if (!el) return
  const r = el.getBoundingClientRect()
  useSparks.getState().burst(r.left + r.width / 2, r.top + r.height / 2, opts)
}

export function Sparks() {
  const sparks = useSparks((s) => s.sparks)
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 55 }}>
      {sparks.map((p) => (
        <span
          key={p.id}
          className="spark"
          style={
            {
              left: p.x,
              top: p.y,
              '--dx': `${p.dx}px`,
              '--rise': `${p.rise}px`,
              '--fall': `${p.fall}px`,
              '--sz': `${p.sz}px`,
              '--col': p.col,
              '--dur': `${p.dur}ms`,
              '--delay': `${p.delay}ms`,
              '--rot': `${p.rot}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
