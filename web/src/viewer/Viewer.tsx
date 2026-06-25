// Standalone shape/SDF viewer — mounted at /?viewer (see main.tsx), with NO game core booted. It browses
// EVERY renderable family (SDF/raymarch, mesh, 4D polytope, relic) at any rarity, in any scene/atmosphere/
// lighting/cursor/post-FX/finish, reusing the game's HeroView render stack. HeroView reads the cosmetic slots
// from the game store but falls back to id 0 when `view` is null (which it is here), and we override every
// layer via its preview-* props. 4D polytopes get manual 6-plane rotation + projection-distance controls.
import { useState, useEffect } from 'react'
import { HeroView } from '../three/HeroView'
import { SettingsModal, NowPlaying } from '../App'
import { RARITY_ORDER, type RarityName, useGame } from '../game/store'
import { RARITY_COLOR } from '../three/Gem'
import { SCENES, ATMOSPHERES, GEM_FINISHES, LIGHTING_MOODS, HERO_CURSORS, POST_FX, DIORAMAS, GEM_COLORS } from '../content/cosmetics'
import { FAMILY_CATEGORIES, ALL_FAMILIES, type RenderPath } from './families'
import { useMute } from '../audio'
import { OrreryBedDriver } from '../orreryBedDriver'
import { useT } from '../i18n'

const PATH_LABEL: Record<RenderPath, string> = { sdf: 'SDF · raymarched', '4d': '4D polytope', relic: 'relic mesh', mesh: 'mesh' }
const PLANES_4D = ['XY', 'XZ', 'XW', 'YZ', 'YW', 'ZW'] // the six rotation planes of 4-space
type Angles6 = [number, number, number, number, number, number]

// A tiny standalone FPS readout (the game's FpsMeter lives inside <App/>, which we don't mount here).
function Fps() {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    let raf = 0, frames = 0, t0 = performance.now()
    const loop = () => { frames++; const now = performance.now(); if (now - t0 >= 500) { setFps(Math.round((frames * 1000) / (now - t0))); frames = 0; t0 = now } raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  const c = fps >= 50 ? '#5fe0c6' : fps >= 30 ? '#ffcf6b' : '#ff6b6b'
  return <span style={{ fontVariantNumeric: 'tabular-nums', color: c, fontWeight: 700 }}>{fps} fps</span>
}

// A compact swatch picker (reuses the Shop's cosmetic-swatch idea): a wrapping grid of the cosmetic's CSS
// gradient previews; the selected one is outlined and its name shown inline. Nicer than a 39-option dropdown.
function SwatchPicker({ label, value, onChange, items }: { label: string; value: number; onChange: (id: number) => void; items: { id: number; name: string; swatch: string }[] }) {
  const cur = items.find((i) => i.id === value)
  return (
    <div className="viewer-field">
      <span>{label}{cur ? <span style={{ color: 'var(--c-text-secondary)', textTransform: 'none', letterSpacing: 0 }}> · {cur.name}</span> : null}</span>
      <div className="viewer-swatches">
        {items.map((i) => (
          <button key={i.id} type="button" onClick={() => onChange(i.id)} title={i.name} aria-label={i.name} aria-pressed={i.id === value}
            className={i.id === value ? 'viewer-swatch viewer-swatch-on' : 'viewer-swatch'} style={{ background: i.swatch }} />
        ))}
      </div>
    </div>
  )
}

// Manual 4D-rotation controls (shown only for 4D polytopes): an auto-tumble toggle, the six rotation-plane
// angle sliders (active when auto-tumble is off → freely pose the polytope in 4-space), and the projection
// distance (4D "camera distance" — lower zooms the 4D eye in for the dramatic stereographic-like turning).
function Poly4DPanel({ angles, setAngle, spin, setSpin, dist, setDist }: { angles: Angles6; setAngle: (i: number, v: number) => void; spin: boolean; setSpin: (v: boolean) => void; dist: number; setDist: (v: number) => void }) {
  return (
    <div className="viewer-field">
      <span>4D rotation<span style={{ color: 'var(--c-text-secondary)', textTransform: 'none', letterSpacing: 0 }}> · {spin ? 'auto-tumbling' : 'manual pose'}</span></span>
      <button className="viewer-toggle" aria-pressed={spin} onClick={() => setSpin(!spin)} style={{ alignSelf: 'flex-start' }}>⟳ Auto-tumble · {spin ? 'on' : 'off'}</button>
      <div style={{ opacity: spin ? 0.38 : 1, pointerEvents: spin ? 'none' : 'auto', display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
        {PLANES_4D.map((p, i) => (
          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ width: 26, color: 'var(--c-text-secondary)', fontWeight: 700 }}>{p}</span>
            <input type="range" min={-Math.PI} max={Math.PI} step={0.01} value={angles[i]} onChange={(e) => setAngle(i, parseFloat(e.target.value))} style={{ flex: 1 }} />
            <span style={{ width: 40, textAlign: 'right', color: 'var(--c-text-dim)', fontVariantNumeric: 'tabular-nums' }}>{(angles[i] / Math.PI).toFixed(2)}π</span>
          </label>
        ))}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, fontSize: 11 }}>
        <span style={{ color: 'var(--c-text-secondary)' }}>Projection distance · <strong style={{ color: 'var(--c-text-bright)' }}>{dist.toFixed(1)}</strong> <span style={{ color: 'var(--c-text-dim)' }}>(lower = more dramatic)</span></span>
        <input type="range" min={1.4} max={5} step={0.1} value={dist} onChange={(e) => setDist(parseFloat(e.target.value))} />
      </label>
    </div>
  )
}

