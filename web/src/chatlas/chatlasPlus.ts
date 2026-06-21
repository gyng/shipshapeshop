// Chatlas Plus = the opt-in real-player layer. OFF by default, behind an explicit consent gate. Everything
// here is a device-local preference (localStorage, same `shipshape-*` convention as autoPull/secretary) — we
// run no backend and hold no data; these flags never leave the machine and are not part of the core save.
//
// Two independent sub-scopes sit under the master consent:
//   • events — broadcast notifications: your pulls/milestones fan out to a room; you see others'. Structured
//     payloads only (no free text), so the moderation surface is near-zero where we have no chokepoint.
//   • chat   — real-time text with other players (deferred; needs the IP-exposure consent + a mute story).
import type { ChatlasProfile } from './transport'

export type ChatlasScope = 'events' | 'chat'

const KEY = {
  consent: 'shipshape-chatlasplus', // master opt-in: the player has acknowledged the consent/IP disclosure
  events: 'shipshape-chatlas-events',
  chat: 'shipshape-chatlas-chat',
  profile: 'shipshape-chatlas-profile',
} as const

const scopeKey: Record<ChatlasScope, string> = { events: KEY.events, chat: KEY.chat }

const ls = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null)

// --- master consent -------------------------------------------------------------------------------------

export function hasConsented(): boolean {
  return ls()?.getItem(KEY.consent) === '1'
}

// Revoking consent also clears every sub-scope, so there is never a live scope without an active master gate.
export function setConsent(on: boolean): void {
  const s = ls()
  if (!s) return
  if (on) {
    s.setItem(KEY.consent, '1')
  } else {
    s.removeItem(KEY.consent)
    s.removeItem(KEY.events)
    s.removeItem(KEY.chat)
  }
}

// --- sub-scopes (only meaningful while consent is granted) ----------------------------------------------

export function scopeEnabled(scope: ChatlasScope): boolean {
  return hasConsented() && ls()?.getItem(scopeKey[scope]) === '1'
}

export function setScope(scope: ChatlasScope, on: boolean): void {
  const s = ls()
  if (!s) return
  if (on) s.setItem(scopeKey[scope], '1')
  else s.removeItem(scopeKey[scope])
}

// --- persisted curator identity -------------------------------------------------------------------------
// A handle + colour generated once and kept on-device, so "you" read as the same curator across sessions.
// It is a throwaway display identity, not an account — there is nothing to sign in to.

const ADJ = ['cozy', 'lil', 'soft', 'quiet', 'gentle', 'lone', 'tiny', 'velvet', 'amber', 'dusk', 'misty', 'lucid']
const NOUN = ['manifold', 'torus', 'klein', 'genus', 'euler', 'mobius', 'cusp', 'lattice', 'spinor', 'orbit', 'facet', 'prism']
const COLORS = ['#5fe0c6', '#ffb86b', '#b985ff', '#ff5d8f', '#9ef0ff', '#9aa6c2', '#ffd76b', '#ff9d6b', '#7fd0ff', '#c9a6ff']

function generateProfile(rnd: () => number = Math.random): ChatlasProfile {
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
  const suffix = String(10 + Math.floor(rnd() * 90))
  return { handle: `${pick(ADJ)}_${pick(NOUN)}${suffix}`, color: pick(COLORS) }
}

// The colour palette curators can pick from — exported for the identity editor UI.
export const PROFILE_COLORS = COLORS

function saveProfile(p: ChatlasProfile): ChatlasProfile {
  ls()?.setItem(KEY.profile, JSON.stringify(p))
  return p
}

// Load the saved identity, minting (and persisting) one on first use. Stable for the life of the browser.
export function getProfile(): ChatlasProfile {
  const raw = ls()?.getItem(KEY.profile)
  if (raw) {
    try {
      const p = JSON.parse(raw) as ChatlasProfile
      if (p && typeof p.handle === 'string' && typeof p.color === 'string') return p
    } catch {
      // fall through and re-mint on corrupt json
    }
  }
  return saveProfile(generateProfile())
}

// Mint a fresh random identity (new handle + colour) and persist it.
export function rerollProfile(): ChatlasProfile {
  return saveProfile(generateProfile())
}

// Keep the handle, change only the colour.
export function setProfileColor(color: string): ChatlasProfile {
  return saveProfile({ ...getProfile(), color })
}
