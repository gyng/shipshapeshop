import { useState } from 'react'
import { useGame } from './game/store'
import { useT } from './i18n'
import { fmt } from './format'
import { glyphOf } from './content/glyphs'
import { RARITY_COLOR } from './three/Gem'
import { Orrery3D } from './three/Orrery3D'
import { OrreryBoard } from './OrreryBoard'
import { useOrreryUi } from './orreryUi'

// Compact multiplier chips for the top overlay — only the multipliers that are actually pulling their weight.
function compactMults(view: ReturnType<typeof useGame.getState>['view'], tr: (k: string) => string): { label: string; v: number }[] {
  if (!view) return []
  const rows: [string, number][] = [
    [tr('orrery.m.effects'), view.mult_shape_effects],
    [tr('orrery.m.meet'), view.mult_synergy],
    [tr('orrery.m.bond'), view.mult_bond],
    [tr('orrery.m.set'), view.mult_set],
    [tr('orrery.m.prestige'), view.mult_prestige],
    [tr('orrery.m.facet'), view.mult_facet],
  ]
  return rows.filter(([, v]) => v > 1.0001).map(([label, v]) => ({ label, v }))
}

// A compact timeline: one column per tick of the system period, marking ticks where shapes meet (≥2 share a cell).
function OrreryTimeline() {
  const view = useGame((s) => s.view)
  const tr = useT()
  if (!view) return null
  const L = Math.max(1, view.orrery_period)
  const orbits = view.orrery_orbits
  const meetTicks: boolean[] = []
  for (let t = 0; t < L; t++) {
    const byCell = new Map<string, number>()
    for (const o of orbits) {
      if (o.period === 0 || o.path.length === 0) continue
      const c = o.path[(o.phase + t) % o.period]
      if (!c) continue
      const k = `${c[0]},${c[1]}`
      byCell.set(k, (byCell.get(k) ?? 0) + 1)
    }
    meetTicks.push([...byCell.values()].some((n) => n >= 2))
  }
  return (
    <div className="orrery-panel orrery-bottom">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>{tr('orrery.timeline')} · {L}</span>
        <div style={{ display: 'flex', gap: 3, flex: 1 }}>
          {meetTicks.map((m, t) => (
            <div
              key={t}
              title={`${tr('orrery.tick')} ${t + 1}${m ? ' · ♪' : ''}`}
              style={{ flex: 1, height: 16, borderRadius: 3, background: m ? 'var(--c-accent-gold)' : 'var(--c-surface-4)', boxShadow: m ? '0 0 6px rgba(255,207,107,0.6)' : 'none' }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// The right-panel detail for the selected deployed shape: tune its orbit phase (timing) + direction (rotation),
// reset to the topology default, or recall it to the library.
function OrbitDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const undeploy = useGame((s) => s.undeploy)
  const setPhase = useGame((s) => s.setPhase)
  const rotateLane = useGame((s) => s.rotateLane)
  const resetOrbit = useGame((s) => s.resetOrbit)
  const tr = useT()
  const sh = shapes[id]
  if (!view || !sh) return null
  const slot = view.loadout.indexOf(id)
  const orb = view.orrery_orbits[slot]
  if (!orb) return null
  const stepPhase = (d: number) => setPhase(id, (((orb.phase + d) % orb.period) + orb.period) % orb.period)
  const mini: React.CSSProperties = { fontSize: 13, lineHeight: 1, width: 24, height: 22, borderRadius: 'var(--r-sm)', border: '1px solid var(--c-border-raised)', background: 'var(--c-surface-4)', color: 'var(--c-text)', cursor: 'pointer' }
  return (
    <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 6, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 18 }}>{glyphOf(sh.family)}</span>
        <b style={{ color: RARITY_COLOR[sh.rarity], flex: 1, fontSize: 13 }}>{sh.nick}</b>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--c-text-faint)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--c-text-faint)' }}>{tr('orrery.period')} {orb.period} · {tr('orrery.anchor')} {orb.anchor[0]},{orb.anchor[1]}{orb.tuned ? ' · ✎' : ''}</div>
      <div style={{ fontSize: 10, color: 'var(--c-text-faint)' }}>{tr('orrery.dragHint')}</div>
      {/* phase (timing) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 11, color: 'var(--c-text-dim)', flex: 1 }}>{tr('orrery.phase')}</span>
        <button style={mini} onClick={() => stepPhase(-1)}>−</button>
        <span style={{ fontSize: 12, minWidth: 16, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{orb.phase}</span>
        <button style={mini} onClick={() => stepPhase(1)}>+</button>
      </div>
      {/* rotate lane (which hex axis) */}
      <button onClick={() => rotateLane(id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border-raised)', background: 'var(--c-surface-3)', color: 'var(--c-text-secondary)', cursor: 'pointer' }}>
        ↻ {tr('orrery.rotate')} <span style={{ color: 'var(--c-text-faint)' }}>· {tr('orrery.axis')} {orb.axis + 1}/6</span>
      </button>
      <div style={{ display: 'flex', gap: 5 }}>
        {orb.tuned && (
          <button onClick={() => resetOrbit(id)} style={{ flex: 1, fontSize: 11, padding: '3px 8px', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border)', background: 'var(--c-surface-3)', color: 'var(--c-text-dim)', cursor: 'pointer' }}>{tr('orrery.resetTune')}</button>
        )}
        <button onClick={() => { undeploy(id); onClose() }} style={{ flex: 1, fontSize: 11, color: 'var(--c-danger)', background: 'var(--c-surface-3)', border: '1px solid var(--c-danger-border)', borderRadius: 'var(--r-md)', padding: '3px 8px', cursor: 'pointer' }}>
          {tr('orrery.recall')}
        </button>
      </div>
    </div>
  )
}

export function OrreryEngine() {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const deploy = useGame((s) => s.deploy)
  const tr = useT()
  const [sel, setSel] = useState<number | null>(null)
  const [is3d, setIs3d] = useState(true)
  const paused = useOrreryUi((s) => s.paused)
  const togglePause = useOrreryUi((s) => s.togglePause)
  const showAllLines = useOrreryUi((s) => s.showAllLines)
  const toggleAllLines = useOrreryUi((s) => s.toggleAllLines)
  const setHover = useOrreryUi((s) => s.setHover)
  if (!view) return null
  const loadout = view.loadout
  const owned = shapes.filter((s) => view.owned[s.id] > 0)
  const library = owned.filter((s) => !loadout.includes(s.id))
  const canDeploy = view.euler_used < view.euler_cap
  const mults = compactMults(view, tr)
  const pillBtn: React.CSSProperties = { fontSize: 11, padding: '3px 8px', borderRadius: 'var(--r-pill)', border: '1px solid var(--c-border-raised)', background: 'var(--c-surface-3)', color: 'var(--c-text-secondary)', cursor: 'pointer' }
  return (
    <div className="orrery-wrap">
      <div className="orrery-canvas">{is3d ? <Orrery3D /> : <OrreryBoard />}</div>

      {/* TOP — rate + compact multipliers */}
      <div className="orrery-top">
        <span className="orrery-panel" style={{ padding: '4px 10px', color: 'var(--c-accent-gold)', fontWeight: 700, fontSize: 13, pointerEvents: 'auto' }}>
          +{fmt(view.rate_per_hr)}{tr('hud.perHour')}
        </span>
        {mults.map((m) => (
          <span key={m.label} className="orrery-panel" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--c-accent-teal)', pointerEvents: 'auto' }}>
            {m.label} ×{m.v.toFixed(2)}
          </span>
        ))}
      </div>

      {/* top-right controls: 2D/3D + leave orrery */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 4, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '70%' }}>
        <button style={{ ...pillBtn, ...(paused ? { borderColor: 'var(--c-accent-gold)', color: 'var(--c-accent-gold)' } : {}) }} onClick={togglePause}>{paused ? `▶ ${tr('orrery.play')}` : `⏸ ${tr('orrery.pause')}`}</button>
        <button style={{ ...pillBtn, ...(showAllLines ? { borderColor: 'var(--c-accent-teal)', color: 'var(--c-accent-teal)' } : {}) }} onClick={toggleAllLines}>{tr('orrery.allLines')}</button>
        <button style={pillBtn} onClick={() => setIs3d((v) => !v)}>{is3d ? tr('engine.orrery2d') : tr('engine.orrery3d')}</button>
        <button style={pillBtn} onClick={() => useGame.getState().setUseOrrery(false)}>{tr('engine.orreryOff')}</button>
      </div>

      {/* LEFT — library (tap to deploy) */}
      <div className="orrery-panel orrery-left">
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('orrery.library')} · {library.length}</div>
        {library.length === 0 && <div style={{ fontSize: 11, color: 'var(--c-text-faint)' }}>{tr('orrery.libraryEmpty')}</div>}
        {library.map((s) => (
          <button
            key={s.id}
            disabled={!canDeploy}
            onClick={() => deploy(s.id)}
            title={canDeploy ? tr('orrery.deploy') : tr('orrery.full')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border)', background: 'var(--c-surface-2)', color: 'var(--c-text-secondary)', cursor: canDeploy ? 'pointer' : 'not-allowed', opacity: canDeploy ? 1 : 0.5, textAlign: 'left' }}
          >
            <span style={{ fontSize: 15 }}>{glyphOf(s.family)}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nick}</span>
            <span style={{ color: 'var(--c-accent-teal)' }}>+</span>
          </button>
        ))}
      </div>

      {/* RIGHT — active orbits (tap to select) + detail */}
      <div className="orrery-panel orrery-right">
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('orrery.active')} · {loadout.length}</div>
        <div style={{ fontSize: 10, color: 'var(--c-text-faint)' }}>{tr('orrery.budget')} {view.euler_used}/{view.euler_cap}</div>
        {loadout.map((id) => {
          const s = shapes[id]
          if (!s) return null
          return (
            <button
              key={id}
              onClick={() => setSel((v) => (v === id ? null : id))}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px', borderRadius: 'var(--r-md)', border: `1px solid ${sel === id ? RARITY_COLOR[s.rarity] : 'var(--c-border)'}`, background: sel === id ? `${RARITY_COLOR[s.rarity]}1c` : 'var(--c-surface-2)', color: 'var(--c-text-secondary)', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ fontSize: 15 }}>{glyphOf(s.family)}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nick}</span>
            </button>
          )
        })}
        {sel != null && <OrbitDetail id={sel} onClose={() => setSel(null)} />}
      </div>

      <OrreryTimeline />
    </div>
  )
}
