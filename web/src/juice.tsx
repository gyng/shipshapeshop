import { create } from 'zustand'

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
