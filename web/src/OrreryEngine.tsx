import { useState, useEffect, useRef } from 'react'
import { useGame } from './game/store'
import { useT } from './i18n'
import { fmt } from './format'
import { ShapeGlyph } from './content/shapeGlyphs'
import { RARITY_COLOR } from './three/Gem'
import { Orrery3D } from './three/Orrery3D'
import { OrreryBoard } from './OrreryBoard'
import { Play, Pause, Sparkles } from 'lucide-react'
import { useOrreryUi, gemScreens } from './orreryUi'
import { useInspector } from './inspector'
import { useNav } from './nav'

// A wisp of ✦ that drifts up over the floor each time idle Flux ticks in — the orrery's own version of the
// HUD's idle-income juice, so production *feels* alive while you watch the gems orbit.
let orreryPingId = 0
function OrreryFluxPings() {
  const flux = useGame((s) => s.view?.flux ?? 0)
  const last = useRef(flux)
  const acc = useRef(0) // accumulate sub-1 drips so a ping always shows a meaningful whole "+N"
  const [pings, setPings] = useState<{ k: number; x: number; y: number; amt: number }[]>([])
  useEffect(() => {
    const d = flux - last.current
    last.current = flux
    if (d > 0) acc.current += d
    if (acc.current >= 1) {
      const amt = Math.floor(acc.current)
      acc.current -= amt
      const k = ++orreryPingId
      // pop the "+N" over an actual gem (its live projected screen position), not a fixed spot
      const gems = gemScreens.current
      const g = gems.length ? gems[Math.floor(Math.random() * gems.length)] : { x: 30 + Math.random() * 40, y: 40 + Math.random() * 25 }
      setPings((p) => [...p.slice(-7), { k, x: g.x, y: g.y, amt }])
      setTimeout(() => setPings((p) => p.filter((q) => q.k !== k)), 1500)
    }
  }, [flux])
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, overflow: 'hidden' }}>
      {pings.map((p) => (
        // "+amount ✦", font scaled by the size of the gain so a fat meeting payout reads bigger than a drip.
        <span
          key={p.k}
          className="floater"
          style={{ left: `${p.x}%`, top: `${p.y}%`, color: 'var(--c-accent-gold-deep)', fontWeight: 'var(--fw-heavy)', fontSize: Math.min(30, 12 + Math.log2(1 + p.amt) * 4.5) }}
        >
          +{fmt(p.amt)} ✦
        </span>
      ))}
    </div>
  )
}

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

