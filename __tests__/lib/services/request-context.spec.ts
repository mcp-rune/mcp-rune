import { setTimeout as delay } from 'node:timers/promises'

import { getRequestId, requestContext, runWithRequestId } from '#src/services/request-context.js'

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
})
