import { useEffect, useRef, useMemo } from 'react'
import { useGame } from './game/store'
import { useOrreryUi } from './orreryUi'
import { glyphOf } from './content/glyphs'
import { RARITY_COLOR } from './three/Gem'

// 2D top-down hex view of the orrery — the lightweight toggle alternative to the 3D floor. Gems walk their
// straight lanes (tweened); hovering a gem (or its list row) lights its path. Honors the shared pause + show-all.
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
  const paused = useOrreryUi((s) => s.paused)
  const hoverId = useOrreryUi((s) => s.hoverId)
  const setHover = useOrreryUi((s) => s.setHover)
  const showAllLines = useOrreryUi((s) => s.showAllLines)
  const orbits = view?.orrery_orbits ?? []
  const cells = view?.orrery_cells ?? []
  const loadout = view?.loadout ?? []
  const tickMs = view?.orrery_tick_ms ?? 1000
  const groupRefs = useRef<(SVGGElement | null)[]>([])
  const orbitsRef = useRef(orbits)
  orbitsRef.current = orbits
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const a2d = (q: number, r: number): [number, number] => [HEXPX * SQ3 * (q + r / 2), HEXPX * 1.5 * r]
  const pathStr = (path: [number, number][]): string => {
    const pts = path.map((c) => { const [x, y] = a2d(c[0], c[1]); return `${x.toFixed(1)},${y.toFixed(1)}` })
    if (path.length) { const [x, y] = a2d(path[0][0], path[0][1]); pts.push(`${x.toFixed(1)},${y.toFixed(1)}`) }
    return pts.join(' ')
  }

  const view2 = useMemo(() => {
    let minX = 0, maxX = 0, minY = 0, maxY = 0
    for (const [q, r] of cells) {
      const [x, y] = a2d(q, r)
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    const pad = HEXPX * 1.4
    return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`
  }, [cells])

  const litCells = useMemo(() => {
    const set = new Set<string>()
    if (hoverId == null) return set
    orbits[loadout.indexOf(hoverId)]?.path.forEach((c) => set.add(`${c[0]},${c[1]}`))
    return set
  }, [hoverId, loadout, orbits])

  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    let t = 0
    const ease = (f: number) => f * f * (3 - 2 * f)
    const loop = (now: number) => {
      const dt = now - prev
      prev = now
      if (!pausedRef.current) t += dt / tickMs
      const base = Math.floor(t)
      const frac = ease(t - base)
      const orbs = orbitsRef.current
      for (let i = 0; i < orbs.length; i++) {
        const orb = orbs[i]
        const g = groupRefs.current[i]
        if (!g || !orb || orb.period === 0 || orb.path.length === 0) continue
        const tt = pausedRef.current ? 0 : base // paused → rest at start cell
        const c0 = orb.path[(orb.phase + tt) % orb.period]
        const c1 = orb.path[(orb.phase + tt + 1) % orb.period]
        if (!c0 || !c1) continue
        const [x0, y0] = a2d(c0[0], c0[1])
        const [x1, y1] = a2d(c1[0], c1[1])
        const x = x0 + (x1 - x0) * (pausedRef.current ? 0 : frac)
        const y = y0 + (y1 - y0) * (pausedRef.current ? 0 : frac)
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
      {/* all lanes (subtle) when toggled on */}
      {showAllLines && orbits.map((orb, i) =>
        orb.path.length > 1 ? <polyline key={`all${loadout[i]}`} points={pathStr(orb.path)} fill="none" stroke="rgba(95,224,198,0.30)" strokeWidth={1.5} /> : null,
      )}
      {/* hovered lane (bright) */}
      {hoverId != null && (() => {
        const orb = orbits[loadout.indexOf(hoverId)]
        const sh = shapes[hoverId]
        return orb && sh && orb.path.length > 1 ? <polyline points={pathStr(orb.path)} fill="none" stroke={RARITY_COLOR[sh.rarity]} strokeWidth={2.5} opacity={0.95} /> : null
      })()}
      {/* gems */}
      {orbits.map((_, i) => {
        const sh = shapes[loadout[i]]
        if (!sh) return null
        return (
          <g
            key={loadout[i]}
            ref={(el) => { groupRefs.current[i] = el }}
            onPointerOver={() => setHover(sh.id)}
            onPointerOut={() => setHover(null)}
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
