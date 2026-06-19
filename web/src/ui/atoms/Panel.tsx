import type { CSSProperties, HTMLAttributes } from 'react'
import { RADIUS } from '../tokens'
import { MAT_RECESSED, MAT_CARD, MAT_MODAL, MAT_STAGE, MAT_WELL } from '../tokens/materials'

export type PanelVariant = 'recessed' | 'raised' | 'modal' | 'stage' | 'well'

const MAT: Record<PanelVariant, CSSProperties> = {
  recessed: MAT_RECESSED,
  raised: MAT_CARD,
  modal: MAT_MODAL,
  stage: MAT_STAGE,
  well: MAT_WELL,
}

// A surface in one of the Vitrine material variants. The container building block (Brad-Frost atom).
export function Panel({
  variant = 'recessed',
  padding = 14,
  radius = RADIUS.xl,
  style,
  ...rest
}: { variant?: PanelVariant; padding?: number | string; radius?: string | number } & HTMLAttributes<HTMLDivElement>) {
  return <div style={{ ...MAT[variant], padding, borderRadius: radius, ...style }} {...rest} />
}
