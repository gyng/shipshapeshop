// Reactive view of the Chatlas Plus opt-in, so the settings panel and the feed both update the instant a
// toggle flips. Mirrors the codebase's small-store idiom (useMute/useGfx); the localStorage truth lives in
// chatlasPlus.ts and this store just wraps it. Revoking master consent cascades the sub-scopes off (the
// persistence helper clears them), so we re-read both after every consent change.
import { create } from 'zustand'
import { getProfile, hasConsented, rerollProfile, scopeEnabled, setConsent, setProfileColor, setScope } from './chatlasPlus'
import type { ChatlasProfile } from './transport'

interface ChatlasPlusStore {
  consent: boolean
  events: boolean
  chat: boolean
  profile: ChatlasProfile // the curator identity shown to others; persisted on-device
  setConsent: (on: boolean) => void
  setEvents: (on: boolean) => void
  setChat: (on: boolean) => void
  rerollProfile: () => void
  setProfileColor: (color: string) => void
}

export const useChatlasPlus = create<ChatlasPlusStore>((set) => ({
  consent: hasConsented(),
  events: scopeEnabled('events'),
  chat: scopeEnabled('chat'),
  profile: getProfile(),
  setConsent: (on) => {
    setConsent(on)
    set({ consent: on, events: scopeEnabled('events'), chat: scopeEnabled('chat') })
  },
  setEvents: (on) => {
    setScope('events', on)
    set({ events: scopeEnabled('events') })
  },
  setChat: (on) => {
    setScope('chat', on)
    set({ chat: scopeEnabled('chat') })
  },
  // Identity edits persist (chatlasPlus) and update reactive state; the live transport reads the latest
  // profile per message (via the getter passed at connect), so changes show to peers without a reconnect.
  rerollProfile: () => set({ profile: rerollProfile() }),
  setProfileColor: (color) => set({ profile: setProfileColor(color) }),
}))
