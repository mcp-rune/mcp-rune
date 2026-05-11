vi.mock('../../../src/services/vendor/langfuse/index.js', () => ({
  initialize: vi.fn(() => true),
  isConfigured: vi.fn(() => true),
  traceToolCall: vi.fn(async (name, args, handler) => handler()),
  traceApiCall: vi.fn(async (method, url, handler) => handler()),
  tracePromptGeneration: vi.fn(async (name, handler) => handler()),
  setSessionContext: vi.fn(),
  extractTraceContext: vi.fn(() => ({ traceId: 'abc' })),
  flush: vi.fn(),
  close: vi.fn()
}))

import {
  closeTracing,
  extractTraceContext,
  flushTracing,
  initTracing,
  isTracingEnabled,
  setSessionContext,
  traceApiCall,
  tracePromptGeneration,
  traceToolCall
} from '../../../src/services/tracing.js'
import * as vendor from '../../../src/services/vendor/langfuse/index.js'

describe('lib/services/tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initTracing', () => {
    it('delegates to vendor.initialize', () => {
      const result = initTracing({ serviceName: 'test', version: '1.0.0' })
      expect(vendor.initialize).toHaveBeenCalledWith({ serviceName: 'test', version: '1.0.0' })
      expect(result).toBe(true)
    })
  })

  describe('isTracingEnabled', () => {
    it('delegates to vendor.isConfigured', () => {
      expect(isTracingEnabled()).toBe(true)
      expect(vendor.isConfigured).toHaveBeenCalled()
    })
  })

  describe('traceToolCall', () => {
    it('delegates to vendor and returns handler result', async () => {
      const handler = vi.fn().mockResolvedValue('tool-result')

      const result = await traceToolCall('find_records', { model: 'book' }, handler, {
        sessionId: 's1'
      })

      expect(vendor.traceToolCall).toHaveBeenCalledWith(
        'find_records',
        { model: 'book' },
        handler,
        {
          sessionId: 's1'
        }
      )
      expect(result).toBe('tool-result')
    })
  })

  describe('traceApiCall', () => {
    it('delegates to vendor and returns handler result', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 200 })

      const result = await traceApiCall('GET', '/api/books', handler)

      expect(vendor.traceApiCall).toHaveBeenCalledWith('GET', '/api/books', handler)
      expect(result).toEqual({ status: 200 })
    })
  })

  describe('tracePromptGeneration', () => {
    it('delegates to vendor', async () => {
      const handler = vi.fn().mockResolvedValue('prompt-content')

      const result = await tracePromptGeneration('book_prompt', handler)

      expect(vendor.tracePromptGeneration).toHaveBeenCalledWith('book_prompt', handler)
      expect(result).toBe('prompt-content')
    })
  })

  describe('setSessionContext', () => {
    it('delegates to vendor', () => {
      setSessionContext({ sessionId: 's1', metadata: { key: 'value' } })
      expect(vendor.setSessionContext).toHaveBeenCalledWith({
        sessionId: 's1',
        metadata: { key: 'value' }
      })
    })
  })

  describe('extractTraceContext', () => {
    it('delegates to vendor and returns context', () => {
      const result = extractTraceContext({ traceparent: '00-abc-def-01' })
      expect(vendor.extractTraceContext).toHaveBeenCalledWith({ traceparent: '00-abc-def-01' })
      expect(result).toEqual({ traceId: 'abc' })
    })
  })

  describe('flushTracing', () => {
    it('delegates to vendor.flush with default timeout', async () => {
      await flushTracing()
      expect(vendor.flush).toHaveBeenCalledWith(5000)
    })

    it('delegates to vendor.flush with custom timeout', async () => {
      await flushTracing(10000)
      expect(vendor.flush).toHaveBeenCalledWith(10000)
    })
  })

  describe('closeTracing', () => {
    it('delegates to vendor.close with default timeout', async () => {
      await closeTracing()
      expect(vendor.close).toHaveBeenCalledWith(5000)
    })

    it('delegates to vendor.close with custom timeout', async () => {
      await closeTracing(3000)
      expect(vendor.close).toHaveBeenCalledWith(3000)
    })
  })
})
