import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useGame } from './game/store'
import { useT } from './i18n'
import { glyphOf } from './content/glyphs'
import { arrangementForEpoch, STYLES, type Arrangement, type Role } from './orreryBed'
import { useBedStatus } from './bedStatus'
import { bedControl, type BedLayer } from './bedControl'
import { getMasterPeak, audioStats, resetAudioStats, type AudioStats } from './audio'

// "Under the hood" view of the orrery's generative lofi engine — a live read-out of what the bed is playing:
// a beat meter synced to the Transport, the section progress toward the next crossfade, the harmony, the
// active layers, and the per-shape band.

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const noteName = (m: number) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1)

// Read a diatonic chord's jazz symbol back off its MIDI notes (the inverse of orreryBed's chord builder).
function chordSymbol(chord: number[]): string {
  if (!chord.length) return '–'
  const root = chord[0]
  const name = NOTE_NAMES[((root % 12) + 12) % 12]
  const ivs = new Set(chord.map((n) => (((n - root) % 12) + 12) % 12))
  const minor = ivs.has(3)
  const flatFive = ivs.has(6) && !ivs.has(7)
  const maj7 = ivs.has(11)
  const dom7 = ivs.has(10)
  const ninth = ivs.has(2)
  let q: string
  if (minor && flatFive && dom7) q = 'm7♭5'
  else if (minor) q = dom7 ? (ninth ? 'm9' : 'm7') : 'm'
  else q = maj7 ? (ninth ? 'maj9' : 'maj7') : dom7 ? (ninth ? '9' : '7') : ''
  return name + q
}

const LAYER_ORDER: (keyof Arrangement['layers'])[] = ['vinyl', 'shapeVoices', 'chords', 'pad', 'bass', 'drums']
// display tokens for technical values (rendered as variables; the row HEADINGS are the localized text)
const LAYER_LABEL: Record<string, string> = { vinyl: 'Vinyl', shapeVoices: 'Shapes', chords: 'Chords', pad: 'Pad', bass: 'Bass', drums: 'Drums' }
const ROLE_LABEL: Record<Role, string> = { keys: 'Keys', pad: 'Pad', bass: 'Bass', pluck: 'Pluck', bell: 'Bell' }

const card: CSSProperties = { background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', padding: 'var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-1_5)' }
const eyebrow: CSSProperties = { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }
const ctrlBtn = (enabled: boolean): CSSProperties => ({ fontSize: 'var(--fs-eyebrow)', padding: '3px 9px', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border-raised)', background: 'var(--c-surface-3)', color: enabled ? 'var(--c-text-secondary)' : 'var(--c-text-faint)', cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.5 })
// a small selectable chip — `on` = active/unmuted (teal), off = dim. Used by the style picker + layer mutes.
const chip = (on: boolean, enabled: boolean): CSSProperties => ({
  fontSize: 'var(--fs-micro)',
  padding: '2px 7px',
  borderRadius: 'var(--r-pill)',
  border: `1px solid ${on ? 'var(--c-accent-teal)' : 'var(--c-border)'}`,
  background: on ? 'rgba(95,224,198,0.14)' : 'var(--c-surface-3)',
  color: on ? 'var(--c-accent-teal)' : 'var(--c-text-faint)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.5,
})

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline' }}>
      <span style={{ ...eyebrow, minWidth: 80, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)' }}>{children}</span>
    </div>
  )
}

// 16th-note beat meter — the lit cell sweeps the bar in sync with the audio; downbeats stand taller.
function BeatMeter({ step, live }: { step: number; live: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 24, opacity: live ? 1 : 0.4 }}>
      {Array.from({ length: 16 }, (_, i) => {
        const downbeat = i % 4 === 0
        const on = live && i === step
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: on ? 24 : downbeat ? 15 : 9,
              borderRadius: 2,
              background: on ? 'var(--c-accent-gold)' : downbeat ? 'var(--c-surface-6)' : 'var(--c-surface-4)',
              boxShadow: on ? '0 0 8px var(--c-accent-gold)' : 'none',
              transition: 'height 80ms ease, background 80ms, box-shadow 80ms',
            }}
          />
        )
      })}
    </div>
  )
}

