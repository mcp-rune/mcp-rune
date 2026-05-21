const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('#src/services/logger.js', () => mockLogger)

import * as logger from '#src/services/logger.js'

import { SessionManager } from '../../../src/mcp/session-manager.js'

describe('lib/mcp/session-manager', () => {
  let manager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new SessionManager()
  })

  describe('size', () => {
    it('reports 0 for a fresh manager', () => {
      expect(manager.size).toBe(0)
    })

    it('reflects added sessions', () => {
      manager.set('a', { transport: {}, server: null, accessToken: null })
      manager.set('b', { transport: {}, server: null, accessToken: null })
      expect(manager.size).toBe(2)
    })
  })

  describe('get / has / set / delete', () => {
    it('round-trips a session entry', () => {
      const entry = { transport: { id: 't1' }, server: null, accessToken: 'tok' }
      manager.set('sid-1', entry)
      expect(manager.has('sid-1')).toBe(true)
      expect(manager.get('sid-1')).toBe(entry)
    })

    it('returns undefined for unknown ids', () => {
      expect(manager.has('missing')).toBe(false)
      expect(manager.get('missing')).toBeUndefined()
    })

    it('removes entries on delete', () => {
      manager.set('sid-1', { transport: {}, server: null, accessToken: null })
      manager.delete('sid-1')
      expect(manager.has('sid-1')).toBe(false)
      expect(manager.size).toBe(0)
    })

    it('delete is a no-op for unknown ids', () => {
      expect(() => manager.delete('missing')).not.toThrow()
    })
  })

  describe('entries', () => {
    it('yields every session', () => {
      const a = { transport: {}, server: null, accessToken: null }
      const b = { transport: {}, server: null, accessToken: null }
      manager.set('a', a)
      manager.set('b', b)
      expect(Array.from(manager.entries())).toEqual([
        ['a', a],
        ['b', b]
      ])
    })
  })

  describe('closeAll', () => {
    it('closes every session server', async () => {
      const close1 = vi.fn().mockResolvedValue(undefined)
      const close2 = vi.fn().mockResolvedValue(undefined)
      manager.set('a', { transport: {}, server: { close: close1 }, accessToken: null })
      manager.set('b', { transport: {}, server: { close: close2 }, accessToken: null })

      await manager.closeAll()

      expect(close1).toHaveBeenCalledTimes(1)
      expect(close2).toHaveBeenCalledTimes(1)
    })

    it('skips sessions whose server is null (transport-only entries)', async () => {
      manager.set('a', { transport: {}, server: null, accessToken: null })
      await expect(manager.closeAll()).resolves.toBeUndefined()
    })

    it('logs but does not throw if one session close fails', async () => {
      const failing = vi.fn().mockRejectedValue(new Error('boom'))
      const ok = vi.fn().mockResolvedValue(undefined)
      manager.set('bad', { transport: {}, server: { close: failing }, accessToken: null })
      manager.set('good', { transport: {}, server: { close: ok }, accessToken: null })

      await expect(manager.closeAll()).resolves.toBeUndefined()

      expect(ok).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledWith('Error closing session', {
        sessionId: 'bad',
        error: 'boom'
      })
    })
  })
})
