// Screenshot rig for the README.
//
// Builds are assumed done (`pnpm build`); this serves web/dist with Vite's preview server, drives a headless
// Chromium through the key screens via the number-key tab shortcuts (1=Engine/Orrery … 9=Ledger — see App.tsx
// TABS), and writes retina PNGs to ../docs/screenshots/.
//
//   pnpm screenshots            # from web/ (chains the build) — or `node scripts/screenshots.mjs` after a build
//
// Needs Playwright's Chromium once:  npx playwright install chromium

import { chromium } from 'playwright'
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(webRoot, '../docs/screenshots')

// number-key → screen (App.tsx: TABS = engine, workshop, gacha, room, chatlas, gallery, forge, shop, ledger)
const SHOTS = [
  { name: 'gacha', key: '3' },
  { name: 'gallery', key: '6' },
  { name: 'orrery', key: '1' },
  { name: 'forge', key: '7' },
  { name: 'ledger', key: '9' },
]

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await mkdir(outDir, { recursive: true })
  const server = await preview({ root: webRoot, preview: { port: 4188, open: false } })
  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:4188/'
  console.log(`[screenshots] serving ${url}`)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  // Pre-seed prefs BEFORE the app boots: mark the onboarding tour as seen (otherwise it auto-runs and forces
  // the active tab to its current step, so our tab navigation never sticks) and pre-dismiss the corner nudges.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('shipshape-tour-v1', '1')
      localStorage.setItem('shipshape-hints-v1', '["deploy","forge","prestige","engine"]')
    } catch {
      /* ignore */
    }
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await wait(3000) // let the WASM core boot + the first 3D canvas warm up
  // dismiss the first-run "Atlas" welcome (its CTA) — which then kicks off the onboarding tour…
  await page
    .getByRole('button', { name: /Begin/i })
    .click({ timeout: 5000 })
    .catch(() => {})
  await wait(1000)
  // …so finish the tour (its Skip button) — it otherwise pins the active tab to its current step. Wait for the
  // button, then force-click, then confirm it's gone (one Skip calls finish()).
  for (let i = 0; i < 5; i++) {
    const skip = page.getByRole('button', { name: 'Skip' })
    if (!(await skip.isVisible().catch(() => false))) break
    await skip.click({ force: true }).catch(() => {})
    await wait(600)
  }
  await page.keyboard.press('Escape').catch(() => {})
  await wait(500)

  for (const shot of SHOTS) {
    await page.keyboard.press(shot.key)
    await wait(2200) // tab transition + 3D scene settle
    const path = resolve(outDir, `${shot.name}.png`)
    await page.screenshot({ path })
    console.log(`[screenshots] wrote ${path}`)
  }

  await browser.close()
  await server.close()
  console.log('[screenshots] done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
