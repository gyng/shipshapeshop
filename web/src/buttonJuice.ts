// Cursor-tracking sheen + click ripple + hover motes for the primary CTA caps. Done with event delegation so a
// SINGLE listener set covers every such button — the raw pull buttons AND the design-system Button atom — with
// no per-button wiring, and it keeps working for buttons mounted later. Pure presentation (feel layer).

let installed = false

// Primary CTAs that get the celebratory juice: the main pull caps + the modal `.btn-primary` confirm buttons.
const PRIMARY_SEL = '.pull-cap, .btn-primary'

// Hover motes: while the pointer is over a primary button, gently emit small specks that rise off its TOP edge
// and fade. Throttled (~1 every 120ms), capped per-button, stops on mouse-leave, cleaned up on unmount/leave.
const MOTE_INTERVAL = 120 // ms between specks
const MOTE_CAP = 8 // max concurrent motes per hovered button (cheap)
const MOTE_HUES = ['#ffcf6b', '#ffe6a8', '#7fe0cf', '#9fe6ff'] // soft gold + teal — matches the floaters
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function spawnMote(btn: HTMLElement, live: { n: number }): void {
  if (live.n >= MOTE_CAP) return
  const r = btn.getBoundingClientRect()
  if (r.width === 0) return
  const m = document.createElement('span')
  m.className = 'btn-mote'
  const sz = 4 + Math.random() * 5
  m.style.left = `${r.left + Math.random() * r.width}px` // random x along the top edge
  m.style.top = `${r.top + 2}px`
  m.style.setProperty('--bmsz', `${sz}px`)
  m.style.setProperty('--bmc', MOTE_HUES[(Math.random() * MOTE_HUES.length) | 0])
  m.style.setProperty('--bmx', `${(Math.random() * 2 - 1) * 14}px`) // gentle horizontal drift
  m.style.setProperty('--bmrise', `${24 + Math.random() * 22}px`)
  m.style.setProperty('--bmdur', `${950 + Math.random() * 450}ms`)
  live.n++
  const done = () => {
    live.n--
    m.remove()
  }
  m.addEventListener('animationend', done)
  document.body.appendChild(m)
}

export function installButtonJuice(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

  // One hover emitter at a time (the currently-hovered primary button). pointerover/out bubble through delegation,
  // so this transparently handles buttons mounted later and never leaks an interval once the pointer leaves.
  let hoverTimer: ReturnType<typeof setInterval> | null = null
  let hoverBtn: HTMLElement | null = null
  const stopHover = () => {
    if (hoverTimer) clearInterval(hoverTimer)
    hoverTimer = null
    hoverBtn = null
  }
  document.addEventListener('pointerover', (e) => {
    if (prefersReducedMotion()) return
    const btn = (e.target as HTMLElement | null)?.closest?.(PRIMARY_SEL) as HTMLButtonElement | null
    if (!btn || btn === hoverBtn || btn.disabled || btn.hasAttribute('disabled')) return
    stopHover()
    hoverBtn = btn
    const live = { n: 0 }
    hoverTimer = setInterval(() => {
      // bail if the button left the DOM or went disabled mid-hover
      if (!hoverBtn || !hoverBtn.isConnected || (hoverBtn as HTMLButtonElement).disabled) return stopHover()
      spawnMote(hoverBtn, live)
    }, MOTE_INTERVAL)
  })
  document.addEventListener('pointerout', (e) => {
    if (!hoverBtn) return
    // only stop when the pointer actually leaves the hovered button (ignore moves between its children)
    const to = (e as PointerEvent).relatedTarget as Node | null
    if (to && hoverBtn.contains(to)) return
    stopHover()
  })

  // feed the pointer's position (as a %) into CSS vars on the hovered cap → the ::after sheen follows the mouse
  document.addEventListener(
    'pointermove',
    (e) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('.pull-cap') as HTMLElement | null
      if (!btn) return
      const r = btn.getBoundingClientRect()
      btn.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`)
      btn.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`)
    },
    { passive: true },
  )

  // spawn a ripple ring from the exact press point (self-removing span — no React involvement)
  document.addEventListener(
    'pointerdown',
    (e) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('.pull-cap') as HTMLButtonElement | null
      if (!btn || btn.disabled) return
      const r = btn.getBoundingClientRect()
      const d = Math.max(r.width, r.height)
      const rip = document.createElement('span')
      rip.className = 'btn-ripple'
      rip.style.width = `${d}px`
      rip.style.height = `${d}px`
      rip.style.left = `${e.clientX - r.left - d / 2}px`
      rip.style.top = `${e.clientY - r.top - d / 2}px`
      rip.addEventListener('animationend', () => rip.remove())
      btn.appendChild(rip)
    },
    { passive: true },
  )
}
