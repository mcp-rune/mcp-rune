import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ToolResult } from '../../../../src/mcp/tools/base-tool.js'
import {
  errorInterceptor,
  loggingInterceptor,
  tracingInterceptor
} from '../../../../src/mcp/tools/interceptors.js'
import type { ToolContext } from '../../../../src/mcp/tools/tool-pipeline.js'

// Mock logger
vi.mock('#src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

import * as logger from '../../../../src/runtime/logger.js'

const makeCtx = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  toolName: 'test_tool',
  args: {},
  meta: {},
  ...overrides
})

const ok = (text = 'ok'): ToolResult => ({ content: [{ type: 'text', text }] })

describe('lib/mcp/tools/interceptors', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('loggingInterceptor', () => {
    it('should log tool call in before hook', () => {
      const interceptor = loggingInterceptor()
      const ctx = makeCtx({ toolName: 'find_records' })

      interceptor.before!(ctx)

      expect(logger.info).toHaveBeenCalledWith('Tool called', { tool: 'find_records' })
    })

    it('should include logContext in log entries', () => {
      const interceptor = loggingInterceptor({ logContext: { service: 'my-server' } })
      const ctx = makeCtx({ toolName: 'create_model' })

      interceptor.before!(ctx)

      expect(logger.info).toHaveBeenCalledWith('Tool called', {
        service: 'my-server',
        tool: 'create_model'
      })
    })

    it('should log error in onError hook', () => {
      const interceptor = loggingInterceptor({ logContext: { service: 'test' } })
      const ctx = makeCtx({ toolName: 'delete_model' })
      const error = new Error('not found')

      interceptor.onError!(ctx, error)

      expect(logger.error).toHaveBeenCalledWith('Tool error', {
        service: 'test',
        tool: 'delete_model',
        error: 'not found'
      })
    })

    it('should not recover from errors (returns void)', () => {
      const interceptor = loggingInterceptor()
      const ctx = makeCtx()

      const result = interceptor.onError!(ctx, new Error('boom'))

      expect(result).toBeUndefined()
    })

    it('should have name "logging"', () => {
      const interceptor = loggingInterceptor()
      expect(interceptor.name).toBe('logging')
    })
  })

  describe('tracingInterceptor', () => {
    it('should record start time in before hook', () => {
      const interceptor = tracingInterceptor()
      const ctx = makeCtx()

      interceptor.before!(ctx)

      expect(ctx.meta._tracingStart).toBeDefined()
      expect(typeof ctx.meta._tracingStart).toBe('number')
    })

    it('should record duration in after hook', async () => {
      const interceptor = tracingInterceptor()
      const ctx = makeCtx()

      interceptor.before!(ctx)
      // Simulate some time passing
      ctx.meta._tracingStart = Date.now() - 100

      interceptor.after!(ctx, ok())

      expect(ctx.meta._tracingDuration).toBeDefined()
      expect(ctx.meta._tracingDuration as number).toBeGreaterThanOrEqual(0)
    })

    it('should have name "tracing"', () => {
      const interceptor = tracingInterceptor()
      expect(interceptor.name).toBe('tracing')
    })
  })

  describe('errorInterceptor', () => {
    it('should recover from any error with structured MCP error response', () => {
      const interceptor = errorInterceptor()
      const ctx = makeCtx({ toolName: 'create_model' })

      const result = interceptor.onError!(ctx, new Error('API timeout'))

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: API timeout' }],
        isError: true
      })
    })

    it('should have name "error-catch"', () => {
      const interceptor = errorInterceptor()
      expect(interceptor.name).toBe('error-catch')
    })

    it('should always return a ToolResult (never void)', () => {
      const interceptor = errorInterceptor()
      const ctx = makeCtx()

      const result = interceptor.onError!(ctx, new Error('anything'))

      expect(result).toBeDefined()
      expect((result as ToolResult).isError).toBe(true)
    })
  })
})
