// Compact number formatting for the feel layer (HUD, overlays). Rust emits raw values; TS abbreviates.
export function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k'
  return Math.floor(n).toLocaleString()
}

// "Time to afford": how long until `rate`/hr covers a `deficit`. Pure presentation. The unit suffixes localize
// via an optional translator (`format.eta.sec|min|hr|day`); falls back to compact ASCII when none is passed.
export function fmtEta(deficit: number, rate: number, tr?: (k: string) => string): string {
  if (deficit <= 0) return ''
  if (rate <= 0) return '—'
  const u = (k: string, d: string) => (tr ? tr(k) : d)
  const sec = (deficit / rate) * 3600
  if (sec < 90) return `~${Math.max(1, Math.ceil(sec))}${u('format.eta.sec', 's')}`
  if (sec < 5400) return `~${Math.round(sec / 60)}${u('format.eta.min', 'm')}`
  const hours = sec / 3600
  if (hours < 48) return `~${Math.round(hours)}${u('format.eta.hr', 'h')}`
  return `~${Math.round(hours / 24)}${u('format.eta.day', 'd')}`
}
