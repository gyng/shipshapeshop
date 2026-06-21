// Dev/cheat-mode flag — gates the 🛠 toolbar + its actions.
//
// ON in development builds. In a production build it's OFF by default (so the toolbar never ships to players),
// but a tinkerer can flip it on from the console:
//
//     window.__CHEAT_MODE = true     // → persists + reloads with dev mode enabled
//     window.__CHEAT_MODE = false    // → turns it back off
//
// The flag is stored in localStorage so it survives the reload (and future loads); reading `window.__CHEAT_MODE`
// always reflects the persisted state.

const CHEAT_KEY = 'shipshape-cheat'

declare global {
  interface Window {
    __CHEAT_MODE: boolean
  }
}

if (typeof window !== 'undefined') {
  try {
    // honour the flag if it was already set as a plain value before this module ran
    if ((window as { __CHEAT_MODE?: unknown }).__CHEAT_MODE === true) localStorage.setItem(CHEAT_KEY, '1')
    Object.defineProperty(window, '__CHEAT_MODE', {
      configurable: true,
      get: () => localStorage.getItem(CHEAT_KEY) === '1',
      set: (v: boolean) => {
        if (v) localStorage.setItem(CHEAT_KEY, '1')
        else localStorage.removeItem(CHEAT_KEY)
        location.reload() // re-evaluate DEV_MODE with the new switch state
      },
    })
  } catch {
    /* localStorage / defineProperty unavailable — cheat mode just stays off */
  }
}

export const DEV_MODE: boolean =
  import.meta.env.DEV || (typeof window !== 'undefined' && localStorage.getItem(CHEAT_KEY) === '1')
