import { useMemo } from 'react'
import { useGame } from './game/store'
import { useOrreryUi } from './orreryUi'
import { glyphOf } from './content/glyphs'
import { RARITY_COLOR } from './three/Gem'

// 2D top-down hex view of the orrery — the lightweight toggle alternative to the 3D floor. Shapes are
// stationary on their cells; hovering one (or its list row) outlines it. The 3D view animates the flux itself.
const SQ3 = Math.sqrt(3)
const HEXPX = 22
const DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
const hexDist = (q: number, r: number) => (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2
const ACT_COL: Record<string, string> = { multiply: '#ffcf6b', amplify: '#ffcf6b', redirect: '#b98cff', split: '#5fe0c6', absorb: '#ff6b8a', pass: '#ffcf6b' }

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
  const hoverId = useOrreryUi((s) => s.hoverId)
  const setHover = useOrreryUi((s) => s.setHover)
  const emitters = view?.flux_emitters ?? []
  const cells = view?.orrery_cells ?? []
  const loadout = view?.loadout ?? []
  const radius = view?.orrery_radius ?? 4

  const a2d = (q: number, r: number): [number, number] => [HEXPX * SQ3 * (q + r / 2), HEXPX * 1.5 * r]

  // occupant lookup + a beam trace mirroring flux::trace, so the 2D view shows the same flowing flux as the 3D.
  const occ = useMemo(() => { const m = new Map<string, (typeof emitters)[number]>(); for (const e of emitters) m.set(`${e.cell[0]},${e.cell[1]}`, e); return m }, [emitters])
  const tracePts = (sq: number, sr: number, dir0: number): string => {
    const out: string[] = [a2d(sq, sr).map((n) => n.toFixed(1)).join(',')]
    let q = sq, r = sr, dir = dir0
    for (let s = 0; s < 24; s++) {
      q += DIRS[dir][0]; r += DIRS[dir][1]
      out.push(a2d(q, r).map((n) => n.toFixed(1)).join(','))
      if (hexDist(q, r) > radius) break
      const e = occ.get(`${q},${r}`)
      if (e) {
        if (e.act === 'absorb' || e.act2 === 'absorb') break
        const redir = e.act === 'redirect' ? e.act_turn : e.act2 === 'redirect' ? e.act2_turn : 0
        if (redir) dir = (((dir + redir) % 6) + 6) % 6
      }
    }
    return out.join(' ')
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

  return (
    <svg viewBox={view2} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}>
      {/* the placeable floor cells */}
      {cells.map(([q, r]) => {
        const [x, y] = a2d(q, r)
        return (
          <polygon
            key={`${q},${r}`}
            points={hexPoints(x, y, HEXPX * 0.96)}
            fill="rgba(255,255,255,0.03)"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={1}
          />
        )
      })}
      {/* flux beams — each emitter's traced path(s); round bodies/scatter fan all six, beams fire their facing */}
      {emitters.map((e, i) => {
        const sh = shapes[loadout[i]]
        if (!sh) return null
        const hov = hoverId === sh.id
        const dirs = e.emit === 'rotating' || e.emit === 'scatter' ? [0, 1, 2, 3, 4, 5] : [e.dir]
        const col = ACT_COL[e.act] ?? '#ffcf6b'
        return (
          <g key={`beam-${loadout[i]}`}>
            {dirs.map((d) => (
              <polyline
                key={d}
                points={tracePts(e.cell[0], e.cell[1], d)}
                fill="none"
                stroke={col}
                strokeWidth={hov ? 2.4 : 1.3}
                strokeOpacity={hov ? 0.9 : 0.38}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ strokeDasharray: '3 7', animation: 'flux-flow 0.7s linear infinite' }}
              />
            ))}
          </g>
        )
      })}
      {/* stationary gems at their placement cells */}
      {emitters.map((e, i) => {
        const sh = shapes[loadout[i]]
        if (!sh) return null
        const [x, y] = a2d(e.cell[0], e.cell[1])
        return (
          <g
            key={loadout[i]}
            transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
            onPointerOver={() => setHover(sh.id)}
            onPointerOut={() => setHover(null)}
            style={{ cursor: 'pointer' }}
          >
            <circle r={13} fill="rgba(14,15,22,0.92)" stroke={hoverId === sh.id ? RARITY_COLOR[sh.rarity] : 'rgba(255,255,255,0.22)'} strokeWidth={hoverId === sh.id ? 2 : 1} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={16}>{glyphOf(sh.family)}</text>
          </g>
        )
      })}
    </svg>
  )
}