// The right-panel detail for the selected deployed shape: how it emits flux, what it does on contact, its
// facing + timing, reset, or recall to the library.
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
  const e = view.flux_emitters[slot]
  if (!e) return null
  const emitPeriod = e.emit === 'rotating' ? 6 : e.emit === 'pulse' ? 3 : 1
  const stepPhase = (d: number) => setPhase(id, (((e.phase + d) % emitPeriod) + emitPeriod) % emitPeriod)
  const fmtAct = (kind: string, mult: number, turn: number) =>
    kind === 'multiply'
      ? `×${mult.toFixed(1)} ${tr('orrery.act.multiply')}`
      : kind === 'redirect' || kind === 'split'
        ? `${turn * 60}° ${tr(`orrery.act.${kind}`)}`
        : tr(`orrery.act.${kind}`)
  const actLabel = fmtAct(e.act, e.act_mult, e.act_turn)
  const act2Label = e.act2 !== 'pass' ? fmtAct(e.act2, e.act2_mult, e.act2_turn) : null
  const mini: React.CSSProperties = { fontSize: 'var(--fs-body-sm)', lineHeight: 1, width: 24, height: 22, borderRadius: 'var(--r-sm)', border: '1px solid var(--c-border-raised)', background: 'var(--c-surface-4)', color: 'var(--c-text)', cursor: 'pointer' }
  return (
    <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 'var(--sp-1_5)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1_5)' }}>
        <span style={{ fontSize: 'var(--fs-h2)' }}><ShapeGlyph family={sh.family} /></span>
        <b style={{ color: RARITY_COLOR[sh.rarity], flex: 1, fontSize: 'var(--fs-body-sm)' }}>{sh.nick}</b>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--c-text-faint)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)' }}>{tr('orrery.anchor')} {e.cell[0]},{e.cell[1]}{e.tuned ? ' · ✎' : ''}</div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)' }}>
        ✦ {tr('orrery.emits')}: <b style={{ color: 'var(--c-accent-gold)' }}>{tr(`orrery.emit.${e.emit}`)}</b>
      </div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)' }}>
        ◎ {tr('orrery.acts')}: <b style={{ color: 'var(--c-accent-teal)' }}>{actLabel}</b>
        {act2Label && <> + <b style={{ color: 'var(--c-accent-gold)' }}>{act2Label}</b></>}
      </div>
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)' }}>{tr('orrery.dragHint')}</div>
      {/* phase (emission timing) — only meaningful for patterns whose period > 1 */}
      {emitPeriod > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-dim)', flex: 1 }}>{tr('orrery.phase')}</span>
          <button style={mini} onClick={() => stepPhase(-1)}>−</button>
          <span style={{ fontSize: 'var(--fs-caption)', minWidth: 16, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{e.phase}</span>
          <button style={mini} onClick={() => stepPhase(1)}>+</button>
        </div>
      )}
      {/* rotate facing (which hex direction the flux leaves toward) */}
      <button onClick={() => rotateLane(id)} style={{ fontSize: 'var(--fs-eyebrow)', padding: '3px 8px', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border-raised)', background: 'var(--c-surface-3)', color: 'var(--c-text-secondary)', cursor: 'pointer' }}>
        ↻ {tr('orrery.rotate')} <span style={{ color: 'var(--c-text-faint)' }}>· {tr('orrery.axis')} {e.dir + 1}/6</span>
      </button>
      <div style={{ display: 'flex', gap: 5 }}>
        {e.tuned && (
          <button onClick={() => resetOrbit(id)} style={{ flex: 1, fontSize: 'var(--fs-eyebrow)', padding: '3px 8px', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border)', background: 'var(--c-surface-3)', color: 'var(--c-text-dim)', cursor: 'pointer' }}>{tr('orrery.resetTune')}</button>
        )}
        <button onClick={() => { undeploy(id); onClose() }} style={{ flex: 1, fontSize: 'var(--fs-eyebrow)', color: 'var(--c-danger)', background: 'var(--c-surface-3)', border: '1px solid var(--c-danger-border)', borderRadius: 'var(--r-md)', padding: '3px 8px', cursor: 'pointer' }}>
          {tr('orrery.recall')}
        </button>
      </div>
    </div>
  )
}

// Compact READ-ONLY effect card pinned in the orrery — the hovered (or selected) shape's emit pattern, both
// effects, and flux/hr, so you can read the board WITHOUT opening the full ⓘ sheet. Click a shape for the
// editable OrbitDetail; this is just a glance.
function ShapePreviewCard({ id }: { id: number }) {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const tr = useT()
  const sh = shapes[id]
  if (!view || !sh) return null
  const slot = view.loadout.indexOf(id)
  const e = view.flux_emitters[slot]
  if (!e) return null
  // plain-language description of an effect verb — tells the player what the cell actually DOES to flux
  // For amplify, `m` is act_mult = the flat add in µ-units/tick; show it as human Flux/hr (×3600 / ORRERY_SCALE 1e6).
  const actDesc = (k: string, m: number, t: number) => tr(`orrery.actDesc.${k}`, { mult: m.toFixed(1), deg: t * 60, add: fmt((m * 3600) / 1_000_000) })
  return (
    <div className="orrery-panel orrery-preview">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 'var(--fs-h3)' }}><ShapeGlyph family={sh.family} /></span>
        <b style={{ color: RARITY_COLOR[sh.rarity] }}>{sh.nick}</b>
        {(view.star_levels?.[id] ?? 0) > 0 && (
          <span style={{ color: 'var(--c-accent-gold)', fontSize: 'var(--fs-caption)', letterSpacing: -1 }} title={tr('orrery.star')}>{'★'.repeat(Math.min(5, view.star_levels[id]))}</span>
        )}
        {(view.bond_levels?.[id] ?? 0) > 0 && (
          <span style={{ color: '#ff5d8f', fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)' }} title={tr('orrery.bond')}>♥{view.bond_levels[id]}</span>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--c-accent-gold)', fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-caption)' }}>{fmt(view.flux_contrib?.[slot] ?? 0)}/hr</span>
      </div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)' }}>
        <b style={{ color: 'var(--c-accent-gold)' }}>✦</b> {tr(`orrery.emitDesc.${e.emit}`)}
      </div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)' }}>
        <b style={{ color: 'var(--c-accent-teal)' }}>◎</b> {actDesc(e.act, e.act_mult, e.act_turn)}
        {e.act2 !== 'pass' && <>, {tr('orrery.plus')} {actDesc(e.act2, e.act2_mult, e.act2_turn)}</>}
      </div>
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)' }}>{tr('orrery.axis')} {e.dir + 1}/6 · {tr('orrery.dragHint')}</div>
    </div>
  )
}

