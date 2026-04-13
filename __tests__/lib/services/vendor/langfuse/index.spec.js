import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStart = vi.fn()
const mockShutdown = vi.fn()
const mockForceFlush = vi.fn()

vi.mock('@opentelemetry/sdk-node', () => {
  class MockNodeSDK {
    constructor(options) {
      this.options = options
      this.start = mockStart
      this.shutdown = mockShutdown
    }
  }
  return { NodeSDK: MockNodeSDK }
})

vi.mock('@langfuse/otel', () => {
  class MockLangfuseSpanProcessor {
    constructor() {
      this.forceFlush = mockForceFlush
    }
  }
  return { LangfuseSpanProcessor: MockLangfuseSpanProcessor }
})

vi.mock('#src/services/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('../../../../../src/services/vendor/langfuse/mcp-integration.js', () => ({
  traceToolCall: vi.fn(),
  traceApiCall: vi.fn(),
  tracePromptGeneration: vi.fn(),
  setSessionContext: vi.fn(),
  extractTraceContext: vi.fn(),
  setConfigured: vi.fn()
}))

const langfuse = await import('../../../../../src/services/vendor/langfuse/index.js')
import { setConfigured } from '../../../../../src/services/vendor/langfuse/mcp-integration.js'

describe('lib/services/vendor/langfuse/index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialize', () => {
    it('returns false when keys not provided', () => {
      const result = langfuse.initialize({})
      expect(result).toBe(false)
      expect(langfuse.isConfigured()).toBe(false)
      expect(setConfigured).toHaveBeenCalledWith(false)
    })

    it('returns false when only publicKey provided', () => {
      const result = langfuse.initialize({ publicKey: 'pk' })
      expect(result).toBe(false)
    })

    it('initializes SDK with both keys', () => {
      const result = langfuse.initialize({
        publicKey: 'pk-123',
        secretKey: 'sk-456',
        serviceName: 'test-mcp',
        version: '1.0.0'
      })

      expect(result).toBe(true)
      expect(langfuse.isConfigured()).toBe(true)
      expect(mockStart).toHaveBeenCalled()
      expect(setConfigured).toHaveBeenCalledWith(true)
    })

    it('sets env vars for Langfuse SDK', () => {
      langfuse.initialize({
        publicKey: 'pk-env',
        secretKey: 'sk-env',
        serviceName: 'test',
        version: '1.0.0'
      })

      expect(process.env.LANGFUSE_PUBLIC_KEY).toBe('pk-env')
      expect(process.env.LANGFUSE_SECRET_KEY).toBe('sk-env')
    })
  })

  describe('flush', () => {
    it('does nothing when not initialized', async () => {
      // Re-initialize without keys to reset state
      langfuse.initialize({})
      await langfuse.flush()
      // No error thrown
    })
  })

  describe('close', () => {
    it('shuts down SDK and clears state', async () => {
      langfuse.initialize({
        publicKey: 'pk',
        secretKey: 'sk',
        serviceName: 'test',
        version: '1.0.0'
      })

      await langfuse.close()

      expect(mockShutdown).toHaveBeenCalled()
      expect(setConfigured).toHaveBeenCalledWith(false)
    })
  })

  describe('re-exports from mcp-integration', () => {
    it('exports traceToolCall', () => {
      expect(typeof langfuse.traceToolCall).toBe('function')
    })

    it('exports traceApiCall', () => {
      expect(typeof langfuse.traceApiCall).toBe('function')
    })

    it('exports tracePromptGeneration', () => {
      expect(typeof langfuse.tracePromptGeneration).toBe('function')
    })

    it('exports setSessionContext', () => {
      expect(typeof langfuse.setSessionContext).toBe('function')
    })

    it('exports extractTraceContext', () => {
      expect(typeof langfuse.extractTraceContext).toBe('function')
    })
  })
})
