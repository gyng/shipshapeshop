import { useT } from '../i18n'
import { Tooltip } from '../ui/atoms/Tooltip'

// Small corner badge naming the renderer for the current scene. A plain DOM overlay (NOT inside the Canvas / not
// drei Html) — an absolute-positioned sibling of the <Canvas> in a position:relative wrapper, so it's a flat 2D
// chip pinned top-left, never transformed by the 3D camera. Just the ICON; the label + explanation show in the
// app's custom (portal) Tooltip on hover/focus/tap.
export type RenderTech = 'pathtraced' | 'raymarched' | 'mesh' | 'meshpt' | 'partypt' | 'polytope4d'

const GLYPH: Record<RenderTech, string> = {
  pathtraced: '✦',
  raymarched: '◈',
  mesh: '◆',
  meshpt: '✧', // mesh BVH path tracer (opt-in, cyclable)
  partypt: '❉', // multi-material SCENE path tracer (the Expeditions party portrait)
  polytope4d: '⬡',
}

// `layers` = the cosmetic/render layers shaping this view (scene, atmosphere, lighting, finish, …) — listed in
// the badge tooltip so "what am I looking at" is legible at a glance.
export function RenderTechBadge({ tech, layers = [], onCycle }: { tech: RenderTech; layers?: { label: string; value: string }[]; onCycle?: () => void }) {
  const tr = useT()
  return (
    <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5 }}>
      <Tooltip
        content={
          <>
            <div style={{ fontWeight: 600, color: 'var(--c-text, #e7ecff)', marginBottom: 2 }}>{tr('render.' + tech)}</div>
            <div>{tr('render.help.' + tech)}</div>
            {onCycle && <div style={{ marginTop: 5, color: 'var(--c-accent-teal, #5fe0c6)', fontWeight: 600 }}>↻ {tr('render.tapToSwitch')}</div>}
            {layers.length > 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.14)', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
                {layers.map((l) => (
                  <div key={l.label} style={{ display: 'contents' }}>
                    <span style={{ color: 'var(--c-text-dim, #9aa0b5)' }}>{l.label}</span>
                    <span style={{ color: 'var(--c-text, #e7ecff)' }}>{l.value}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        }
      >
        <div
          onClick={onCycle ? (e) => { e.stopPropagation(); onCycle() } : undefined}
          role={onCycle ? 'button' : undefined}
          aria-label={onCycle ? tr('render.tapToSwitch') : undefined}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 999, fontSize: 14, lineHeight: 1,
            color: 'var(--c-text, #e7ecff)', background: 'rgba(10,11,22,0.55)',
            border: onCycle ? '1px solid rgba(95,224,198,0.55)' : '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)',
            userSelect: 'none', cursor: onCycle ? 'pointer' : 'help',
          }}
        >
          {GLYPH[tech]}
        </div>
      </Tooltip>
    </div>
  )
}
