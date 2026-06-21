import type { CSSProperties } from 'react'
import { STYLES } from './orreryBed'
import { useMusicPrefs } from './musicPrefs'
import { useT } from './i18n'

// Settings ▸ Audio: opt styles in/out of the generative rotation, toggle per-section instrument variation, and
// see which premium styles (J-pop / J-rock / city-pop) are unlocked. The shop writes `owned`; this reads it for
// equip status. Disabling a style just removes it from the rotation — nothing is lost.
const eyebrow: CSSProperties = { fontSize: 'var(--fs-eyebrow)', color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)', padding: '4px 0' }
const chip = (on: boolean): CSSProperties => ({
  fontSize: 'var(--fs-eyebrow)',
  padding: '3px 10px',
  borderRadius: 'var(--r-pill)',
  border: `1px solid ${on ? 'var(--c-accent-teal)' : 'var(--c-border)'}`,
  background: on ? 'rgba(95,224,198,0.14)' : 'var(--c-surface-3)',
  color: on ? 'var(--c-accent-teal)' : 'var(--c-text-faint)',
  cursor: 'pointer',
})

export function MusicStylesSettings() {
  const prefs = useMusicPrefs()
  const tr = useT()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1_5)' }}>
      <div style={row}>
        <span>
          {tr('musicStyles.instruments')}
          <span style={{ display: 'block', fontSize: 'var(--fs-micro)', color: 'var(--c-text-faint)' }}>{tr('musicStyles.instrumentsHint')}</span>
        </span>
        <button style={chip(prefs.instrumentVariation)} onClick={() => prefs.setInstrumentVariation(!prefs.instrumentVariation)}>
          {prefs.instrumentVariation ? tr('settings.toggleOn') : tr('settings.toggleOff')}
        </button>
      </div>

      <span style={eyebrow}>{tr('musicStyles.styles')}</span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {STYLES.map((s) => {
          const owned = prefs.isOwned(s.id)
          const enabled = prefs.isEnabled(s.id)
          return (
            <div key={s.id} style={row}>
              <span style={{ fontSize: 'var(--fs-caption)', color: owned ? 'var(--c-text-secondary)' : 'var(--c-text-faint)' }}>
                {owned ? '' : '🔒 '}
                {tr(`nowPlaying.cap.${s.id}`)}
                {s.premium ? <span style={{ color: 'var(--c-accent-gold)' }}> ✦</span> : ''}
              </span>
              {owned ? (
                <button style={chip(enabled)} onClick={() => prefs.toggleStyle(s.id)}>
                  {enabled ? tr('settings.toggleOn') : tr('settings.toggleOff')}
                </button>
              ) : (
                <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--c-accent-gold)' }}>{tr('musicStyles.unlockInShop')}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
