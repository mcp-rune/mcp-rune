import { describe, expect, it, vi } from 'vitest'

import type { ToolHandlerExtra, ToolResult } from '../../../../src/mcp/tools/base-tool.js'
import type { ToolInterceptor } from '../../../../src/mcp/tools/tool-pipeline.js'
import { wrapToolHandler } from '../../../../src/mcp/tools/tool-pipeline.js'

// Helpers
const ok = (text = 'ok'): ToolResult => ({ content: [{ type: 'text', text }] })
const err = (text = 'fail'): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

describe('lib/mcp/tools/tool-pipeline', () => {
  describe('wrapToolHandler', () => {
    it('should pass through when no interceptors are provided', async () => {
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test_tool', [], handler)

      const result = await wrapped({ id: '1' })

      expect(result).toEqual(ok())
      expect(handler).toHaveBeenCalledWith({ id: '1' })
    })

    it('should provide toolName and args in context to before hooks', async () => {
      const before = vi.fn()
      const interceptor: ToolInterceptor = { before }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('find_model', [interceptor], handler)

      await wrapped({ model: 'book' })

      expect(before).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'find_model',
          args: { model: 'book' },
          meta: {}
        })
      )
    })

    it('should include sessionId in context when provided', async () => {
      const before = vi.fn()
      const interceptor: ToolInterceptor = { before }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [interceptor], handler, {
        sessionId: 'session-123'
      })

      await wrapped({})

      expect(before).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-123' }))
    })

    it('should run before hooks in declared order', async () => {
      const order: string[] = []
      const a: ToolInterceptor = {
        name: 'a',
        before: () => {
          order.push('a')
        }
      }
      const b: ToolInterceptor = {
        name: 'b',
        before: () => {
          order.push('b')
        }
      }
      const c: ToolInterceptor = {
        name: 'c',
        before: () => {
          order.push('c')
        }
      }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [a, b, c], handler)

      await wrapped({})

      expect(order).toEqual(['a', 'b', 'c'])
    })

    it('should run after hooks in reverse order', async () => {
      const order: string[] = []
      const a: ToolInterceptor = {
        name: 'a',
        after: () => {
          order.push('a')
        }
      }
      const b: ToolInterceptor = {
        name: 'b',
        after: () => {
          order.push('b')
        }
      }
      const c: ToolInterceptor = {
        name: 'c',
        after: () => {
          order.push('c')
        }
      }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [a, b, c], handler)

      await wrapped({})

      expect(order).toEqual(['c', 'b', 'a'])
    })

    it('should allow before hooks to modify args', async () => {
      const interceptor: ToolInterceptor = {
        before(ctx) {
          ctx.args.extra = 'injected'
        }
      }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      await wrapped({ id: '1' })

      expect(handler).toHaveBeenCalledWith({ id: '1', extra: 'injected' }, undefined)
    })

    it('should allow before hooks to pass data to after hooks via meta', async () => {
      let captured: unknown
      const interceptor: ToolInterceptor = {
        before(ctx) {
          ctx.meta.startTime = 42
        },
        after(ctx) {
          captured = ctx.meta.startTime
        }
      }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      await wrapped({})

      expect(captured).toBe(42)
    })

    it('should abort execution when before hook throws', async () => {
      const interceptor: ToolInterceptor = {
        before() {
          throw new Error('access denied')
        }
      }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      await expect(wrapped({})).rejects.toThrow('access denied')
      expect(handler).not.toHaveBeenCalled()
    })

    it('should allow after hooks to transform the result', async () => {
      const interceptor: ToolInterceptor = {
        after(_ctx, result) {
          return {
            ...result,
            _meta: { transformed: true }
          }
        }
      }
      const handler = vi.fn().mockResolvedValue(ok('original'))
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      const result = await wrapped({})

      expect(result._meta).toEqual({ transformed: true })
    })

    it('should pass result through when after hook returns void', async () => {
      const sideEffect = vi.fn()
      const interceptor: ToolInterceptor = {
        after(_ctx, _result) {
          sideEffect()
          // returns void — result should pass through
        }
      }
      const handler = vi.fn().mockResolvedValue(ok('original'))
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      const result = await wrapped({})

      expect(result).toEqual(ok('original'))
      expect(sideEffect).toHaveBeenCalled()
    })

    it('should run onError hooks in reverse order on handler error', async () => {
      const order: string[] = []
      const a: ToolInterceptor = {
        name: 'a',
        onError: () => {
          order.push('a')
        }
      }
      const b: ToolInterceptor = {
        name: 'b',
        onError: () => {
          order.push('b')
        }
      }
      const c: ToolInterceptor = {
        name: 'c',
        onError: () => {
          order.push('c')
        }
      }
      const handler = vi.fn().mockRejectedValue(new Error('boom'))
      const wrapped = wrapToolHandler('test', [a, b, c], handler)

      await expect(wrapped({})).rejects.toThrow('boom')
      expect(order).toEqual(['c', 'b', 'a'])
    })

    it('should recover from error when onError returns a ToolResult', async () => {
      const interceptor: ToolInterceptor = {
        onError(_ctx, error) {
          return err(`Caught: ${error.message}`)
        }
      }
      const handler = vi.fn().mockRejectedValue(new Error('boom'))
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      const result = await wrapped({})

      expect(result).toEqual(err('Caught: boom'))
    })

    it('should stop onError chain after first recovery', async () => {
      const outerOnError = vi.fn()
      const inner: ToolInterceptor = {
        name: 'inner',
        onError(_ctx, error) {
          return err(`recovered: ${error.message}`)
        }
      }
      const outer: ToolInterceptor = { name: 'outer', onError: outerOnError }
      const handler = vi.fn().mockRejectedValue(new Error('boom'))
      // [outer, inner] → onError runs inner first (reverse), then stops
      const wrapped = wrapToolHandler('test', [outer, inner], handler)

      const result = await wrapped({})

      expect(result).toEqual(err('recovered: boom'))
      // outer onError should NOT run because inner recovered
      expect(outerOnError).not.toHaveBeenCalled()
    })

    it('should re-throw when no onError handler recovers', async () => {
      const interceptor: ToolInterceptor = {
        onError() {
          // returns void — does not recover
        }
      }
      const handler = vi.fn().mockRejectedValue(new Error('unrecoverable'))
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      await expect(wrapped({})).rejects.toThrow('unrecoverable')
    })

    it('should convert non-Error throws to Error objects in onError', async () => {
      let capturedError: Error | undefined
      const interceptor: ToolInterceptor = {
        onError(_ctx, error) {
          capturedError = error
          return err('caught')
        }
      }
      const handler = vi.fn().mockRejectedValue('string error')
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      await wrapped({})

      expect(capturedError).toBeInstanceOf(Error)
      expect(capturedError!.message).toBe('string error')
    })

    it('should support async interceptor hooks', async () => {
      const interceptor: ToolInterceptor = {
        async before(ctx) {
          await new Promise((r) => setTimeout(r, 1))
          ctx.meta.asyncDone = true
        },
        async after(ctx, result) {
          await new Promise((r) => setTimeout(r, 1))
          return { ...result, _meta: { asyncDone: ctx.meta.asyncDone } }
        }
      }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      const result = await wrapped({})

      expect(result._meta).toEqual({ asyncDone: true })
    })

    it('should not mutate the original args object', async () => {
      const interceptor: ToolInterceptor = {
        before(ctx) {
          ctx.args.injected = true
        }
      }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [interceptor], handler)
      const originalArgs = { id: '1' }

      await wrapped(originalArgs)

      expect(originalArgs).toEqual({ id: '1' }) // not mutated
      expect(handler).toHaveBeenCalledWith({ id: '1', injected: true }, undefined)
    })

    it('should pass extra through to the handler', async () => {
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [], handler)
      const extra: ToolHandlerExtra = {
        _meta: { progressToken: 'tok-1' },
        sendNotification: vi.fn()
      }

      await wrapped({ id: '1' }, extra)

      expect(handler).toHaveBeenCalledWith({ id: '1' }, extra)
    })

    it('should expose extra on ToolContext for interceptors', async () => {
      let capturedExtra: ToolHandlerExtra | undefined
      const interceptor: ToolInterceptor = {
        before(ctx) {
          capturedExtra = ctx.extra
        }
      }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [interceptor], handler)
      const extra: ToolHandlerExtra = {
        _meta: { progressToken: 42 },
        sendNotification: vi.fn()
      }

      await wrapped({}, extra)

      expect(capturedExtra).toBe(extra)
    })

    it('should pass extra through interceptor chain to handler', async () => {
      const interceptor: ToolInterceptor = { before: vi.fn() }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [interceptor], handler)
      const extra: ToolHandlerExtra = { _meta: { progressToken: 'p1' } }

      await wrapped({ model: 'book' }, extra)

      expect(handler).toHaveBeenCalledWith({ model: 'book' }, extra)
    })

    it('should work without extra (backward compatible)', async () => {
      const interceptor: ToolInterceptor = { before: vi.fn() }
      const handler = vi.fn().mockResolvedValue(ok())
      const wrapped = wrapToolHandler('test', [interceptor], handler)

      await wrapped({ id: '1' })

      expect(handler).toHaveBeenCalledWith({ id: '1' }, undefined)
    })

    it('should compose multiple interceptors for a realistic pipeline', async () => {
      const events: string[] = []

      const logging: ToolInterceptor = {
        name: 'logging',
        before(ctx) {
          events.push(`log:start:${ctx.toolName}`)
        },
        after(ctx) {
          events.push(`log:end:${ctx.toolName}`)
        },
        onError(ctx) {
          events.push(`log:error:${ctx.toolName}`)
        }
      }

      const timing: ToolInterceptor = {
        name: 'timing',
        before(ctx) {
          ctx.meta.start = 1
          events.push('timing:start')
        },
        after(ctx) {
          ctx.meta.duration = 2
          events.push('timing:end')
        }
      }

      const errorCatch: ToolInterceptor = {
        name: 'error-catch',
        onError(_ctx, error): ToolResult {
          events.push('error-catch:recover')
          return err(error.message)
        }
      }

      // Success path
      const handler = vi.fn().mockResolvedValue(ok('done'))
      const wrapped = wrapToolHandler('test', [logging, timing, errorCatch], handler)
      await wrapped({})

      expect(events).toEqual(
        [
          'log:start:test',
          'timing:start',
          // handler runs
          'error-catch:recover', // after runs in reverse but error-catch has no after
          'timing:end',
          'log:end:test'
        ].filter((e) => !e.startsWith('error-catch'))
      ) // error-catch only fires on error

      // Reset for error path
      events.length = 0
      const failHandler = vi.fn().mockRejectedValue(new Error('api down'))
      const failWrapped = wrapToolHandler('test', [logging, timing, errorCatch], failHandler)
      const result = await failWrapped({})

      expect(result).toEqual(err('api down'))
      // onError runs in reverse: errorCatch first (recovers), timing+logging skip
      expect(events).toEqual(['log:start:test', 'timing:start', 'error-catch:recover'])
    })
  })
})