// The Euler-budget meter — the orrery's headline placement limit. Costly (high-genus/4D) shapes spend χ; the
// bar fills toward the cap, turning gold when full. Raise the cap in the Workshop (the floor grows with it).
function EulerMeter({ used, cap }: { used: number; cap: number }) {
  const tr = useT()
  const pct = cap > 0 ? Math.min(1, used / cap) : 0
  const full = used >= cap
  const col = full ? 'var(--c-accent-gold)' : 'var(--c-accent-teal)'
  // clicking the meter deep-links to the Workshop (where expand_floor raises the cap + opens the next floor ring)
  return (
    <button onClick={() => useNav.getState().goTo('workshop')} title={tr('orrery.eulerTip')} aria-label={tr('orrery.eulerTip')} style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 'var(--fs-eyebrow)' }}>
        <span style={{ flex: 1, color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 'var(--fw-heavy)' }}>χ {tr('orrery.budget')}</span>
        <b style={{ color: col, fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-caption)' }}>{used}/{cap}</b>
        <span style={{ color: 'var(--c-text-faint)', fontSize: 'var(--fs-micro)' }}>🛠</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--c-surface-4)', border: '1px solid var(--c-border)', overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: col, boxShadow: `0 0 6px ${col}`, transition: 'width 0.25s ease' }} />
      </div>
    </button>
  )
}

