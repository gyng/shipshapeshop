import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Flat config (ESLint 10). Lints the TS/TSX source for real correctness bugs — rules-of-hooks, dead code,
// unsafe patterns — without the heavy type-checked rules (kept off so lint stays fast and the prime-directive
// pragmatic `any` at the wasm boundary isn't a hard error). Formatting is left to the editor.
export default tseslint.config(
  { ignores: ['dist/**', 'public/**', 'scripts/**', 'src/vite-env.d.ts'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Off by design: this app co-locates helpers/constants with their components (Atomic-Design organisms),
      // so the Fast-Refresh "components-only export" boundary is perpetual noise here, not a real signal.
      'react-refresh/only-export-components': 'off',
      // dead code is a real bug; `_`-prefixed args/vars/catches are intentionally unused
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // pragmatic `any` (wasm interop, three.js uniforms) is a warning, not a build-breaker
      '@typescript-eslint/no-explicit-any': 'warn',
      // empty catch blocks are an intentional "ignore" idiom throughout (persist/localStorage guards)
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
