// Compile-time dev-toolbar flag. Kept ON during development; flip to `false` before release and the dev UI
// (the 🛠 toolbar + its actions) is dead-code-eliminated from the production bundle by esbuild/Rollup.
export const DEV_MODE = true
