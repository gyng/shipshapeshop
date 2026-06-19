import { useEffect, useRef, useState } from 'react'
import { useGame } from './game/store'
import { glyphOf } from './content/glyphs'

// The Orrery: deployed shapes ride a clock ring, advancing 1 cell/tick. Motion is purely visual (tweened
// from the WASM truth — the orbit paths/periods); production + offline are decided in Rust. When two shapes
// share a cell they "meet" (the cell + shapes glow). This renders view.orrery_orbits (parallel to loadout).
export function OrreryBoard() {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const orbits = view?.orrery_orbits ?? []
  const ring = view?.orrery_ring ?? 12
  const tickMs = view?.orrery_tick_ms ?? 1000
  const loadout = view?.loadout ?? []

  const orbitsRef = useRef(orbits)
  orbitsRef.current = orbits
  const groupRefs = useRef<(SVGGElement | null)[]>([])
  const [meetingCells, setMeetingCells] = useState<Set<number>>(new Set())
  const lastTick = useRef(-1)

  const SZ = 300
  const cx = 150
  const cy = 150
  const R = 112
  const cellPos = (i: number): [number, number] => {
    const a = (i / ring) * Math.PI * 2 - Math.PI / 2
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)]
  }

  // Continuous RAF loop: tween each shape between its current and next cell; recompute meetings once per tick.
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const ease = (f: number) => f * f * (3 - 2 * f) // smoothstep so the hop settles into each cell
    const loop = (now: number) => {
      const t = (now - start) / tickMs
      const base = Math.floor(t)
      const frac = ease(t - base)
      const orbs = orbitsRef.current
      for (let i = 0; i < orbs.length; i++) {
        const orb = orbs[i]
        const g = groupRefs.current[i]
        if (!g || !orb || orb.period === 0) continue
        const c0 = orb.path[(orb.phase + base) % orb.period]
        const c1 = orb.path[(orb.phase + base + 1) % orb.period]
        if (c0 == null || c1 == null) continue
        const [x0, y0] = cellPos(c0)
        const [x1, y1] = cellPos(c1)
        const x = x0 + (x1 - x0) * frac
        const y = y0 + (y1 - y0) * frac
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        g.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
      }
      if (base !== lastTick.current) {
        lastTick.current = base
        const byCell = new Map<number, number>()
        for (const orb of orbs) {
          if (!orb || orb.period === 0) continue
          const c = orb.path[(orb.phase + base) % orb.period]
          byCell.set(c, (byCell.get(c) ?? 0) + 1)
        }
        const meets = new Set<number>()
        byCell.forEach((n, c) => {
          if (n >= 2) meets.add(c)
        })
        setMeetingCells((prev) => (prev.size === meets.size && [...meets].every((c) => prev.has(c)) ? prev : meets))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickMs, ring])

  return (
    <svg viewBox={`0 0 ${SZ} ${SZ}`} style={{ width: '100%', maxWidth: 360, display: 'block', margin: '0 auto', touchAction: 'none' }}>
      {/* orbit track */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={1.5} strokeDasharray="2 4" />
      {/* cells (glow on a meeting) */}
      {Array.from({ length: ring }, (_, i) => {
        const [x, y] = cellPos(i)
        const meet = meetingCells.has(i)
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={meet ? 15 : 6}
            fill={meet ? 'rgba(255,207,107,0.20)' : 'rgba(255,255,255,0.04)'}
            stroke={meet ? '#ffcf6b' : 'rgba(255,255,255,0.12)'}
            strokeWidth={meet ? 1.5 : 1}
            style={{ transition: 'r 0.25s ease, fill 0.25s ease, stroke 0.25s ease' }}
          />
        )
      })}
      {/* hub */}
      <circle cx={cx} cy={cy} r={18} fill="rgba(255,255,255,0.03)" stroke="rgba(255,207,107,0.28)" />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={15} fill="#ffcf6b">✦</text>
      {/* orbiting shapes (positioned each frame via ref) */}
      {orbits.map((_, i) => {
        const sh = shapes[loadout[i]]
        return (
          <g key={i} ref={(el) => { groupRefs.current[i] = el }}>
            <circle r={12} fill="rgba(14,15,22,0.92)" stroke="rgba(255,255,255,0.20)" strokeWidth={1} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={15}>{glyphOf(sh?.family ?? '')}</text>
          </g>
        )
      })}
    </svg>
  )
}
