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

// Navigate by the nav button's accessible NAME — resilient to tab reordering (the old number-key map silently
// broke when Expeditions was inserted at index 1: key '3' became Workshop, not gacha). `nav` matches the visible
// label; note the gacha screen is labelled "Pull" and the orrery is "Orrery".
const SHOTS = [
  { name: 'orrery', nav: 'Orrery' },
  { name: 'expeditions', nav: 'Expeditions' },
  { name: 'gacha', nav: 'Pull' },
  { name: 'gallery', nav: 'Gallery' },
  { name: 'forge', nav: 'Forge' },
  { name: 'ledger', nav: 'Ledger' },
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
    await page
      .locator('nav')
      .getByRole('button', { name: new RegExp('^' + shot.nav) })
      .first()
      .click()
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
