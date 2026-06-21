// End-to-end smoke test against the live (or local `wrangler dev`) relay. Simulates the slice of the Trystero
// nostr protocol we rely on: subscriber sends REQ, publisher sends a matching EVENT, subscriber must receive
// it fanned out. Also checks the soft-restriction gate (no key ⇒ rejected) and room isolation (wrong topic ⇒
// not delivered). Run: `node scripts/smoke.mjs [wss-url-with-key]`. Needs Node ≥ 22 (global WebSocket).
const BASE = process.argv[2] ?? 'wss://shape-gacha-relay.gyng.workers.dev/?k=sg-chatlas-relay-1'
const NOKEY = BASE.split('?')[0]
const KIND = 23456
const rid = () => Math.random().toString(36).slice(2)

const ev = (topic, content) => [
  'EVENT',
  { id: rid(), pubkey: 'test', created_at: Math.floor(Date.now() / 1000), kind: KIND, tags: [['x', topic]], content, sig: 'test' },
]
const req = (subId, topic) => ['REQ', subId, { kinds: [KIND], '#x': [topic] }]

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const fail = (m) => {
  console.error('✘ ' + m)
  process.exit(1)
}

// 1) gate: a connection without the app key must be refused
async function testGate() {
  return new Promise((resolve) => {
    const ws = new WebSocket(NOKEY)
    ws.onopen = () => {
      ws.close()
      fail(`gate: connection WITHOUT key was accepted (${NOKEY}) — soft-restriction not working`)
    }
    ws.onerror = () => resolve()
    ws.onclose = (e) => {
      if (e.code !== 1000) resolve()
    }
  })
}

// 2) fan-out + isolation: subscriber gets the matching topic, never the wrong one
async function testFanout() {
  const topic = 'smoke-' + rid()
  const wrong = 'smoke-' + rid()
  const subId = 'sub-' + rid()
  const sub = new WebSocket(BASE)
  const pub = new WebSocket(BASE)
  let delivered = null

  await Promise.all([
    new Promise((r) => (sub.onopen = r)),
    new Promise((r) => (pub.onopen = r)),
  ])

  sub.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m[0] === 'EVENT' && m[1] === subId) delivered = m[2].content
  }
  sub.send(JSON.stringify(req(subId, topic)))
  await wait(700) // let the relay register the subscription

  pub.send(JSON.stringify(ev(wrong, 'WRONG-ROOM'))) // must NOT arrive
  pub.send(JSON.stringify(ev(topic, 'right-room'))) // must arrive
  await wait(1200)

  sub.close()
  pub.close()
  if (delivered !== 'right-room') fail(`fan-out: expected 'right-room', got ${JSON.stringify(delivered)}`)
}

const t0 = Date.now()
await testGate()
console.log('✓ gate blocks key-less connections')
await testFanout()
console.log('✓ fan-out delivers matching topic; wrong topic isolated')
console.log(`all relay smoke checks passed in ${Date.now() - t0}ms`)
process.exit(0)
