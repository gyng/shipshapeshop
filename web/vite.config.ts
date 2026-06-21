import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Build identity for the in-app version indicator (Settings) — helps confirm which build is live (the known
// stale-service-worker gotcha, AGENTS.md §7). Build-time only (Node), never on the game's deterministic path.
const APP_VERSION = (() => {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim()
    return `${sha} · ${new Date().toISOString().slice(0, 10)}`
  } catch {
    return 'dev'
  }
})()

// vite-plugin-wasm + top-level-await load the wasm-pack (`--target web`) core; VitePWA makes it an
// installable, offline-capable PWA. registerType:'autoUpdate' + versioned precache addresses the
// known stale-service-worker gotcha (see AGENTS.md §7).
export default defineConfig({
  // Served from the domain root in dev/prod, but GitHub Pages project sites live under /<repo>/ — CI sets
  // BASE_PATH (e.g. "/shipshapeshop/") so the asset URLs resolve there. Defaults to "/" everywhere else.
  base: process.env.BASE_PATH || '/',
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Ship Shape Shop',
        short_name: 'ShapeShop',
        description: 'A gacha + idle game of mathematical shapes.',
        theme_color: '#0d0d16',
        background_color: '#0d0d16',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,svg}'],
        maximumFileSizeToCacheInBytes: 4_000_000,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // The wasm-pack (`--target web`) glue fetches its sibling `.wasm` at runtime via
  // `new URL('shipshape_core_bg.wasm', import.meta.url)`. If Vite pre-bundles the core into
  // `.vite/deps/`, that URL resolves to a non-existent `.vite/deps/*_bg.wasm` and the dev server
  // serves the SPA index.html fallback instead — WASM init then dies with "expected magic word".
  // Excluding the core keeps the glue beside its real `.wasm`, so the fetch resolves correctly.
  optimizeDeps: {
    exclude: ['shipshape-core'],
  },
  test: {
    environment: 'node',
  },
})