export function MusicEngineInspector() {
  const view = useGame((s) => s.view)
  const shapes = useGame((s) => s.shapes)
  const status = useBedStatus()
  const tr = useT()

  const deployed = view ? view.loadout.map((id) => shapes[id]).filter(Boolean) : []
  const arr = status.current ?? arrangementForEpoch(deployed, 0)
  const live = status.playing && status.current != null
  const curChord = live ? status.chordIdx : -1 // the chord actually sounding (published from the audio clock)

  // live output meter + clip/glitch detection + layer-mute state — poll only while this panel is open
  const [meter, setMeter] = useState({ peak: 0, hold: 0, clips: 0 })
  const [stats, setStats] = useState<AudioStats | null>(null)
  const [mutes, setMutes] = useState<Record<BedLayer, boolean>>({ drums: false, bass: false, chords: false, arp: false })
  useEffect(() => {
    let hold = 0
    let clips = 0
    const id = setInterval(() => {
      const p = getMasterPeak()
      if (p >= 0.999) clips++ // the summed (pre-limiter) signal reached full scale → it's overdriving
      hold = Math.max(p, hold * 0.9) // decaying peak-hold
      setMeter({ peak: p, hold, clips })
      setStats(audioStats())
      const m = bedControl.getLayerMute?.()
      if (m) setMutes(m)
    }, 70)
    return () => clearInterval(id)
  }, [])
  const toggleMute = (layer: BedLayer) => {
    const next = !mutes[layer]
    bedControl.setLayerMute?.(layer, next)
    setMutes((m) => ({ ...m, [layer]: next }))
  }
  const LAYERS: BedLayer[] = ['drums', 'bass', 'chords', 'arp']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      {/* header — status + sub-style */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-1_5)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1_5)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: live ? 'var(--c-accent-teal)' : 'var(--c-surface-6)', boxShadow: live ? '0 0 6px var(--c-accent-teal)' : 'none' }} />
          <span style={{ fontSize: 'var(--fs-caption)', color: live ? 'var(--c-accent-teal)' : 'var(--c-text-faint)' }}>
            {live ? tr('audioEngine.live') : arr.active ? tr('audioEngine.preview') : tr('audioEngine.silent')}
          </span>
        </span>
        {arr.active && (
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--c-accent-gold)', fontWeight: 'var(--fw-bold)', padding: '2px 10px', borderRadius: 'var(--r-pill)', background: 'rgba(255,207,107,0.1)', border: '1px solid var(--c-border)' }}>
            {arr.style.id}
          </span>
        )}
      </div>

      {arr.active && (
        <>
          {/* controls — reroll the section / back to automatic rotation */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => bedControl.advance?.()} disabled={!live} style={ctrlBtn(live)}>↻ {tr('audioEngine.reroll')}</button>
            <button onClick={() => bedControl.clearStyle?.()} disabled={!live} style={ctrlBtn(live)}>{tr('audioEngine.styleAuto')}</button>
          </div>

          {/* style picker — jump straight to any sub-style (the current one is highlighted) */}
          <div>
            <span style={eyebrow}>{tr('audioEngine.styleLabel')}</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {STYLES.map((s) => {
                const on = arr.style.id === s.id
                return (
                  <button key={s.id} onClick={() => bedControl.pickStyle?.(s.id)} disabled={!live} style={chip(on, live)}>
                    {s.id}
                  </button>
                )
              })}
            </div>
          </div>

          {/* per-layer solo/mute — isolate the kit / bass / comp / melody to hear each part */}
          <div>
            <span style={eyebrow}>{tr('audioEngine.layersLabel')}</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {LAYERS.map((l) => (
                <button key={l} onClick={() => toggleMute(l)} disabled={!live} style={chip(!mutes[l], live)}>
                  {mutes[l] ? '🔇 ' : ''}
                  {tr(`audioEngine.layer.${l}`)}
                </button>
              ))}
            </div>
          </div>

          {/* output meter + clip detection — the real diagnostic for the "is it clipping or crackle?" question */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={eyebrow}>{tr('audioEngine.output')}</span>
              <span style={{ fontSize: 'var(--fs-micro)', color: meter.clips > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                {meter.peak > 0.0001 ? `${(20 * Math.log10(meter.peak)).toFixed(1)} dBFS` : '—'} · {tr('audioEngine.clips', { n: meter.clips })}
              </span>
            </div>
            <div style={{ position: 'relative', height: 8, background: 'var(--c-surface-4)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, (meter.hold / 1.2) * 100)}%`, background: meter.hold >= 1 ? 'var(--c-danger)' : meter.hold > 0.8 ? 'var(--c-accent-gold)' : 'var(--c-accent-teal)', transition: 'width 70ms linear' }} />
              <div style={{ position: 'absolute', left: `${(1 / 1.2) * 100}%`, top: -1, bottom: -1, width: 1, background: 'var(--c-text-faint)' }} title="0 dBFS" />
            </div>
            <span style={{ fontSize: 'var(--fs-micro)', color: meter.clips > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)', lineHeight: 1.4 }}>
              {meter.clips > 0 ? tr('audioEngine.clipWarn') : tr('audioEngine.clipOk')}
            </span>
            {/* glitch / underrun tracking — main-thread stalls (GLOBAL) + per-CONTEXT buffer sizes */}
            {stats && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                  <span style={{ fontSize: 'var(--fs-micro)', color: stats.jank > 0 ? 'var(--c-accent-gold)' : 'var(--c-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                    {tr('audioEngine.stalls', { n: stats.jank })}{stats.jank > 0 ? ` · ${Math.round(stats.maxJankMs)}ms` : ''}
                  </span>
                  <button onClick={() => { resetAudioStats(); setStats(audioStats()) }} style={ctrlBtn(true)}>{tr('audioEngine.reset')}</button>
                </div>
                <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                  {stats.music && `${tr('audioEngine.musicCtx')} ${Math.round(stats.music.outputLatency * 1000)}ms · ${(stats.music.sampleRate / 1000).toFixed(1)}k`}
                  {stats.music && stats.sfx ? '  ·  ' : ''}
                  {stats.sfx && `${tr('audioEngine.sfxCtx')} ${Math.round(stats.sfx.outputLatency * 1000)}ms`}
                </span>
              </div>
            )}
          </div>

          {/* transport — beat meter + section progress */}
          <div style={card}>
            <BeatMeter step={status.step16} live={live} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)' }}>
                {tr('audioEngine.section')} {arr.epoch + 1} · {status.sectionBar + 1}/{status.sectionBars}
              </span>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--c-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {arr.bpm} BPM · {tr('audioEngine.swing')} {Math.round(arr.swing * 100)}%
              </span>
            </div>
            {/* bars to the next crossfade */}
            <div style={{ display: 'flex', gap: 4 }}>
              {Array.from({ length: status.sectionBars }, (_, i) => (
                <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: live && i <= status.sectionBar ? 'var(--c-accent-teal)' : 'var(--c-surface-4)', opacity: live && i === status.sectionBar ? 1 : 0.55 }} />
              ))}
            </div>
          </div>

          {/* harmony */}
          <div style={card}>
            <Stat label={tr('audioEngine.key')}>
              {noteName(arr.rootMidi)} {tr('audioEngine.major')}
            </Stat>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline' }}>
              <span style={{ ...eyebrow, minWidth: 80, flexShrink: 0 }}>{tr('audioEngine.progression')}</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {arr.progression.map((c, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 'var(--fs-caption)',
                      fontVariantNumeric: 'tabular-nums',
                      padding: '1px 8px',
                      borderRadius: 'var(--r-sm)',
                      background: i === curChord ? 'var(--c-accent-gold)' : 'var(--c-surface-4)',
                      color: i === curChord ? '#1a1206' : 'var(--c-text-secondary)',
                      transition: 'background 100ms, color 100ms',
                    }}
                  >
                    {chordSymbol(c)}
                  </span>
                ))}
              </span>
            </div>
          </div>

          {/* layers + lead */}
          <div style={card}>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline' }}>
              <span style={{ ...eyebrow, minWidth: 80, flexShrink: 0 }}>{tr('audioEngine.layers')}</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {LAYER_ORDER.map((k) => {
                  const on = arr.layers[k]
                  return (
                    <span key={k} style={{ fontSize: 'var(--fs-micro)', padding: '1px 8px', borderRadius: 'var(--r-pill)', border: `1px solid ${on ? 'var(--c-accent-teal)' : 'var(--c-border)'}`, color: on ? 'var(--c-accent-teal)' : 'var(--c-text-faint)', background: on ? 'rgba(95,224,198,0.1)' : 'transparent', opacity: on ? 1 : 0.6 }}>
                      {LAYER_LABEL[k]}
                    </span>
                  )
                })}
              </span>
            </div>
            <Stat label={tr('audioEngine.lead')}>{arr.leadPatch}</Stat>
          </div>

          {/* the band — each deployed shape and the instrument it plays */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={eyebrow}>{tr('audioEngine.band')} · {arr.voices.length}</span>
            {arr.voices.map((v) => {
              const sh = shapes[v.id]
              return (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1_5)', fontSize: 'var(--fs-caption)', padding: '3px 8px', borderRadius: 'var(--r-sm)', background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                  <span style={{ fontSize: 'var(--fs-h4)' }}>{glyphOf(sh?.family ?? '')}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-text-secondary)' }}>{sh?.nick}</span>
                  <span style={{ color: 'var(--c-text-dim)' }}>{ROLE_LABEL[v.role]}</span>
                  <span style={{ color: 'var(--c-text-faint)' }}>{v.instrument.patch}</span>
                  <span style={{ color: 'var(--c-accent-gold)', fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>{noteName(v.homeMidi)}</span>
                  {v.instrument.flip && <span title={tr('audioEngine.mirror')} style={{ color: 'var(--c-accent-teal)', fontSize: 'var(--fs-micro)' }}>◐</span>}
                </div>
              )
            })}
          </div>

          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)', textAlign: 'right' }}>{tr('audioEngine.seedNote', { seed: arr.seed })}</div>
        </>
      )}
    </div>
  )
}
