// Cursor-tracking sheen + click ripple for the primary CTA caps (`.pull-cap`). Done with event delegation so a
// SINGLE listener pair covers every such button — the raw pull buttons AND the design-system Button atom — with
// no per-button wiring, and it keeps working for buttons mounted later. Pure presentation (feel layer).

let installed = false

export function installButtonJuice(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

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
