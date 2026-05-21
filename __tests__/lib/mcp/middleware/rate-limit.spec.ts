import { createHash } from 'node:crypto'

const { mockRateLimit, mockIpKeyGenerator } = vi.hoisted(() => ({
  mockRateLimit: vi.fn((opts) => ({ __mock: 'limiter', opts })),
  mockIpKeyGenerator: vi.fn((ip) => `ip:${ip}`)
}))

vi.mock('express-rate-limit', () => ({
  default: mockRateLimit,
  ipKeyGenerator: mockIpKeyGenerator
}))

import { createMcpRateLimitMiddleware } from '../../../../src/mcp/middleware/rate-limit.js'

describe('lib/mcp/middleware/rate-limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('configures a 15-minute window and a 100-request limit', () => {
    createMcpRateLimitMiddleware()
    expect(mockRateLimit).toHaveBeenCalledTimes(1)
    const opts = mockRateLimit.mock.calls[0][0]
    expect(opts.windowMs).toBe(15 * 60 * 1000)
    expect(opts.limit).toBe(100)
    expect(opts.standardHeaders).toBe('draft-7')
    expect(opts.legacyHeaders).toBe(false)
  })

  it('uses a JSON-RPC-shaped error body so MCP clients can surface it', () => {
    createMcpRateLimitMiddleware()
    const opts = mockRateLimit.mock.calls[0][0]
    expect(opts.message).toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Too many requests, please try again later' },
      id: null
    })
  })

  describe('keyGenerator', () => {
    let keyGen
    beforeEach(() => {
      createMcpRateLimitMiddleware()
      keyGen = mockRateLimit.mock.calls[0][0].keyGenerator
    })

    it('hashes the Bearer token (per-user limiting)', () => {
      const token = 'abc.def.ghi'
      const expectedHash = createHash('sha256').update(token).digest('hex').slice(0, 16)
      const key = keyGen({ headers: { authorization: `Bearer ${token}` }, ip: '10.0.0.1' })
      expect(key).toBe(`token:${expectedHash}`)
      expect(mockIpKeyGenerator).not.toHaveBeenCalled()
    })

    it('falls back to IP-based limiting when no token', () => {
      const key = keyGen({ headers: {}, ip: '192.168.1.5' })
      expect(mockIpKeyGenerator).toHaveBeenCalledWith('192.168.1.5')
      expect(key).toBe('ip:192.168.1.5')
    })
  })
})
