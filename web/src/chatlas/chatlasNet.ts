// App-level singleton for the Chatlas Plus events transport. The connection must outlive the Chatlas tab so
// that notable events (e.g. a rare pull on the Gacha screen) can broadcast from anywhere the player is opted
// in. Lifecycle is driven by <ChatlasNetDriver> (watching the events scope); components read via useChatlasFeed;
// producers broadcast via chatlasBroadcast. Everything here is feel-layer — nothing flows back into game truth.
import { getProfile } from './chatlasPlus'
import { nullTransport, type ChatlasEvent, type ChatlasProfile, type ChatlasTransport, type ChatMessage, type PeerEvent, type RosterEntry } from './transport'

let tx: ChatlasTransport = nullTransport
let token = 0 // bumped on each connect/disconnect to invalidate an in-flight lazy import
let connecting = false
let offEvent = () => {}
let offChat = () => {}
let offTyping = () => {}
let offRoster = () => {}
let lastRoster: RosterEntry[] = []
// Small ring buffers of recent peer events + chat, so opening the Plus tab shows recent activity rather than an
// empty feed (both are otherwise live-only). Cleared on disconnect — we persist nothing.
const RECENT_MAX = 40
let recent: PeerEvent[] = []
let recentChat: ChatMessage[] = []
const eventSubs = new Set<(e: PeerEvent) => void>()
const chatSubs = new Set<(m: ChatMessage) => void>()
const typingSubs = new Set<(p: ChatlasProfile) => void>()
const rosterSubs = new Set<(r: RosterEntry[]) => void>()

export function chatlasConnect(): void {
  if (tx !== nullTransport || connecting) return
  connecting = true
  const my = ++token
  void import('./trysteroTransport')
    .then(({ createEventsTransport }) => {
      if (my !== token) return // disconnected before the import resolved
      tx = createEventsTransport(getProfile) // pass the getter so identity edits apply without a reconnect
      offEvent = tx.onEvent((e) => {
        recent = recent.length >= RECENT_MAX ? [...recent.slice(1), e] : [...recent, e]
        eventSubs.forEach((cb) => cb(e))
      })
      offChat = tx.onChat((m) => {
        recentChat = recentChat.length >= RECENT_MAX ? [...recentChat.slice(1), m] : [...recentChat, m]
        chatSubs.forEach((cb) => cb(m))
      })
      offTyping = tx.onTyping((p) => typingSubs.forEach((cb) => cb(p)))
      offRoster = tx.onRoster((r) => {
        lastRoster = r
        rosterSubs.forEach((cb) => cb(r))
      })
    })
    .catch(() => {
      /* relays unreachable — stay disconnected, the feed falls back to synthetic */
    })
    .finally(() => {
      if (my === token) connecting = false
    })
}

export function chatlasDisconnect(): void {
  token++ // invalidate any in-flight connect
  connecting = false
  offEvent()
  offChat()
  offTyping()
  offRoster()
  offEvent = () => {}
  offChat = () => {}
  offTyping = () => {}
  offRoster = () => {}
  tx.leave()
  tx = nullTransport
  lastRoster = []
  recent = []
  recentChat = []
  rosterSubs.forEach((cb) => cb([]))
}

// Send a structured event to the room. No-ops when disconnected, so producers can call it unconditionally.
export function chatlasBroadcast(e: ChatlasEvent): void {
  tx.send(e)
}

// Send a free-text chat line (gated by the chat scope at the call site). No-ops when disconnected.
export function chatlasSendChat(text: string): void {
  tx.sendChat(text)
}

// Broadcast a transient "I'm typing" ping. No-ops when disconnected.
export function chatlasSendTyping(): void {
  tx.sendTyping()
}

export function onChatlasTyping(cb: (p: ChatlasProfile) => void): () => void {
  typingSubs.add(cb)
  return () => typingSubs.delete(cb)
}

// Recent peer events / chat (oldest → newest) — used to seed a freshly-opened feed with what just happened.
export function getRecentEvents(): PeerEvent[] {
  return recent
}

export function getRecentChat(): ChatMessage[] {
  return recentChat
}

export function onChatlasEvent(cb: (e: PeerEvent) => void): () => void {
  eventSubs.add(cb)
  return () => eventSubs.delete(cb)
}

export function onChatlasChat(cb: (m: ChatMessage) => void): () => void {
  chatSubs.add(cb)
  return () => chatSubs.delete(cb)
}

export function onChatlasRoster(cb: (r: RosterEntry[]) => void): () => void {
  cb(lastRoster) // immediate snapshot
  rosterSubs.add(cb)
  return () => rosterSubs.delete(cb)
}
