// Compact number formatting for the feel layer (HUD, overlays). Rust emits raw values; TS abbreviates.
export function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k'
  return Math.floor(n).toLocaleString()
}
