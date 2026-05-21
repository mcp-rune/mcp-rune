const { mockCorsHandler, mockCorsFactory, mockLogger } = vi.hoisted(() => ({
  mockCorsHandler: vi.fn((_req, _res, next) => next()),
  mockCorsFactory: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('cors', () => ({
  default: (opts) => {
    mockCorsFactory(opts)
    return mockCorsHandler
  }
}))

vi.mock('#src/services/logger.js', () => mockLogger)

import * as logger from '#src/services/logger.js'

import { createCorsMiddleware } from '../../../../src/mcp/middleware/cors.js'

describe('lib/mcp/middleware/cors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the middleware produced by cors()', () => {
    const middleware = createCorsMiddleware({
      corsOrigins: undefined,
      isProduction: false,
      serviceName: 'svc'
    })
    expect(middleware).toBe(mockCorsHandler)
  })

  it('splits and trims a comma-separated allow-list', () => {
    createCorsMiddleware({
      corsOrigins: 'https://a.com, https://b.com ,https://c.com',
      isProduction: true,
      serviceName: 'svc'
    })
    expect(mockCorsFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: ['https://a.com', 'https://b.com', 'https://c.com']
      })
    )
  })

  it('allows all origins in development when not configured', () => {
    createCorsMiddleware({ corsOrigins: undefined, isProduction: false, serviceName: 'svc' })
    expect(mockCorsFactory).toHaveBeenCalledWith(expect.objectContaining({ origin: true }))
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('blocks all origins and warns when production has no CORS_ORIGINS', () => {
    createCorsMiddleware({ corsOrigins: undefined, isProduction: true, serviceName: 'svc' })
    expect(mockCorsFactory).toHaveBeenCalledWith(expect.objectContaining({ origin: false }))
    expect(logger.warn).toHaveBeenCalledWith(
      'CORS_ORIGINS not set in production -- cross-origin requests will be blocked',
      { service: 'svc' }
    )
  })

  it('passes the MCP-specific header/method allow-lists', () => {
    createCorsMiddleware({
      corsOrigins: 'https://a.com',
      isProduction: true,
      serviceName: 'svc'
    })
    expect(mockCorsFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: false,
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Authorization',
          'Content-Type',
          'X-Request-ID',
          'Mcp-Session-Id',
          'MCP-Protocol-Version'
        ],
        exposedHeaders: ['mcp-session-id', 'X-Request-ID']
      })
    )
  })
})
