import type { ButtonHTMLAttributes, CSSProperties } from 'react'
import { COLOR, RADIUS } from '../tokens'
import { MAT_CAP } from '../tokens/materials'

export type ButtonVariant = 'cap' | 'primary' | 'secondary' | 'gold' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const SIZE: Record<ButtonSize, CSSProperties> = {
  sm: { padding: '6px 12px', fontSize: 13, borderRadius: RADIUS.md },
  md: { padding: '8px 14px', fontSize: 14, borderRadius: RADIUS.lg },
  lg: { padding: '14px 16px', fontSize: 16, borderRadius: RADIUS.xl },
}

// Skeuomorphic variants — recipes mirror the Vitrine spec (enamel primary, etched-glass secondary, brass gold).
const VARIANT: Record<ButtonVariant, CSSProperties> = {
  cap: { ...MAT_CAP },
  primary: {
    background: 'linear-gradient(180deg, #ff7ba6 0%, #ff5d8f 38%, #c264e6 78%, #a94fd6 100%)',
    border: 'none',
    color: '#fff',
    textShadow: '0 1px 1px rgba(80,0,40,0.5)',
    boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.45), inset 0 -3px 6px rgba(120,0,70,0.45), 0 4px 10px rgba(255,93,143,0.4), 0 2px 4px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,180,210,0.3)',
    cursor: 'pointer',
  },
  secondary: {
    background: 'linear-gradient(180deg, var(--c-surface-4), var(--c-surface-1))',
    border: `1px solid ${COLOR.pink}`,
    color: COLOR.pinkLight,
    boxShadow: 'inset 0 1px 0 var(--edge-2), inset 0 0 12px rgba(255,93,143,0.18), inset 0 -2px 4px var(--ink-4), 0 3px 7px var(--ink-3), 0 0 8px rgba(255,93,143,0.22)',
    cursor: 'pointer',
  },
  gold: {
    background: 'linear-gradient(180deg, #ffe08a, #ffce5c 45%, #ff9d5c)',
    border: 'none',
    color: '#2a1d00',
    textShadow: '0 1px 0 rgba(255,230,180,0.5)',
    boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.6), inset 0 -2px 4px rgba(150,80,0,0.45), 0 3px 7px rgba(255,170,60,0.4), 0 0 0 1px rgba(120,70,0,0.4)',
    cursor: 'pointer',
  },
  ghost: { background: 'transparent', border: 'none', color: COLOR.textDim, cursor: 'pointer' },
  danger: { ...MAT_CAP, borderColor: COLOR.dangerBorder, color: COLOR.danger },
}

// caps that get the deeper seated press (juice.css button.pull-cap:active)
const DEEP_PRESS: ButtonVariant[] = ['primary', 'secondary', 'gold']

export function Button({
  variant = 'cap',
  size = 'md',
  fontWeight = 700,
  className = '',
  style,
  ...rest
}: { variant?: ButtonVariant; size?: ButtonSize; fontWeight?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const press = DEEP_PRESS.includes(variant) ? 'pull-cap' : 'forge-cap'
  return (
    <button
      className={`${press} ${className}`.trim()}
      style={{ ...SIZE[size], ...VARIANT[variant], fontWeight, ...style }}
      {...rest}
    />
  )
}
