vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  withScope: vi.fn((cb) =>
    cb({
      setTag: vi.fn(),
      setLevel: vi.fn(),
      setContext: vi.fn(),
      setUser: vi.fn()
    })
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  setContext: vi.fn(),
  addBreadcrumb: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
  close: vi.fn().mockResolvedValue(true),
  captureConsoleIntegration: vi.fn(() => ({})),
  onUncaughtExceptionIntegration: vi.fn(() => ({})),
  onUnhandledRejectionIntegration: vi.fn(() => ({}))
}))

vi.mock('#src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

// Must import after mocks
const sentry = await import('../../../../../src/runtime/vendor/sentry/index.js')
import * as Sentry from '@sentry/node'

describe('lib/services/vendor/sentry/index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialize', () => {
    it('returns false when no DSN provided', () => {
      const result = sentry.initialize({})
      expect(result).toBe(false)
      expect(sentry.isConfigured()).toBe(false)
    })

    it('initializes Sentry with DSN and returns true', () => {
      const result = sentry.initialize({
        dsn: 'https://key@sentry.io/123',
        environment: 'test',
        hostname: 'localhost',
        serviceName: 'test-mcp',
        version: '1.0.0'
      })

      expect(result).toBe(true)
      expect(sentry.isConfigured()).toBe(true)
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://key@sentry.io/123',
          environment: 'test',
          release: 'test-mcp@1.0.0'
        })
      )
    })

    it('sets extra context when provided', () => {
      sentry.initialize({
        dsn: 'https://key@sentry.io/123',
        serviceName: 'test',
        version: '1.0.0',
        extra: { foo: 'bar' }
      })

      expect(Sentry.setContext).toHaveBeenCalledWith('server_config', { foo: 'bar' })
    })
  })

  describe('captureException', () => {
    it('does nothing when not configured', () => {
      // Reset state by initializing without DSN
      sentry.initialize({})
      sentry.captureException(new Error('test'))
      expect(Sentry.withScope).not.toHaveBeenCalled()
    })

    it('captures with scope when configured', () => {
      sentry.initialize({ dsn: 'https://key@sentry.io/123', serviceName: 'test', version: '1.0.0' })

      sentry.captureException(new Error('test'), {
        tags: { foo: 'bar' },
        extra: { detail: 'info' },
        user: { id: 'user-1' },
        level: 'warning'
      })

      expect(Sentry.withScope).toHaveBeenCalled()
    })
  })

  describe('captureMessage', () => {
    it('does nothing when not configured', () => {
      sentry.initialize({})
      sentry.captureMessage('test')
      expect(Sentry.withScope).not.toHaveBeenCalled()
    })

    it('captures message with scope when configured', () => {
      sentry.initialize({ dsn: 'https://key@sentry.io/123', serviceName: 'test', version: '1.0.0' })
      sentry.captureMessage('test message', 'warning', { tags: { env: 'test' } })
      expect(Sentry.withScope).toHaveBeenCalled()
    })
  })

  describe('setUser / clearUser', () => {
    it('does nothing when not configured', () => {
      sentry.initialize({})
      sentry.setUser({ id: 'u1' })
      sentry.clearUser()
      expect(Sentry.setUser).not.toHaveBeenCalled()
    })

    it('sets and clears user when configured', () => {
      sentry.initialize({ dsn: 'https://key@sentry.io/123', serviceName: 'test', version: '1.0.0' })
      sentry.setUser({ id: 'u1' })
      expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'u1' })

      sentry.clearUser()
      expect(Sentry.setUser).toHaveBeenCalledWith(null)
    })
  })

  describe('addBreadcrumb', () => {
    it('does nothing when not configured', () => {
      sentry.initialize({})
      sentry.addBreadcrumb({ message: 'test' })
      expect(Sentry.addBreadcrumb).not.toHaveBeenCalled()
    })

    it('adds breadcrumb when configured', () => {
      sentry.initialize({ dsn: 'https://key@sentry.io/123', serviceName: 'test', version: '1.0.0' })
      sentry.addBreadcrumb({ message: 'test' })
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({ message: 'test' })
    })
  })

  describe('flush / close', () => {
    it('flush returns true when not configured', async () => {
      sentry.initialize({})
      const result = await sentry.flush()
      expect(result).toBe(true)
    })

    it('close returns true when not configured', async () => {
      sentry.initialize({})
      const result = await sentry.close()
      expect(result).toBe(true)
    })

    it('delegates to Sentry when configured', async () => {
      sentry.initialize({ dsn: 'https://key@sentry.io/123', serviceName: 'test', version: '1.0.0' })
      await sentry.flush(3000)
      expect(Sentry.flush).toHaveBeenCalledWith(3000)

      await sentry.close(3000)
      expect(Sentry.close).toHaveBeenCalledWith(3000)
    })
  })

  describe('re-exports from mcp-integration', () => {
    it('exports captureToolError', () => {
      expect(typeof sentry.captureToolError).toBe('function')
    })

    it('exports captureApiError', () => {
      expect(typeof sentry.captureApiError).toBe('function')
    })

    it('exports capturePromptError', () => {
      expect(typeof sentry.capturePromptError).toBe('function')
    })

    it('exports categorizeError', () => {
      expect(typeof sentry.categorizeError).toBe('function')
    })

    it('exports ErrorCategory', () => {
      expect(sentry.ErrorCategory).toBeDefined()
    })

    it('exports sanitizeToolArgs', () => {
      expect(typeof sentry.sanitizeToolArgs).toBe('function')
    })
  })
})
