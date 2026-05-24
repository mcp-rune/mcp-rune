/**
 * Request Logger — one-line-per-request output
 *
 * The middleware emits a single `← METHOD path STATUS (totalMs[, upstream Xms])`
 * line on `res.finish`. Slow requests get a deferred `▸` line at 1s.
 * Domain context comes from the inbound endpoint-log allowlist for paths
 * like /oauth/token and /oauth/register; other paths log transport-only.
 */

const { mockLogger, mockGetUpstream } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  mockGetUpstream: vi.fn()
}))

vi.mock('#src/services/logger.js', () => mockLogger)
vi.mock('#src/services/request-context.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getUpstream: mockGetUpstream }
})

import * as logger from '#src/services/logger.js'

import { createRequestLoggerMiddleware } from '../../../../src/mcp/middleware/request-logger.js'

describe('lib/mcp/middleware/request-logger', () => {
  let middleware
  let mockReq
  let mockRes
  let mockNext
  let finishHandler

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUpstream.mockReturnValue({ totalMs: 0, calls: 0 })

    middleware = createRequestLoggerMiddleware()

    mockReq = {
      method: 'GET',
      path: '/test',
      body: undefined
    }

    finishHandler = null
    mockRes = {
      statusCode: 200,
      on: vi.fn((event, handler) => {
        if (event === 'finish') finishHandler = handler
      })
    }

    mockNext = vi.fn()
  })

  describe('middleware shape', () => {
    it('returns a 3-arg express handler', () => {
      expect(typeof middleware).toBe('function')
      expect(middleware.length).toBe(3)
    })

    it('calls next() to continue the middleware chain', () => {
      middleware(mockReq, mockRes, mockNext)
      expect(mockNext).toHaveBeenCalledTimes(1)
    })

    it('registers a finish handler on the response', () => {
      middleware(mockReq, mockRes, mockNext)
      expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function))
    })

    it('does not log on entry (one-line-per-request contract)', () => {
      middleware(mockReq, mockRes, mockNext)
      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('finish handler — single line per request', () => {
    it('emits one ← info line for 2xx with method/path/status/duration', () => {
      mockRes.statusCode = 200
      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.info).toHaveBeenCalledTimes(1)
      const [message, meta] = logger.info.mock.calls[0]
      expect(message).toMatch(/^← GET \/test 200 \(\d+ms\)$/)
      expect(meta).toEqual({
        service: 'express',
        durationMs: expect.any(Number),
        status: 200
      })
    })

    it('emits one ← info line for 3xx', () => {
      mockRes.statusCode = 302
      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      const [message] = logger.info.mock.calls[0]
      expect(message).toMatch(/^← GET \/test 302 \(\d+ms\)$/)
    })

    it('uses warn level for 4xx', () => {
      mockRes.statusCode = 404
      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.warn).toHaveBeenCalledTimes(1)
      const [message] = logger.warn.mock.calls[0]
      expect(message).toMatch(/^← GET \/test 404 \(\d+ms\)$/)
    })

    it('uses error level for 5xx', () => {
      mockRes.statusCode = 503
      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.error).toHaveBeenCalledTimes(1)
      const [message] = logger.error.mock.calls[0]
      expect(message).toMatch(/^← GET \/test 503 \(\d+ms\)$/)
    })
  })

  describe('upstream segment', () => {
    it('omits the upstream segment when no upstream calls happened', () => {
      mockGetUpstream.mockReturnValue({ totalMs: 0, calls: 0 })
      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      const [message, meta] = logger.info.mock.calls[0]
      expect(message).not.toMatch(/upstream/)
      expect(meta).not.toHaveProperty('upstreamMs')
      expect(meta).not.toHaveProperty('upstreamCalls')
    })

    it('includes upstream segment + structured fields when calls > 0', () => {
      mockGetUpstream.mockReturnValue({ totalMs: 132, calls: 1 })
      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      const [message, meta] = logger.info.mock.calls[0]
      expect(message).toMatch(/^← GET \/test 200 \(\d+ms, upstream 132ms\)$/)
      expect(meta).toMatchObject({ upstreamMs: 132, upstreamCalls: 1 })
    })
  })

  describe('inbound endpoint allowlist', () => {
    it('extracts grant_type and resource for POST /oauth/token', () => {
      mockReq.method = 'POST'
      mockReq.path = '/oauth/token'
      mockReq.body = {
        grant_type: 'authorization_code',
        resource: 'https://mcp.example/mcp',
        code: 'super-secret'
      }

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      const [, meta] = logger.info.mock.calls[0]
      expect(meta).toMatchObject({
        grantType: 'authorization_code',
        resource: 'https://mcp.example/mcp'
      })
      // `code` is in GLOBAL_REDACT — never surfaced (not in allowlist either).
      expect(meta).not.toHaveProperty('code')
    })

    it('extracts client_name for POST /oauth/register', () => {
      mockReq.method = 'POST'
      mockReq.path = '/oauth/register'
      mockReq.body = { client_name: 'Claude-Desktop', redirect_uris: ['x'] }

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      const [, meta] = logger.info.mock.calls[0]
      expect(meta).toMatchObject({ clientName: 'Claude-Desktop' })
      expect(meta).not.toHaveProperty('redirectUris')
    })

    it('does not extract any domain fields for unregistered paths', () => {
      mockReq.path = '/some/random/endpoint'
      mockReq.body = { anything: 'goes' }

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      const [, meta] = logger.info.mock.calls[0]
      expect(meta).not.toHaveProperty('anything')
    })
  })

  describe('deferred-start ▸ line', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not emit ▸ for a fast request (finishes before 1s)', () => {
      middleware(mockReq, mockRes, mockNext)
      vi.advanceTimersByTime(500)
      finishHandler()

      const startCall = logger.info.mock.calls.find(
        ([msg]) => typeof msg === 'string' && msg.startsWith('▸')
      )
      expect(startCall).toBeUndefined()
    })

    it('emits ▸ METHOD path after 1s if the request is still pending', () => {
      middleware(mockReq, mockRes, mockNext)
      vi.advanceTimersByTime(1500)

      const startCall = logger.info.mock.calls.find(
        ([msg]) => typeof msg === 'string' && msg === '▸ GET /test'
      )
      expect(startCall).toBeDefined()
      expect(startCall[1]).toEqual({ service: 'express' })
    })

    it('clears the deferred-start timer on finish so ▸ never fires after completion', () => {
      middleware(mockReq, mockRes, mockNext)
      finishHandler()
      vi.advanceTimersByTime(5000)

      const startCall = logger.info.mock.calls.find(
        ([msg]) => typeof msg === 'string' && msg.startsWith('▸')
      )
      expect(startCall).toBeUndefined()
    })
  })
})
