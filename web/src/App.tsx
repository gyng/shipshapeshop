import { useEffect, useRef, useState } from 'react'
import init, { tick, core_version } from 'shipshape-core'

/**
 * M0 scaffold: proves the Rust→WASM→React pipeline end-to-end.
 *
 * The architecture pattern is already modelled here even though the economy is a placeholder:
 * the number is computed in **Rust** (`tick`), accumulated cheaply per frame into a ref, and the
 * **display** is updated on a slow cadence (the real loop will never serialise across the WASM
 * boundary every frame). The real seeded economy replaces the placeholder rate in M1.
 */
export function App() {
  const [version, setVersion] = useState('loading core…')
  const [flux, setFlux] = useState(0)
  const fluxRef = useRef(0)

  useEffect(() => {
    let raf = 0
    let last = 0
    let displayTimer = 0

    init().then(() => {
      setVersion(core_version())
      last = performance.now()
      const loop = (now: number) => {
        const dt = (now - last) / 1000
        last = now
        fluxRef.current += tick(dt, 50) // placeholder rate; real Rust economy lands in M1
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    })

    displayTimer = window.setInterval(() => setFlux(fluxRef.current), 250)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(displayTimer)
    }
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, color: '#e8e8f0', background: '#0d0d14', minHeight: '100vh' }}>
      <h1 style={{ margin: 0 }}>Ship Shape Shop</h1>
      <p style={{ opacity: 0.6, marginTop: 4 }}>{version}</p>
      <p style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>✦ Flux: {Math.floor(flux).toLocaleString()}</p>
      <small style={{ opacity: 0.5 }}>M0 scaffold — Rust→WASM core driving the tick. Economy, gacha, and the gems come next.</small>
    </main>
  )
}
