# shape-gacha signalling relay

A minimal, **Trystero-compatible Nostr relay** running on a single **Cloudflare Durable Object**. It exists
only to broker WebRTC handshakes for **Chatlas Plus**: peers exchange SDP/ICE through here, then talk
**directly peer-to-peer**. The messages players send each other never pass through this relay — it sees only
the signalling handshake (and, like any WebSocket server, the connecting IPs).

It is **store-nothing**. Signalling events are ephemeral (Nostr kinds 20000–29999) and fanned out live to
currently-connected subscribers; nothing is ever written to durable storage. When the last peer disconnects,
the relay remembers nothing.

## Why no Terraform

For one Worker + one Durable Object, **`wrangler.jsonc` _is_ the infrastructure-as-code** — it declares the
Worker, the DO binding, the migration, CPU limits, and observability, all committed here and reconciled by
`wrangler deploy`. Terraform would only earn its place if you managed many Cloudflare resources (DNS, R2,
Zero Trust, multiple zones) under one state file, and it fights wrangler over ownership of the Worker script.
The only thing wrangler can't express is a **billing alert** — see [`scripts/set-billing-alert.sh`](./scripts/set-billing-alert.sh),
a one-shot API call you run once (only relevant if you move off the free plan).

## Cost controls (the real "billing quota")

Cloudflare has **no hard monetary spend cap** on Workers. On the **free plan**, though, your spend is
structurally **$0**: exceed the free limits and requests are throttled/rejected, never billed. The relay is
deliberately built to live within the free tier:

| Lever | Where | Purpose |
|---|---|---|
| **Free-tier eligibility** | `migrations: new_sqlite_classes` in `wrangler.jsonc` | SQLite-backed DOs are the one DO flavour allowed on the **free** Workers plan. We never write to it — it's purely what unlocks free pricing. |
| **WebSocket Hibernation** | `state.acceptWebSocket()` in `src/index.ts` | Idle connections are evicted from memory → ≈ no duration billing while players sit idle. |
| **CPU ceiling** | `limits.cpu_ms: 200` | A runaway/abusive handshake can't burn unbounded CPU. |
| **Connection cap** | `MAX_CONNECTIONS` (var, default 400) | Bounds memory + fan-out per instance. |
| **Rate limit + size cap** | in `src/index.ts` | 80 msgs / 10s / socket; 8 KB max message. |

## Deploy

```sh
cd relay
pnpm install
pnpm typecheck                # tsc --noEmit
pnpm build                    # wrangler deploy --dry-run (bundles, no upload, no auth)

# first real deploy (uses your existing wrangler auth):
npx wrangler login            # if not already logged in
pnpm deploy                   # wrangler deploy  → prints https://shape-gacha-relay.<subdomain>.workers.dev
```

You do **not** need a custom domain — the `*.workers.dev` URL works as a `wss://` relay.

## Wire it into the web client

Point the client's relay set at your deployed URL (in `web/src/chatlas/trysteroTransport.ts`):

```ts
// fully self-hosted — no public relays
export const CHATLAS_RELAYS = ['wss://shape-gacha-relay.gyng.workers.dev/?k=sg-chatlas-relay-1']
```

The `?k=` is the **soft app-scoping** key (see `APP_KEY` in `wrangler.jsonc`). Our relay turns away any connection
without it (403), so the public Nostr network can't use it as an open relay. It is *not* a secret — it ships in
the client bundle — it just stops casual/accidental misuse. Change it in `wrangler.jsonc` + here together. Real
per-user access control would require a backend, which is exactly what we're avoiding.

Going solo (no public fallback) means the relay is a **single point of failure**: if it's unreachable, peers
can't discover each other and Chatlas falls back to the synthetic feed (the UI never breaks). To trade some
self-hosting for resilience, append a public relay or two — but then signalling can flow through them as well.

Including your relay in everyone's set guarantees peers overlap on at least one relay (so they discover each
other); the public relays are belt-and-suspenders if yours is briefly unreachable. To go fully self-hosted,
list only your URL.

## Scaling

One global DO instance handles all rooms; room isolation is enforced by the `#x` topic-tag match, not by DO
identity. Signalling traffic is tiny (a handshake burst, then silence + hibernation), so one instance goes a
long way. If it ever saturates, deploy additional relay URLs (each its own global DO) and list them all in
`CHATLAS_RELAYS` — Trystero connects to several with redundancy.

## Health

`GET /health` → `ok`. Everything else upgrades to a WebSocket.
