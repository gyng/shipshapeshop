import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'

// vite-plugin-wasm + top-level-await load the wasm-pack (`--target web`) core; VitePWA makes it an
// installable, offline-capable PWA. registerType:'autoUpdate' + versioned precache addresses the
// known stale-service-worker gotcha (see AGENTS.md §7).
export default defineConfig({
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
  test: {
    environment: 'node',
  },
})
