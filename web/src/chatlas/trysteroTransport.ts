// The live events transport — Trystero over a random event shard. Trystero borrows public infrastructure
// (Nostr relays, by default, in this build) purely for *signalling*; the actual events then travel **direct
// peer-to-peer** over a WebRTC data channel and never touch any server we run. We hold no data; the relay
// sees only the handshake metadata, not the messages.
//
// This module statically imports `trystero`, so it must only ever be loaded via dynamic import() from the
// opt-in path — that keeps the WebRTC/relay code (and ~tens of KB) out of the main bundle and out of tests
// until a player actually turns Chatlas Plus on.
import { joinRoom } from 'trystero'
import { CHATLAS_APP_ID, randomShardRoomId } from './rooms'
import type { ChatlasTransport, ChatlasEvent, ChatlasProfile, ChatMessage, PeerEvent, RosterEntry } from './transport'

// Signalling relay — fully self-hosted, no public relays. This is our own soft-restricted relay (Cloudflare
// Worker + Durable Object, see /relay): it turns away anyone not carrying the `?k=` app key, so it's not an
// open public relay, and ALL signalling stays on infrastructure we control (no third-party relay ever sees
// the handshake or the connecting IPs). Trade-off of going solo: it's a single point of failure — if the
// relay is unreachable, peers can't discover each other and Chatlas falls back to the synthetic feed (so the
// UI never breaks, you just don't see live players). The `?k=` value must match APP_KEY in /relay/wrangler.jsonc.
//
// Privacy: our relay still sees your IP and the SDP's ICE candidates (any WebSocket server does) — only
// Tor/VPN hides that — but now that's *our* server, not a stranger's. The room topic is hashed by Trystero,
// so it travels as an opaque tag.
export const CHATLAS_RELAYS = ['wss://shape-gacha-relay.gyng.workers.dev/?k=sg-chatlas-relay-1']

// What actually goes on the wire: the sender's display identity + the structured event. Profile rides along
// per-message (stateless) so a peer who joined mid-stream still knows who said what without a hello handshake.
// A `type` (not `interface`) so it satisfies Trystero's JSON `DataPayload` constraint on makeAction<T>.
type Wire = {
  p: ChatlasProfile
  e: ChatlasEvent
}

// `profileOf` is a getter (not a value) so identity edits (re-roll / colour) show to peers on the next message
// without tearing down the room.
export function createEventsTransport(profileOf: () => ChatlasProfile, relays: string[] = CHATLAS_RELAYS): ChatlasTransport {
  const room = joinRoom(
    { appId: CHATLAS_APP_ID, relayConfig: { urls: relays, redundancy: Math.min(4, relays.length) } },
    randomShardRoomId('events'),
  )
  // Namespace ≤ 12 bytes (Trystero limit). 'evt' = structured events, 'hello' = presence, 'chat' = free text.
  const evt = room.makeAction<Wire>('evt')
  const hi = room.makeAction<{ p: ChatlasProfile }>('hello')
  const chat = room.makeAction<{ p: ChatlasProfile; t: string }>('chat')
  const typing = room.makeAction<{ p: ChatlasProfile }>('type')

  const MAX_CHAT_LEN = 280

  const eventCbs = new Set<(e: PeerEvent) => void>()
  const chatCbs = new Set<(m: ChatMessage) => void>()
  const typingCbs = new Set<(p: ChatlasProfile) => void>()
  const rosterCbs = new Set<(r: RosterEntry[]) => void>()
  const roster = new Map<string, ChatlasProfile>() // peerId → their profile (who is "here")

  const snapshot = (): RosterEntry[] => [...roster].map(([peerId, p]) => ({ peerId, profile: p }))
  const emitRoster = () => {
    const s = snapshot()
    rosterCbs.forEach((cb) => cb(s))
  }
  const learn = (peerId: string, p: ChatlasProfile) => {
    if (!p || typeof p.handle !== 'string') return // untrusted peer; ignore malformed identity
    const known = roster.has(peerId)
    roster.set(peerId, p)
    if (!known) emitRoster()
  }

  evt.onMessage = (data, ctx) => {
    // Defensive: peers are untrusted. Drop anything that isn't our shape before it reaches the feed.
    if (!data || typeof data !== 'object' || !data.e || !data.p) return
    learn(ctx.peerId, data.p) // also learn identity from activity, in case a hello was missed
    eventCbs.forEach((cb) => cb({ profile: data.p, event: data.e, peerId: ctx.peerId }))
  }
  hi.onMessage = (data, ctx) => {
    if (data?.p) learn(ctx.peerId, data.p)
  }
  chat.onMessage = (data, ctx) => {
    // Untrusted: require a non-empty string and clamp length before it reaches the UI.
    if (!data?.p || typeof data.t !== 'string') return
    const text = data.t.slice(0, MAX_CHAT_LEN).trim()
    if (!text) return
    learn(ctx.peerId, data.p)
    chatCbs.forEach((cb) => cb({ profile: data.p, text, peerId: ctx.peerId }))
  }
  typing.onMessage = (data, ctx) => {
    if (!data?.p || typeof data.p.handle !== 'string') return
    learn(ctx.peerId, data.p)
    typingCbs.forEach((cb) => cb(data.p))
  }

  // When a direct P2P channel opens, both sides fire onPeerJoin — so greet that one peer and we each learn the
  // other's identity. onPeerJoin means the channel is ready, so there's no race and no broadcast storm.
  room.onPeerJoin = (peerId) => void hi.send({ p: profileOf() }, { target: peerId })
  room.onPeerLeave = (peerId) => {
    if (roster.delete(peerId)) emitRoster()
  }

  return {
    send: (event) => void evt.send({ p: profileOf(), e: event }),
    sendChat: (text) => {
      const t = text.slice(0, MAX_CHAT_LEN).trim()
      if (t) void chat.send({ p: profileOf(), t })
    },
    sendTyping: () => void typing.send({ p: profileOf() }),
    onEvent: (cb) => {
      eventCbs.add(cb)
      return () => eventCbs.delete(cb)
    },
    onChat: (cb) => {
      chatCbs.add(cb)
      return () => chatCbs.delete(cb)
    },
    onTyping: (cb) => {
      typingCbs.add(cb)
      return () => typingCbs.delete(cb)
    },
    onRoster: (cb) => {
      cb(snapshot()) // immediate snapshot
      rosterCbs.add(cb)
      return () => rosterCbs.delete(cb)
    },
    leave: () => void room.leave(),
  }
}
