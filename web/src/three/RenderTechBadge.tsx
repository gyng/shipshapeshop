import { useT } from '../i18n'
import { Tooltip } from '../ui/atoms/Tooltip'

// Small corner badge naming the renderer for the current scene. A plain DOM overlay (NOT inside the Canvas / not
// drei Html) — an absolute-positioned sibling of the <Canvas> in a position:relative wrapper, so it's a flat 2D
// chip pinned top-left, never transformed by the 3D camera. Just the ICON; the label + explanation show in the
// app's custom (portal) Tooltip on hover/focus/tap.
export type RenderTech = 'pathtraced' | 'raymarched' | 'mesh' | 'polytope4d'

const GLYPH: Record<RenderTech, string> = {
  pathtraced: '✦',
  raymarched: '◈',
  mesh: '◆',
  polytope4d: '⬡',
}

export function RenderTechBadge({ tech }: { tech: RenderTech }) {
  const tr = useT()
  return (
    <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5 }}>
      <Tooltip
        content={
          <>
            <div style={{ fontWeight: 600, color: 'var(--c-text, #e7ecff)', marginBottom: 2 }}>{tr('render.' + tech)}</div>
            <div>{tr('render.help.' + tech)}</div>
          </>
        }
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 999, fontSize: 14, lineHeight: 1,
            color: 'var(--c-text, #e7ecff)', background: 'rgba(10,11,22,0.55)',
            border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)',
            userSelect: 'none', cursor: 'help',
          }}
        >
          {GLYPH[tech]}
        </div>
      </Tooltip>
    </div>
  )
}
