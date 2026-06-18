import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// vite-plugin-wasm + top-level-await let us load the wasm-pack (`--target web`) core module.
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  test: {
    environment: 'jsdom',
  },
})
