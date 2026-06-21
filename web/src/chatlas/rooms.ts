// Room-id derivation for Chatlas Plus — the opt-in P2P real-player layer (feel-layer only; we host nothing).
// "Named" vs "random" rooms are purely how the id string is derived, so both are trivial. These are pure +
// deterministic functions so they unit-test cleanly; nothing here is economy truth, so Math.random is fine
// (and is injected where used, for testable distribution).

// Namespaces every Trystero room so our traffic never collides with other apps on the shared signalling relays.
export const CHATLAS_APP_ID = 'shapegacha-chatlas-v1'

// Each Trystero room is a *full WebRTC mesh*, so one global room melts as the population grows (every peer
// holds N−1 connections). Events shard into a handful of rooms; each peer meets a live *sample* of the
// community — which is all "feels populated" needs. Tunable; could later grow with a presence estimate.
export const EVENT_SHARD_COUNT = 4

// FNV-1a — a tiny, stable string hash. Deterministic and platform-independent (32-bit, integer-only), so a
// given key always lands in the same shard. Feel-layer only — never used for any authoritative number.
export function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Stable shard for a key (e.g. a persisted client id): same key ⇒ same shard across sessions/devices.
export function shardRoomId(prefix: string, key: string, shardCount = EVENT_SHARD_COUNT): string {
  return `${prefix}:s${hashStr(key) % shardCount}`
}

// Fresh random shard per session: even spread + new neighbours each time you connect. `rnd` is injectable so
// the distribution is testable; defaults to Math.random (presentation only).
export function randomShardRoomId(prefix: string, shardCount = EVENT_SHARD_COUNT, rnd: () => number = Math.random): string {
  return `${prefix}:s${Math.floor(rnd() * shardCount)}`
}

// Named room — the name *is* the access token. There is no room directory, so knowing the string is the only
// way in; an unguessable name (an invite code) is therefore a private room.
export function namedRoomId(prefix: string, name: string): string {
  return `${prefix}:${name}`
}
