import { describe, it, expect } from 'vitest'
import { hashStr, shardRoomId, randomShardRoomId, namedRoomId, EVENT_SHARD_COUNT } from './rooms'

describe('chatlas room derivation', () => {
  it('hashStr is deterministic and 32-bit unsigned', () => {
    expect(hashStr('manifold_mae')).toBe(hashStr('manifold_mae'))
    expect(hashStr('a')).not.toBe(hashStr('b'))
    for (const s of ['', 'x', 'a much longer key 🧘', 'dr_klein']) {
      const h = hashStr(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('shardRoomId is stable per key and always in range', () => {
    expect(shardRoomId('events', 'peer-123')).toBe(shardRoomId('events', 'peer-123'))
    for (let i = 0; i < 200; i++) {
      const id = shardRoomId('events', `peer-${i}`)
      const shard = Number(id.split(':s')[1])
      expect(id.startsWith('events:s')).toBe(true)
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(EVENT_SHARD_COUNT)
    }
  })

  it('randomShardRoomId honours injected rng and clamps within shard count', () => {
    expect(randomShardRoomId('events', 4, () => 0)).toBe('events:s0')
    expect(randomShardRoomId('events', 4, () => 0.999)).toBe('events:s3') // floor(0.999*4)=3, never === count
    expect(randomShardRoomId('events', 8, () => 0.5)).toBe('events:s4')
  })

  it('namedRoomId is the verbatim access token', () => {
    expect(namedRoomId('chat', 'cozy-corner')).toBe('chat:cozy-corner')
    expect(namedRoomId('chat', '8f3ad9')).toBe('chat:8f3ad9')
  })
})
