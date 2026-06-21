// shape-gacha signalling relay — a minimal, Trystero-compatible Nostr relay on a Cloudflare Durable Object.
//
// It exists only to broker WebRTC handshakes: Chatlas Plus peers exchange SDP/ICE through here, then talk
// **directly peer-to-peer**. Messages between players never touch this relay — it sees only the signalling
// handshake. It is also **store-nothing**: events are ephemeral (Nostr kinds 20000–29999) and fanned out live
// to currently-subscribed peers; nothing is ever written to durable storage. When every peer disconnects, the
// relay remembers nothing.
//
// Trystero's nostr strategy speaks a tiny slice of NIP-01:
//   • publish:   ["EVENT", {kind, tags:[["x",topic]], created_at, content, pubkey, id, sig}]
//   • subscribe: ["REQ", subId, {kinds:[…], since, "#x":[topic,…]}]
//   • close:     ["CLOSE", subId]
// Rooms are identified by the hashed `topic` carried in the `x` tag, so fan-out is just: forward each EVENT to
// every other socket holding a subscription whose `#x` matches. One global DO instance handles all rooms; the
// `#x` match keeps rooms isolated from each other.

export interface Env {
  RELAY: DurableObjectNamespace
  MAX_CONNECTIONS?: string
  // Soft app-scoping key. Clients must present it as `?k=<APP_KEY>`. NOT real auth — it ships in the client
  // bundle, so it's extractable — but it stops the broader public Nostr network and casual misuse from using
  // this as an open relay. Leave unset to run fully open.
  APP_KEY?: string
}

// --- cost / abuse caps (the real "billing quota": bound memory, fan-out, and message volume) -------------
const MAX_CONNECTIONS_DEFAULT = 400 // per DO instance; rejects new sockets past this
const MAX_SUBS_PER_CONN = 16 // a peer needs only a few; cap to bound per-socket state
const MAX_MSG_BYTES = 8 * 1024 // signalling messages are small; reject anything larger
const RATE_LIMIT_MSGS = 80 // messages…
const RATE_LIMIT_WINDOW_MS = 10_000 // …per rolling window, per socket

interface Filter {
  kinds?: number[]
  ['#x']?: string[]
}

interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

// Per-socket state, kept in the hibernation attachment so it survives the DO being evicted from memory while
// idle. Small by construction (a few short subscriptions) — well under the attachment size budget.
interface Att {
  subs: Record<string, Filter>
  rl: { n: number; t: number }
}

const notice = (text: string) => JSON.stringify(['NOTICE', text])

// Does this room subscription match this event? Scoped strictly by the `x` topic tag (room identity), with an
// optional kind check. `since`/`until` are deliberately ignored: this is a live-only relay with no stored
// events, and honouring `since` against skewed peer clocks would silently drop valid handshakes.
function matches(f: Filter, ev: NostrEvent): boolean {
  const xs = f['#x']
  if (!xs || xs.length === 0) return false // room scoping is required — never broadcast across all rooms
  if (!ev.tags.some((t) => t[0] === 'x' && xs.includes(t[1]))) return false
  if (f.kinds && !f.kinds.includes(ev.kind)) return false
  return true
}

export class RelayDO {
  state: DurableObjectState
  env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('shape-gacha signalling relay (nostr-compatible). Connect over WebSocket.', { status: 426 })
    }
    const max = Number(this.env.MAX_CONNECTIONS ?? MAX_CONNECTIONS_DEFAULT)
    if (this.state.getWebSockets().length >= max) {
      return new Response('relay at capacity', { status: 503 })
    }
    const { 0: client, 1: server } = new WebSocketPair()
    // Hibernatable accept: idle connections are evicted from memory (≈ no duration billing) and rehydrated
    // with their attachment intact when a message arrives.
    this.state.acceptWebSocket(server)
    server.serializeAttachment({ subs: {}, rl: { n: 0, t: 0 } } satisfies Att)
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_MSG_BYTES) {
      ws.send(notice('message empty or too large'))
      return
    }
    const att = (ws.deserializeAttachment() as Att | null) ?? { subs: {}, rl: { n: 0, t: 0 } }

    // Per-socket rolling-window rate limit.
    const now = Date.now()
    if (now - att.rl.t > RATE_LIMIT_WINDOW_MS) att.rl = { n: 0, t: now }
    att.rl.n++
    if (att.rl.n > RATE_LIMIT_MSGS) {
      ws.serializeAttachment(att)
      ws.send(notice('rate limited'))
      return
    }

    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      ws.serializeAttachment(att)
      ws.send(notice('invalid json'))
      return
    }
    if (!Array.isArray(msg)) {
      ws.serializeAttachment(att)
      return
    }

    const type = msg[0]
    if (type === 'EVENT') {
      const ev = msg[1] as NostrEvent
      ws.serializeAttachment(att) // persist the rate-limit tick
      if (!ev || typeof ev.id !== 'string' || typeof ev.kind !== 'number' || !Array.isArray(ev.tags)) return
      // Soft-scope: only ephemeral signalling kinds (Trystero uses 20000–29999). Drop anything else so this
      // can't double as a general-purpose relay for normal Nostr notes.
      if (ev.kind < 20000 || ev.kind >= 30000) return
      ws.send(JSON.stringify(['OK', ev.id, true, '']))
      // Live fan-out to every *other* socket whose subscription matches this room.
      for (const peer of this.state.getWebSockets()) {
        if (peer === ws) continue
        const patt = peer.deserializeAttachment() as Att | null
        if (!patt) continue
        for (const [subId, filter] of Object.entries(patt.subs)) {
          if (matches(filter, ev)) {
            try {
              peer.send(JSON.stringify(['EVENT', subId, ev]))
            } catch {
              /* peer socket gone; ignore */
            }
            break // one delivery per peer is enough
          }
        }
      }
    } else if (type === 'REQ') {
      const subId = String(msg[1])
      const filter = (msg[2] as Filter) ?? {}
      const existing = Object.keys(att.subs)
      if (!att.subs[subId] && existing.length >= MAX_SUBS_PER_CONN) delete att.subs[existing[0]] // evict oldest
      att.subs[subId] = { kinds: filter.kinds, ['#x']: filter['#x'] }
      ws.serializeAttachment(att)
      ws.send(JSON.stringify(['EOSE', subId])) // no stored events — end of (empty) backlog immediately
    } else if (type === 'CLOSE') {
      const subId = String(msg[1])
      delete att.subs[subId]
      ws.serializeAttachment(att)
      ws.send(JSON.stringify(['CLOSED', subId, '']))
    } else {
      ws.serializeAttachment(att)
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason)
    } catch {
      /* already closing */
    }
  }

  webSocketError() {
    /* transport error — the socket is torn down automatically; nothing to persist */
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/health') return new Response('ok\n', { status: 200 })
    // Soft app-scoping: when APP_KEY is configured, require it as `?k=…`. The broader public Nostr network
    // connects to the bare URL with no key and is turned away here, before a socket is ever accepted.
    if (env.APP_KEY && url.searchParams.get('k') !== env.APP_KEY) {
      return new Response('forbidden', { status: 403 })
    }
    // Every connection routes to one global DO instance; room isolation is enforced by the `#x` tag match,
    // not by DO identity. If a single instance ever saturates, deploy additional relay URLs (each its own
    // global DO) and list them all in the client's relay set — Trystero connects to several with redundancy.
    const stub = env.RELAY.get(env.RELAY.idFromName('global'))
    return stub.fetch(req)
  },
}
