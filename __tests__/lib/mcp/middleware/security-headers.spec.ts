import { createSecurityHeadersMiddleware } from '../../../../src/mcp/middleware/security-headers.js'

describe('lib/mcp/middleware/security-headers', () => {
  let mockReq
  let mockRes
  let mockNext

  beforeEach(() => {
    mockReq = {}
    mockRes = { setHeader: vi.fn() }
    mockNext = vi.fn()
  })

  it('returns a 3-arg middleware function', () => {
    const middleware = createSecurityHeadersMiddleware({ isProduction: false })
    expect(typeof middleware).toBe('function')
    expect(middleware.length).toBe(3)
  })

  it('always sets X-Frame-Options, X-Content-Type-Options, X-XSS-Protection', () => {
    const middleware = createSecurityHeadersMiddleware({ isProduction: false })
    middleware(mockReq, mockRes, mockNext)

    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY')
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff')
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block')
  })

  it('does NOT set HSTS in development', () => {
    const middleware = createSecurityHeadersMiddleware({ isProduction: false })
    middleware(mockReq, mockRes, mockNext)

    const calls = mockRes.setHeader.mock.calls.map((c) => c[0])
    expect(calls).not.toContain('Strict-Transport-Security')
  })

  it('sets HSTS in production', () => {
    const middleware = createSecurityHeadersMiddleware({ isProduction: true })
    middleware(mockReq, mockRes, mockNext)

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    )
  })

  it('calls next()', () => {
    const middleware = createSecurityHeadersMiddleware({ isProduction: true })
    middleware(mockReq, mockRes, mockNext)
    expect(mockNext).toHaveBeenCalledTimes(1)
    expect(mockNext).toHaveBeenCalledWith()
  })
})
