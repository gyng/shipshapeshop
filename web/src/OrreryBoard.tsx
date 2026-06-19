import { useEffect, useRef, useState, useMemo } from 'react'
import { useGame } from './game/store'
import { glyphOf } from './content/glyphs'

// 2D top-down hex view of the orrery — the lightweight toggle alternative to the 3D floor. Gems walk their
// straight lanes (tweened); hovering a gem lights its path. Motion is cosmetic (truth is the WASM path).
const SQ3 = Math.sqrt(3)
const HEXPX = 22

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30)
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return pts.join(' ')
}

export function OrreryBoard() {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const orbits = view?.orrery_orbits ?? []
  const cells = view?.orrery_cells ?? []
  const loadout = view?.loadout ?? []
  const tickMs = view?.orrery_tick_ms ?? 1000
  const [hoverId, setHoverId] = useState<number | null>(null)
  const groupRefs = useRef<(SVGGElement | null)[]>([])
  const orbitsRef = useRef(orbits)
  orbitsRef.current = orbits

  const a2d = (q: number, r: number): [number, number] => [HEXPX * SQ3 * (q + r / 2), HEXPX * 1.5 * r]

  const view2 = useMemo(() => {
    let minX = 0
    let maxX = 0
    let minY = 0
    let maxY = 0
    for (const [q, r] of cells) {
      const [x, y] = a2d(q, r)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    const pad = HEXPX * 1.4
    return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`
  }, [cells])

  const litCells = useMemo(() => {
    const set = new Set<string>()
    if (hoverId == null) return set
    const orb = orbits[loadout.indexOf(hoverId)]
    orb?.path.forEach((c) => set.add(`${c[0]},${c[1]}`))
    return set
  }, [hoverId, loadout, orbits])

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const ease = (f: number) => f * f * (3 - 2 * f)
    const loop = (now: number) => {
      const t = (now - start) / tickMs
      const base = Math.floor(t)
      const frac = ease(t - base)
      const orbs = orbitsRef.current
      for (let i = 0; i < orbs.length; i++) {
        const orb = orbs[i]
        const g = groupRefs.current[i]
        if (!g || !orb || orb.period === 0 || orb.path.length === 0) continue
        const c0 = orb.path[(orb.phase + base) % orb.period]
        const c1 = orb.path[(orb.phase + base + 1) % orb.period]
        if (!c0 || !c1) continue
        const [x0, y0] = a2d(c0[0], c0[1])
        const [x1, y1] = a2d(c1[0], c1[1])
        const x = x0 + (x1 - x0) * frac
        const y = y0 + (y1 - y0) * frac
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        g.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [tickMs])

  return (
    <svg viewBox={view2} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}>
      {/* hex pads */}
      {cells.map(([q, r]) => {
        const [x, y] = a2d(q, r)
        const lit = litCells.has(`${q},${r}`)
        return (
          <polygon
            key={`${q},${r}`}
            points={hexPoints(x, y, HEXPX * 0.96)}
            fill={lit ? 'rgba(255,207,107,0.16)' : 'rgba(255,255,255,0.03)'}
            stroke={lit ? '#ffcf6b' : 'rgba(255,255,255,0.10)'}
            strokeWidth={1}
            style={{ transition: 'fill 0.2s, stroke 0.2s' }}
          />
        )
      })}
      {/* gems */}
      {orbits.map((_, i) => {
        const sh = shapes[loadout[i]]
        if (!sh) return null
        return (
          <g
            key={loadout[i]}
            ref={(el) => { groupRefs.current[i] = el }}
            onPointerOver={() => setHoverId(sh.id)}
            onPointerOut={() => setHoverId(null)}
            style={{ cursor: 'pointer' }}
          >
            <circle r={13} fill="rgba(14,15,22,0.92)" stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={16}>{glyphOf(sh.family)}</text>
          </g>
        )
      })}
    </svg>
  )
}
