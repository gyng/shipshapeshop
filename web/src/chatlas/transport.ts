// The wire shape + transport contract for Chatlas Plus. The events channel carries **structured payloads
// only** — never free text — so a fixed message shape can't be used to harass, which is the whole moderation
// story in a world where we run no backend and have no takedown chokepoint. This stays purely feel-layer:
// Rust truth never touches the wire; these are presentation events derived from it.
import type { ChatMsg } from '../content/chatlas'
import { MILESTONE_INFO } from '../content/milestones'

// A throwaway on-device display identity (see chatlasPlus.getProfile). Not an account.
// A `type` (not `interface`) so it satisfies Trystero's JSON `DataPayload` constraint when sent on the wire.
export type ChatlasProfile = {
  handle: string
  color: string
}

// Broadcast notifications. None of these carry free text: `milestone` sends a milestone *key* that the
// receiver resolves against its own local content table (so a peer can only trigger a known line, never inject
// arbitrary text); `announce` references a fixed allow-list. The channel stays un-abusable.
export type ChatlasEvent =
  | { k: 'sticker'; sticker: number }
  | { k: 'pull'; nick: string; rarity: string } // rarity is a RarityName enum value (e.g. 'Ssr'), not free text
  | { k: 'forge'; nick: string } // the shape just discovered in the forge
  | { k: 'milestone'; key: string } // a core milestone key (e.g. 'core_complete'), resolved to text locally
  | { k: 'announce'; id: AnnounceId }
  | { k: 'react'; to: string; emoji: string } // a quick reaction aimed at another curator's handle

export type AnnounceId = 'banner_rotated' | 'newcomer' | 'pity_reset'

export interface PeerEvent {
  profile: ChatlasProfile
  event: ChatlasEvent
  peerId: string
}

// One live peer in your shard — who is "here" right now. The roster is the first community primitive: presence.
export interface RosterEntry {
  peerId: string
  profile: ChatlasProfile
}

// A free-text chat line. Unlike events, chat is unstructured — which is exactly why it's a separate, explicit
// opt-in with the IP/abuse disclosure, and why the client offers mute. The sender's identity rides along.
export interface ChatMessage {
  profile: ChatlasProfile
  text: string
  peerId: string
}

// The transport contract. The synthetic generator (content/chatlas) is the always-on fallback; a real impl
// (trysteroTransport) implements this when the player has opted in and the room is live. One connection serves
// both the structured events channel and the free-text chat channel; scopes gate what is sent/shown.
export interface ChatlasTransport {
  send(event: ChatlasEvent): void
  sendChat(text: string): void
  sendTyping(): void
  onEvent(cb: (e: PeerEvent) => void): () => void
  onChat(cb: (m: ChatMessage) => void): () => void
  // A transient "I'm composing" ping (no payload beyond identity); never buffered.
  onTyping(cb: (profile: ChatlasProfile) => void): () => void
  // Presence: fires with the current set of live peers (with their identities) whenever it changes. Subscribers
  // get an immediate snapshot on subscribe.
  onRoster(cb: (roster: RosterEntry[]) => void): () => void
  leave(): void
}

// A no-op transport: the safe default when Chatlas Plus is off or unavailable. Sends vanish, nothing arrives.
export const nullTransport: ChatlasTransport = {
  send: () => {},
  sendChat: () => {},
  sendTyping: () => {},
  onEvent: () => () => {},
  onChat: () => () => {},
  onTyping: () => () => {},
  onRoster: () => () => {},
  leave: () => {},
}

// Fixed copy for the templated broadcasts. Hardcoded English to match content/chatlas.ts today; both move to
// i18n message ids together as a follow-up (the schema already keys events by id, so it's a lift-and-shift).
const ANNOUNCE_TEXT: Record<AnnounceId, string> = {
  banner_rotated: 'a new shape just rotated onto the featured banner 👀',
  newcomer: 'a new curator just joined the Manifold — say hi 👋',
  pity_reset: 'someone just hit pity and walked away with the spark ✨',
}

// Render a received peer event into the existing ChatMsg shape the feed already knows how to draw. Stickers
// render as images; everything else becomes a short third-person line attributed to the sender's handle.
export function peerEventToMsg(e: PeerEvent): ChatMsg {
  const { handle, color } = e.profile
  switch (e.event.k) {
    case 'sticker':
      return { handle, color, text: '', sticker: e.event.sticker }
    case 'pull':
      return { handle, color, text: `pulled ${e.event.nick} · ${e.event.rarity.toUpperCase()}` }
    case 'forge':
      return { handle, color, text: `discovered ${e.event.nick} in the forge ✦` }
    case 'milestone': {
      // Resolve the key against OUR local table — the sender only chose which milestone, not the text.
      const info = MILESTONE_INFO[e.event.key]
      return { handle, color, text: info ? `${info.icon} ${info.name}` : 'reached a milestone' }
    }
    case 'announce':
      return { handle, color, text: ANNOUNCE_TEXT[e.event.id] }
    case 'react':
      return { handle, color, text: `${e.event.emoji} @${e.event.to}` }
  }
}