// Dynamic render scale (on by default): sample the frame rate and nudge the canvas render-scale to hold ~60fps.
// rAF caps at the display refresh, and dropped frames (GPU overload) lower the measured rate — a good-enough signal.
// Returns 1 (full res) when disabled.
function useDynamicRenderScale(enabled: boolean, target = 60): number {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    if (!enabled) {
      setScale(1)
      return
    }
    let raf = 0, frames = 0, t0 = performance.now()
    const tick = () => {
      frames++
      const now = performance.now(), dt = now - t0
      if (dt >= 600) {
        const fps = (frames * 1000) / dt
        frames = 0
        t0 = now
        setScale((s) => {
          if (fps < target - 6) return Math.max(0.3, +(s - 0.1).toFixed(2)) // struggling → drop resolution (floor 30% so a slow GPU can still reach 60)
          if (fps > target - 1.5 && s < 1) return Math.min(1, +(s + 0.05).toFixed(2)) // headroom → recover toward full
          return s
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled, target])
  return scale
}

export function Viewer() {
  const [family, setFamily] = useState('klein_bottle')
  const tr = useT()
  const [q, setQ] = useState('')
  const [rarity, setRarity] = useState<RarityName>('Ssr')
  const [scene, setScene] = useState(0)
  const [atmo, setAtmo] = useState(0) // Clear — let the shape speak; the swatches dress it from there
  const [finish, setFinish] = useState(0)
  const [lighting, setLighting] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [postfx, setPostfx] = useState(0)
  const [diorama, setDiorama] = useState(0)
  const [gemColor, setGemColor] = useState(0)
  const [spin, setSpin] = useState(true)
  const [motes, setMotes] = useState(true) // ambient flux motes around the gem — on, to match the in-game hero view
  const [showFps, setShowFps] = useState(true)
  const [dynScale, setDynScale] = useState(true) // dynamic render scale: auto-hold ~60fps. On by default.
  // 4D polytope controls
  const [angles4d, setAngles4d] = useState<Angles6>([0, 0, 0, 0, 0, 0])
  const [spin4d, setSpin4d] = useState(true)
  const [dist4d, setDist4d] = useState(2.6)
  const renderScale = useDynamicRenderScale(dynScale)
  // Music: the generative lofi bed. Off (paused) by default — the viewer boots no game core, so the first press
  // lazy-loads it, owns every shape (so the 'library' bed has the full palette), and starts playing. After that,
  // the button just mutes/unmutes.
  const musicMuted = useMute((s) => s.musicMuted)
  const [musicReady, setMusicReady] = useState(false)
  const onMusic = async () => {
    if (!musicReady) {
      await useGame.getState().boot()
      useGame.getState().devUnlockAll()
      useMute.setState({ musicSource: 'library', musicMuted: false })
      setMusicReady(true)
    } else {
      useMute.getState().toggleMusic()
    }
  }

  const cur = ALL_FAMILIES.find((e) => e.family === family)
  const is4D = cur?.path === '4d'
  const ql = q.trim().toLowerCase()
  const setAngle = (i: number, v: number) => setAngles4d((prev) => prev.map((a, j) => (j === i ? v : a)) as Angles6)

  // 🎲 random cosmetic combo (viewer-only, so plain Math.random is fine — no game RNG here). Keeps the shape; rolls
  // a fresh look across every layer + rarity.
  const randomize = () => {
    const pick = <T extends { id: number }>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)].id
    setScene(pick(SCENES)); setAtmo(pick(ATMOSPHERES)); setFinish(pick(GEM_FINISHES))
    setLighting(pick(LIGHTING_MOODS)); setCursor(pick(HERO_CURSORS)); setPostfx(pick(POST_FX)); setDiorama(pick(DIORAMAS)); setGemColor(pick(GEM_COLORS))
    setRarity(RARITY_ORDER[Math.floor(Math.random() * RARITY_ORDER.length)])
  }

  return (
    <div className="viewer-root">
      {musicReady && <OrreryBedDriver />}
      <header className="viewer-head">
        <button className="viewer-back" onClick={() => { location.href = '?game' }}>← Back to game</button>
        <strong style={{ fontSize: 18 }}>Shape Viewer</strong>
        <NowPlaying />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          {showFps && <Fps />}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--c-text-secondary)' }} title={tr('viewer.dynResTip')}>
            <input type="checkbox" checked={dynScale} onChange={(e) => setDynScale(e.target.checked)} /> {tr('viewer.dynRes')}
            {dynScale && renderScale < 1 ? <span style={{ marginLeft: 4, color: 'var(--c-text-dim)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(renderScale * 100)}%</span> : null}
          </label>
          {/* the game's Settings modal (defaults to the Graphics tab) — quality/path-trace live in the shared gfx store */}
          <button className="viewer-back" onClick={onMusic} title="Generative lofi bed from the whole shape library — off until you start it">{musicReady && !musicMuted ? '⏸ Music' : '♪ Music'}</button>
          <button className="viewer-back" onClick={() => useGame.getState().setSettingsOpen(true)} title="Graphics & settings">⚙ Settings</button>
        </span>
      </header>
      <SettingsModal />

      <div className="viewer-body">
        {/* ── browser ── */}
        <aside className="viewer-browser">
          <input className="viewer-search" placeholder="🔎 search shapes…" value={q} onChange={(e) => setQ(e.target.value)} />
          {FAMILY_CATEGORIES.map((cat) => {
            const items = cat.families.filter((e) => !ql || e.family.includes(ql) || e.label.toLowerCase().includes(ql))
            if (!items.length) return null
            return (
              <section key={cat.name} style={{ marginTop: 12 }}>
                <div className="viewer-cat">{cat.name}</div>
                <div className="viewer-tiles">
                  {items.map((e) => (
                    <button key={e.family} onClick={() => setFamily(e.family)} title={`${e.family} · ${PATH_LABEL[e.path]}`}
                      className="viewer-tile" aria-pressed={e.family === family}
                      style={e.family === family ? { borderColor: 'var(--c-accent-teal)', background: 'rgba(95,224,198,0.10)', color: '#fff' } : undefined}>
                      <span style={{ fontSize: 17 }}>{e.glyph}</span> {e.label}
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </aside>

        {/* ── stage ── */}
        <main className="viewer-stage">
          {/* Auto-rotate toggles the camera orbit. To freeze + converge a path-traced gem use the in-canvas
              Freeze badge — it stops the spin AND the camera (SDF keeps rendering full-quality; mesh-PT
              converges). We deliberately do NOT force a 'demand' frameloop: SDF path-tracing doesn't
              temporally accumulate, so a single demand frame reads noisier than the continuous render. */}
          {cur && (
            <HeroView key={family} family={family} rarity={rarity} controls autoRotate={spin} motes={motes}
              previewScene={scene} previewAtmosphere={atmo} previewLighting={lighting} previewCursor={cursor} previewPostfx={postfx} previewFinish={finish} previewDiorama={diorama} previewGemColor={gemColor}
              renderScale={renderScale} cameraPos={[1.8, 2.3, 4.0]}
              poly4d={is4D ? { angles: angles4d, spin: spin4d, dist: dist4d } : undefined} />
          )}
          {cur && (
            <div className="viewer-stage-label">
              <span style={{ fontSize: 20 }}>{cur.glyph}</span>
              <strong style={{ color: RARITY_COLOR[rarity] }}>{cur.label}</strong>
              <span style={{ color: 'var(--c-text-dim)' }}>· {cur.family} · {PATH_LABEL[cur.path]}</span>
            </div>
          )}
        </main>

        {/* ── controls ── */}
        <aside className="viewer-controls">
          <label className="viewer-field">
            <span>Rarity</span>
            <div className="viewer-rarity">
              {RARITY_ORDER.map((r) => (
                <button key={r} onClick={() => setRarity(r)} title={r} aria-pressed={r === rarity}
                  style={{ ...{ border: '1px solid', borderRadius: 999, padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'transparent' }, borderColor: RARITY_COLOR[r], color: r === rarity ? '#0b0c12' : RARITY_COLOR[r], backgroundColor: r === rarity ? RARITY_COLOR[r] : 'transparent' }}>
                  {r}
                </button>
              ))}
            </div>
          </label>

          <button className="viewer-random" onClick={randomize} title="Roll a random look across every cosmetic layer">🎲 Random combo</button>

          <SwatchPicker label="Scene" value={scene} onChange={setScene} items={SCENES.map((s) => ({ id: s.id, name: s.name, swatch: s.bg }))} />
          <SwatchPicker label="Atmosphere" value={atmo} onChange={setAtmo} items={ATMOSPHERES.map((a) => ({ id: a.id, name: a.name, swatch: a.swatch }))} />
          <SwatchPicker label="Lighting" value={lighting} onChange={setLighting} items={LIGHTING_MOODS.map((l) => ({ id: l.id, name: l.name, swatch: l.swatch }))} />
          <SwatchPicker label="Gem colour" value={gemColor} onChange={setGemColor} items={GEM_COLORS.map((c) => ({ id: c.id, name: c.name, swatch: c.swatch }))} />
          <SwatchPicker label="Gem finish" value={finish} onChange={setFinish} items={GEM_FINISHES.map((f) => ({ id: f.id, name: f.name, swatch: f.swatch }))} />
          <SwatchPicker label="Hero cursor" value={cursor} onChange={setCursor} items={HERO_CURSORS.map((c) => ({ id: c.id, name: c.name, swatch: c.swatch }))} />
          <SwatchPicker label="Post-FX" value={postfx} onChange={setPostfx} items={POST_FX.map((p) => ({ id: p.id, name: p.name, swatch: p.swatch }))} />
          <SwatchPicker label="Diorama" value={diorama} onChange={setDiorama} items={DIORAMAS.map((d) => ({ id: d.id, name: d.name, swatch: d.swatch }))} />

          {is4D && <Poly4DPanel angles={angles4d} setAngle={setAngle} spin={spin4d} setSpin={setSpin4d} dist={dist4d} setDist={setDist4d} />}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="viewer-toggle" aria-pressed={spin} onClick={() => setSpin((v) => !v)}>↻ Auto-rotate · {spin ? 'on' : 'off'}</button>
            <button className="viewer-toggle" aria-pressed={motes} onClick={() => setMotes((v) => !v)}>✦ Flux particles · {motes ? 'on' : 'off'}</button>
            <button className="viewer-toggle" aria-pressed={showFps} onClick={() => setShowFps((v) => !v)}>FPS · {showFps ? 'on' : 'off'}</button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', lineHeight: 1.5, marginTop: 'auto' }}>
            <strong style={{ color: 'var(--c-text-secondary)' }}>Auto-rotate</strong> spins the camera. To inspect a
            still, hit <strong style={{ color: 'var(--c-text-secondary)' }}>❚❚ Freeze</strong> on the gem — it stops
            the spin and the path-tracer converges to a clean, noise-free image (drag to orbit re-renders). The
            render badge switches raymarch ↔ path-trace ↔ mesh. Hero-cursor + post-FX preview on the mesh/4D and
            raymarch paths; quality follows the game's Graphics settings.
          </p>
        </aside>
      </div>
    </div>
  )
}
