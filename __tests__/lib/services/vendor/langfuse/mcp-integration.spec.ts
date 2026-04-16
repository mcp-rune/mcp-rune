// Mock @langfuse/tracing
vi.mock('@langfuse/tracing', () => ({
  startActiveObservation: vi.fn(async (name, callback, _options) => {
    const span = {
      update: vi.fn()
    }
    return callback(span)
  }),
  propagateAttributes: vi.fn((params, fn) => fn())
}))

// Mock shared sanitizers
vi.mock('../../../../../src/services/sanitizers.js', () => ({
  sanitizeToolArgs: vi.fn((args) => ({ ...args, _sanitized: true }))
}))

// Mock logger
vi.mock('../../../../../src/services/logger.js', () => ({
  default: {},
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'

import * as logger from '../../../../../src/services/logger.js'
import { sanitizeToolArgs } from '../../../../../src/services/sanitizers.js'
import {
  extractTraceContext,
  setConfigured,
  setSessionContext,
  traceApiCall,
  tracePromptGeneration,
  traceToolCall
} from '../../../../../src/services/vendor/langfuse/mcp-integration.js'

describe('lib/services/vendor/langfuse/mcp-integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setConfigured(true)
  })

  afterEach(() => {
    setConfigured(false)
  })

  // ==========================================================================
  // extractTraceContext
  // ==========================================================================

  describe('extractTraceContext', () => {
    it('should parse a valid W3C traceparent', () => {
      const traceId = 'a'.repeat(32)
      const spanId = 'b'.repeat(16)
      const meta = { traceparent: `00-${traceId}-${spanId}-01` }

      const result = extractTraceContext(meta)

      expect(result).toEqual({
        traceId,
        spanId,
        traceFlags: 1
      })
    })

    it('should return null for missing meta', () => {
      expect(extractTraceContext(null)).toBeNull()
      expect(extractTraceContext(undefined)).toBeNull()
    })

    it('should return null for missing traceparent', () => {
      expect(extractTraceContext({})).toBeNull()
      expect(extractTraceContext({ other: 'value' })).toBeNull()
    })

    it('should return null for malformed traceparent (wrong part count)', () => {
      expect(extractTraceContext({ traceparent: '00-abc-01' })).toBeNull()
    })

    it('should return null for wrong version', () => {
      const traceId = 'a'.repeat(32)
      const spanId = 'b'.repeat(16)
      expect(extractTraceContext({ traceparent: `01-${traceId}-${spanId}-01` })).toBeNull()
    })

    it('should return null for invalid traceId length', () => {
      const spanId = 'b'.repeat(16)
      expect(extractTraceContext({ traceparent: `00-short-${spanId}-01` })).toBeNull()
    })

    it('should return null for invalid spanId length', () => {
      const traceId = 'a'.repeat(32)
      expect(extractTraceContext({ traceparent: `00-${traceId}-short-01` })).toBeNull()
    })

    it('should parse traceFlags as hex', () => {
      const traceId = 'a'.repeat(32)
      const spanId = 'b'.repeat(16)
      const result = extractTraceContext({ traceparent: `00-${traceId}-${spanId}-ff` })

      expect(result.traceFlags).toBe(255)
    })
  })

  // ==========================================================================
  // traceToolCall
  // ==========================================================================

  describe('traceToolCall', () => {
    it('should call startActiveObservation with asType tool', async () => {
      const handler = vi.fn(() => ({ content: [{ type: 'text', text: 'ok' }] }))

      await traceToolCall('find_model', { model: 'book' }, handler)

      expect(startActiveObservation).toHaveBeenCalledWith(
        'mcp.tool.find_model',
        expect.any(Function),
        { asType: 'tool' }
      )
    })

    it('should sanitize args in span metadata', async () => {
      const handler = vi.fn(() => 'result')
      const args = { model: 'book', password: 'secret' }

      await traceToolCall('create_model', args, handler)

      expect(sanitizeToolArgs).toHaveBeenCalledWith(args)

      // Verify span.update was called with sanitized args
      const callback = startActiveObservation.mock.calls[0][1]
      const span = { update: vi.fn() }
      await callback(span)
      expect(span.update).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ _sanitized: true })
        })
      )
    })

    it('should return handler result', async () => {
      const handler = vi.fn(() => ({ content: [{ type: 'text', text: 'data' }] }))

      const result = await traceToolCall('find_model', {}, handler)

      expect(result).toEqual({ content: [{ type: 'text', text: 'data' }] })
    })

    it('should re-throw handler errors', async () => {
      const error = new Error('Tool failed')
      const handler = vi.fn(() => {
        throw error
      })

      await expect(traceToolCall('find_model', {}, handler)).rejects.toThrow('Tool failed')
    })

    it('should pass parentSpanContext when traceContext provided', async () => {
      const handler = vi.fn(() => 'result')
      const traceContext = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }

      await traceToolCall('find_model', {}, handler, { traceContext })

      expect(startActiveObservation).toHaveBeenCalledWith(
        'mcp.tool.find_model',
        expect.any(Function),
        { asType: 'tool', parentSpanContext: traceContext }
      )
    })

    it('should include sessionId in metadata', async () => {
      const handler = vi.fn(() => 'result')

      await traceToolCall('find_model', {}, handler, { sessionId: 'session-123' })

      // Verify the callback updates span with sessionId
      const callback = startActiveObservation.mock.calls[0][1]
      const span = { update: vi.fn() }
      await callback(span)
      expect(span.update).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ sessionId: 'session-123' })
        })
      )
    })

    it('should no-op when not configured', async () => {
      setConfigured(false)
      const handler = vi.fn(() => 'direct result')

      const result = await traceToolCall('find_model', {}, handler)

      expect(startActiveObservation).not.toHaveBeenCalled()
      expect(handler).toHaveBeenCalled()
      expect(result).toBe('direct result')
    })

    it('should wrap with propagateAttributes when session context is set', async () => {
      setSessionContext({ sessionId: 'sess-1', metadata: { transport: 'stdio' } })
      const handler = vi.fn(() => 'result')

      await traceToolCall('find_model', {}, handler)

      expect(propagateAttributes).toHaveBeenCalledWith(
        { sessionId: 'sess-1', metadata: { transport: 'stdio' } },
        expect.any(Function)
      )
      expect(startActiveObservation).toHaveBeenCalled()
    })

    it('should not wrap with propagateAttributes when no session context', async () => {
      const handler = vi.fn(() => 'result')

      await traceToolCall('find_model', {}, handler)

      expect(propagateAttributes).not.toHaveBeenCalled()
      expect(startActiveObservation).toHaveBeenCalled()
    })

    it('should fall back to direct handler call when tracing infrastructure fails', async () => {
      startActiveObservation.mockRejectedValueOnce(new Error('Tracing broken'))
      const handler = vi.fn(() => 'fallback result')

      const result = await traceToolCall('find_model', {}, handler)

      expect(result).toBe('fallback result')
      expect(logger.warn).toHaveBeenCalledWith(
        'Tracing failed, executing without trace',
        expect.objectContaining({ operation: 'traceToolCall', tool: 'find_model' })
      )
    })
  })

  // ==========================================================================
  // traceApiCall
  // ==========================================================================

  describe('traceApiCall', () => {
    it('should call startActiveObservation with method and url', async () => {
      const handler = vi.fn(() => ({ data: 'test' }))

      await traceApiCall('GET', '/api/brands', handler)

      expect(startActiveObservation).toHaveBeenCalledWith('GET /api/brands', expect.any(Function))
    })

    it('should return handler result', async () => {
      const handler = vi.fn(() => ({ data: 'test' }))

      const result = await traceApiCall('POST', '/api/brands', handler)

      expect(result).toEqual({ data: 'test' })
    })

    it('should re-throw handler errors', async () => {
      const handler = vi.fn(() => {
        throw new Error('API failed')
      })

      await expect(traceApiCall('GET', '/api/brands', handler)).rejects.toThrow('API failed')
    })

    it('should no-op when not configured', async () => {
      setConfigured(false)
      const handler = vi.fn(() => 'direct result')

      const result = await traceApiCall('GET', '/api/brands', handler)

      expect(startActiveObservation).not.toHaveBeenCalled()
      expect(handler).toHaveBeenCalled()
      expect(result).toBe('direct result')
    })

    it('should fall back to direct handler call when tracing infrastructure fails', async () => {
      startActiveObservation.mockRejectedValueOnce(new Error('Tracing broken'))
      const handler = vi.fn(() => 'fallback result')

      const result = await traceApiCall('GET', '/api/brands', handler)

      expect(result).toBe('fallback result')
      expect(logger.warn).toHaveBeenCalledWith(
        'Tracing failed, executing without trace',
        expect.objectContaining({ operation: 'traceApiCall' })
      )
    })
  })

  // ==========================================================================
  // tracePromptGeneration
  // ==========================================================================

  describe('tracePromptGeneration', () => {
    it('should call startActiveObservation with prompt name', async () => {
      const handler = vi.fn(() => 'prompt content')

      await tracePromptGeneration('create_brand', handler)

      expect(startActiveObservation).toHaveBeenCalledWith(
        'mcp.prompt.create_brand',
        expect.any(Function)
      )
    })

    it('should return handler result', async () => {
      const handler = vi.fn(() => 'prompt content')

      const result = await tracePromptGeneration('create_brand', handler)

      expect(result).toBe('prompt content')
    })

    it('should re-throw handler errors', async () => {
      const handler = vi.fn(() => {
        throw new Error('Prompt failed')
      })

      await expect(tracePromptGeneration('create_brand', handler)).rejects.toThrow('Prompt failed')
    })

    it('should no-op when not configured', async () => {
      setConfigured(false)
      const handler = vi.fn(() => 'direct result')

      const result = await tracePromptGeneration('create_brand', handler)

      expect(startActiveObservation).not.toHaveBeenCalled()
      expect(handler).toHaveBeenCalled()
      expect(result).toBe('direct result')
    })

    it('should fall back to direct handler call when tracing infrastructure fails', async () => {
      startActiveObservation.mockRejectedValueOnce(new Error('Tracing broken'))
      const handler = vi.fn(() => 'fallback result')

      const result = await tracePromptGeneration('create_brand', handler)

      expect(result).toBe('fallback result')
      expect(logger.warn).toHaveBeenCalledWith(
        'Tracing failed, executing without trace',
        expect.objectContaining({ operation: 'tracePromptGeneration' })
      )
    })
  })

  // ==========================================================================
  // setSessionContext
  // ==========================================================================

  describe('setSessionContext', () => {
    it('should store session attributes for use in traces', async () => {
      setSessionContext({
        sessionId: 'session-abc',
        metadata: { transport: 'streamable-http' }
      })

      // propagateAttributes should NOT be called during setSessionContext
      expect(propagateAttributes).not.toHaveBeenCalled()

      // Trigger a trace to verify attributes are propagated
      const handler = vi.fn(() => 'result')
      await traceToolCall('find_model', {}, handler)

      expect(propagateAttributes).toHaveBeenCalledWith(
        { sessionId: 'session-abc', metadata: { transport: 'streamable-http' } },
        expect.any(Function)
      )
    })

    it('should handle sessionId only', () => {
      setSessionContext({ sessionId: 'session-abc' })

      expect(propagateAttributes).not.toHaveBeenCalled()
    })

    it('should handle metadata only', () => {
      setSessionContext({ metadata: { transport: 'stdio' } })

      expect(propagateAttributes).not.toHaveBeenCalled()
    })

    it('should no-op when not configured', async () => {
      setConfigured(false)
      setSessionContext({ sessionId: 'session-abc' })

      // Re-enable and trace — should NOT have session attributes
      setConfigured(true)
      const handler = vi.fn(() => 'result')
      await traceToolCall('find_model', {}, handler)

      expect(propagateAttributes).not.toHaveBeenCalled()
    })

    it('should catch errors gracefully', () => {
      // Pass null to trigger an error in property access
      setSessionContext(null)

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to set session context',
        expect.objectContaining({ service: 'langfuse' })
      )
    })
  })

  // ==========================================================================
  // setConfigured
  // ==========================================================================

  describe('setConfigured', () => {
    it('should clear session attributes when disabled', async () => {
      setSessionContext({ sessionId: 'session-abc' })

      // Disable and re-enable
      setConfigured(false)
      setConfigured(true)

      // Trace should NOT wrap with propagateAttributes
      const handler = vi.fn(() => 'result')
      await traceToolCall('find_model', {}, handler)

      expect(propagateAttributes).not.toHaveBeenCalled()
    })
  })
})
