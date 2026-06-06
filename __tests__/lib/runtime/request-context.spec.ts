import { setTimeout as delay } from 'node:timers/promises'

import {
  addUpstreamDuration,
  getRequestId,
  getUpstream,
  requestContext,
  runWithRequestId
} from '#src/runtime/request-context.js'

describe('lib/services/request-context', () => {
  it('returns undefined outside any request scope', () => {
    expect(getRequestId()).toBeUndefined()
  })

  it('binds requestId to the synchronous scope of runWithRequestId', () => {
    runWithRequestId('abc-123', () => {
      expect(getRequestId()).toBe('abc-123')
    })
    // After the run() callback returns, the scope is unbound.
    expect(getRequestId()).toBeUndefined()
  })

  it('propagates through awaited async work', async () => {
    await runWithRequestId('async-id', async () => {
      await delay(1)
      expect(getRequestId()).toBe('async-id')
      await delay(1)
      expect(getRequestId()).toBe('async-id')
    })
    expect(getRequestId()).toBeUndefined()
  })

  it('isolates nested scopes (inner overrides, outer restores)', () => {
    runWithRequestId('outer', () => {
      expect(getRequestId()).toBe('outer')
      runWithRequestId('inner', () => {
        expect(getRequestId()).toBe('inner')
      })
      expect(getRequestId()).toBe('outer')
    })
  })

  it('isolates concurrent scopes (each Promise carries its own ID)', async () => {
    const captureAfterDelay = (id: string) =>
      runWithRequestId(id, async () => {
        await delay(5)
        return getRequestId()
      })

    const [a, b, c] = await Promise.all([
      captureAfterDelay('id-a'),
      captureAfterDelay('id-b'),
      captureAfterDelay('id-c')
    ])

    expect(a).toBe('id-a')
    expect(b).toBe('id-b')
    expect(c).toBe('id-c')
  })

  it('exposes the underlying AsyncLocalStorage instance for advanced wiring', () => {
    expect(requestContext).toBeDefined()
    expect(typeof requestContext.run).toBe('function')
    expect(typeof requestContext.getStore).toBe('function')
  })

  describe('upstream accumulator', () => {
    it('initializes upstream to { totalMs: 0, calls: 0 } inside a request scope', () => {
      runWithRequestId('req-1', () => {
        expect(getUpstream()).toEqual({ totalMs: 0, calls: 0 })
      })
    })

    it('returns undefined for getUpstream outside a request scope', () => {
      expect(getUpstream()).toBeUndefined()
    })

    it('accumulates durations and call counts additively', () => {
      runWithRequestId('req-2', () => {
        addUpstreamDuration(132)
        addUpstreamDuration(50)
        expect(getUpstream()).toEqual({ totalMs: 182, calls: 2 })
      })
    })

    it('addUpstreamDuration is a no-op outside a request scope', () => {
      // Should not throw and should not affect any future scope.
      expect(() => addUpstreamDuration(99)).not.toThrow()
      runWithRequestId('req-3', () => {
        expect(getUpstream()).toEqual({ totalMs: 0, calls: 0 })
      })
    })

    it('isolates upstream accumulators across concurrent scopes', async () => {
      const accumulate = (id: string, ms: number) =>
        runWithRequestId(id, async () => {
          await delay(1)
          addUpstreamDuration(ms)
          await delay(1)
          return getUpstream()
        })

      const [a, b] = await Promise.all([accumulate('id-a', 100), accumulate('id-b', 200)])
      expect(a).toEqual({ totalMs: 100, calls: 1 })
      expect(b).toEqual({ totalMs: 200, calls: 1 })
    })
  })
})