export function OrreryEngine() {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const deploy = useGame((s) => s.deploy)
  const tr = useT()
  const [sel, setSel] = useState<number | null>(null)
  const [is3d, setIs3d] = useState(true)
  const [dropActive, setDropActive] = useState(false) // dragging a library shape over the board
  const paused = useOrreryUi((s) => s.paused)
  const togglePause = useOrreryUi((s) => s.togglePause)
  const setHover = useOrreryUi((s) => s.setHover)
  const hoverId = useOrreryUi((s) => s.hoverId)
  const showAllLines = useOrreryUi((s) => s.showAllLines)
  const toggleAllLines = useOrreryUi((s) => s.toggleAllLines)
  if (!view) return null
  const loadout = view.loadout
  const owned = shapes.filter((s) => view.owned[s.id] > 0)
  const library = owned.filter((s) => !loadout.includes(s.id))
  const mults = compactMults(view, tr)
  const pillBtn: React.CSSProperties = { fontSize: 'var(--fs-eyebrow)', padding: '3px 8px', borderRadius: 'var(--r-pill)', border: '1px solid var(--c-border-raised)', background: 'var(--c-surface-3)', color: 'var(--c-text-secondary)', cursor: 'pointer' }
  // a small ⓘ button beside each list row — opens the shape's full detail sheet (same inspector the Gallery uses)
  const inspectBtn: React.CSSProperties = { flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, fontSize: 'var(--fs-body-sm)', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border)', background: 'var(--c-surface-2)', color: 'var(--c-text-dim)', cursor: 'pointer' }
  return (
    <div className="orrery-wrap">
      {/* the hex map is a drop target: drop a dragged library shape here to deploy it (it auto-places; drag the
          gem on the board to fine-tune, or drag it off the rim to recall it to the library). */}
      <div
        className="orrery-canvas"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('text/orrery-shape')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropActive) setDropActive(true)
        }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false) }}
        onDrop={(e) => {
          e.preventDefault()
          setDropActive(false)
          const id = parseInt(e.dataTransfer.getData('text/orrery-shape'), 10)
          if (!Number.isNaN(id)) deploy(id)
        }}
        style={dropActive ? { outline: '2px dashed var(--c-accent-teal)', outlineOffset: -10, borderRadius: 'var(--r-3xl)', background: 'rgba(95,224,198,0.05)' } : undefined}
      >
        {is3d ? <Orrery3D /> : <OrreryBoard />}
      </div>
      <OrreryFluxPings />
      {/* hover/select a shape → its compact effect card pins here (read effects without opening ⓘ) */}
      {(sel ?? hoverId) != null && <ShapePreviewCard id={(sel ?? hoverId) as number} />}

      {/* TOP — rate + compact multipliers */}
      <div className="orrery-top">
        <span className="orrery-panel" style={{ padding: 'var(--sp-1) var(--sp-2_5)', color: 'var(--c-accent-gold)', fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-body-sm)', pointerEvents: 'auto' }}>
          +{fmt(view.rate_per_hr)}{tr('hud.perHour')}
        </span>
        {mults.map((m) => (
          <span key={m.label} className="orrery-panel" style={{ padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--fs-eyebrow)', color: 'var(--c-accent-teal)', pointerEvents: 'auto' }}>
            {m.label} ×{m.v.toFixed(2)}
          </span>
        ))}
      </div>

      {/* top-right controls: 2D/3D + leave orrery */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 4, display: 'flex', gap: 'var(--sp-1_5)', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '70%' }}>
        <button style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', gap: 4, ...(paused ? { borderColor: 'var(--c-accent-gold)', color: 'var(--c-accent-gold)' } : {}) }} onClick={togglePause}>{paused ? <><Play size={13} />{tr('orrery.play')}</> : <><Pause size={13} />{tr('orrery.pause')}</>}</button>
        <button style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => useGame.getState().autoArrange()} title={tr('engine.auto')}><Sparkles size={13} />{tr('orrery.auto')}</button>
        {/* draw every emitter's flux path at once (3D only — the 2D board always shows all paths) */}
        {is3d && (
          <button style={{ ...pillBtn, ...(showAllLines ? { borderColor: 'var(--c-accent-teal)', color: 'var(--c-accent-teal)' } : {}) }} onClick={toggleAllLines} aria-pressed={showAllLines}>{tr('orrery.allLines')}</button>
        )}
        <button style={pillBtn} onClick={() => setIs3d((v) => !v)}>{is3d ? tr('engine.orrery2d') : tr('engine.orrery3d')}</button>
      </div>

      {/* ASCEND — once the core is complete, a big glowing prompt to Recrystallize into New Game+ (the meta-spine).
          Top-centre + pulsing so it's impossible to miss; only appears when it's actually available. */}
      {view.core_complete && (
        <button
          className="ascend-glow"
          onClick={() => useGame.getState().recrystallize()}
          style={{ position: 'absolute', top: 'var(--sp-6)', left: '50%', transform: 'translateX(-50%)', zIndex: 6, pointerEvents: 'auto', padding: '16px 44px', borderRadius: 'var(--r-pill)', border: '2px solid #efe4ff', background: 'linear-gradient(180deg, #d6b6ff, #7d4fd6)', color: '#fff', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-h4)', letterSpacing: 1, textShadow: '0 1px 9px rgba(58,18,116,0.65)', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          ✦ {tr('engine.recrystallizeBtn')} ✦
        </button>
      )}

      {/* LEFT — library (tap to deploy) */}
      <div className="orrery-panel orrery-left">
        <div style={{ fontSize: 'var(--fs-eyebrow)', fontWeight: 'var(--fw-heavy)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tr('orrery.library')} · {library.length}</div>
        <EulerMeter used={view.euler_used} cap={view.euler_cap} />
        {library.length === 0 && <div style={{ fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-faint)' }}>{tr('orrery.libraryEmpty')}</div>}
        {library.map((s) => {
          // per-shape fit: a shape can only deploy if its χ cost fits the REMAINING budget (free shapes always do)
          const fits = view.euler_used + s.euler_cost <= view.euler_cap && view.loadout.length < view.orrery_cell_cap
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
              <button
                disabled={!fits}
                draggable={fits}
                onDragStart={(e) => { e.dataTransfer.setData('text/orrery-shape', String(s.id)); e.dataTransfer.effectAllowed = 'copy' }}
                onClick={() => deploy(s.id)}
                title={fits ? tr('orrery.deploy') : tr('orrery.tooCostly')}
                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--sp-1_5)', fontSize: 'var(--fs-caption)', padding: 'var(--sp-1) var(--sp-1_5)', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border)', background: 'var(--c-surface-2)', color: 'var(--c-text-secondary)', cursor: fits ? 'pointer' : 'not-allowed', opacity: fits ? 1 : 0.5, textAlign: 'left' }}
              >
                <span style={{ fontSize: 'var(--fs-h4)' }}><ShapeGlyph family={s.family} /></span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nick}</span>
                {s.euler_cost > 0 && (
                  <span title={tr('orrery.eulerCostTip')} style={{ fontSize: 'var(--fs-micro)', fontVariantNumeric: 'tabular-nums', color: fits ? 'var(--c-text-dim)' : 'var(--c-accent-gold)', border: `1px solid ${fits ? 'var(--c-border-raised)' : 'var(--c-accent-gold)'}`, borderRadius: 'var(--r-sm)', padding: '0 3px', lineHeight: 1.45 }}>χ{s.euler_cost}</span>
                )}
                <span style={{ color: fits ? 'var(--c-accent-teal)' : 'var(--c-text-faint)' }}>+</span>
              </button>
              <button onClick={() => useInspector.getState().set(s.id)} title={tr('orrery.inspect')} aria-label={tr('orrery.inspect')} style={inspectBtn}>ⓘ</button>
            </div>
          )
        })}
      </div>

      {/* RIGHT — active orbits (tap to select) + detail */}
      <div className="orrery-panel orrery-right">
        <div style={{ fontSize: 'var(--fs-eyebrow)', fontWeight: 'var(--fw-heavy)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {tr('orrery.active')} · <span title={tr('orrery.cellsTip')} style={{ color: loadout.length >= view.orrery_cell_cap ? 'var(--c-accent-gold)' : 'var(--c-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{loadout.length}/{view.orrery_cell_cap} ⬡</span>
        </div>
        <EulerMeter used={view.euler_used} cap={view.euler_cap} />
        {/* DPS METER: each deployed shape's own flux/hr output, sorted high→low, with a proportional bar; a ⊕
            tag shows the support (amplification) a multiplier shape lends others. Reads view.flux_contrib (truth). */}
        {(() => {
          const meter = loadout
            .map((id, slot) => ({ id, contrib: view.flux_contrib?.[slot] ?? 0, amp: view.flux_amp?.[slot] ?? 0 }))
            .sort((a, b) => b.contrib - a.contrib)
          const maxC = Math.max(1, ...meter.map((m) => m.contrib))
          const totalC = meter.reduce((s, m) => s + m.contrib, 0) || 1
          return meter.map(({ id, contrib, amp }) => {
            const s = shapes[id]
            if (!s) return null
            const col = RARITY_COLOR[s.rarity]
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
                <button
                  onClick={() => setSel((v) => (v === id ? null : id))}
                  onMouseEnter={() => setHover(id)}
                  onMouseLeave={() => setHover(null)}
                  title={`${s.nick} — ${Math.round((contrib / totalC) * 100)}% of orrery flux${amp > 1 ? ` · ⊕${fmt(amp)}/hr support` : ''}`}
                  style={{ position: 'relative', overflow: 'hidden', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--sp-1_5)', fontSize: 'var(--fs-caption)', padding: 'var(--sp-1) var(--sp-1_5)', borderRadius: 'var(--r-md)', border: `1px solid ${sel === id ? col : 'var(--c-border)'}`, background: sel === id ? `${col}1c` : 'var(--c-surface-2)', color: 'var(--c-text-secondary)', cursor: 'pointer', textAlign: 'left' }}
                >
                  {/* proportional flux bar behind the row */}
                  <div style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: `${(contrib / maxC) * 100}%`, background: `linear-gradient(90deg, ${col}3a, ${col}12)`, pointerEvents: 'none' }} />
                  <span style={{ position: 'relative', fontSize: 'var(--fs-h4)' }}><ShapeGlyph family={s.family} /></span>
                  <span style={{ position: 'relative', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nick}</span>
                  {amp > 1 && <span style={{ position: 'relative', fontSize: 'var(--fs-micro)', color: 'var(--c-accent-teal)', fontVariantNumeric: 'tabular-nums' }} title={tr('orrery.support')}>⊕{fmt(amp)}</span>}
                  <span style={{ position: 'relative', fontSize: 'var(--fs-micro)', fontWeight: 'var(--fw-bold)', color: 'var(--c-accent-gold)', fontVariantNumeric: 'tabular-nums' }}>{fmt(contrib)}</span>
                </button>
                <button onClick={() => useInspector.getState().set(id)} title={tr('orrery.inspect')} aria-label={tr('orrery.inspect')} style={inspectBtn}>ⓘ</button>
              </div>
            )
          })
        })()}
        {sel != null && <OrbitDetail id={sel} onClose={() => setSel(null)} />}
      </div>
    </div>
  )
}
