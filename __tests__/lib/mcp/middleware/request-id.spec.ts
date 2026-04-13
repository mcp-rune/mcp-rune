import { createRequestIdMiddleware } from '../../../../src/mcp/middleware/request-id.js'

describe('lib/mcp/middleware/request-id', () => {
  let middleware
  let mockReq
  let mockRes
  let mockNext

  beforeEach(() => {
    middleware = createRequestIdMiddleware()
    mockReq = {
      get: vi.fn()
    }
    mockRes = {
      set: vi.fn()
    }
    mockNext = vi.fn()
  })

  describe('createRequestIdMiddleware', () => {
    it('should return a middleware function', () => {
      expect(typeof middleware).toBe('function')
      expect(middleware.length).toBe(3) // req, res, next
    })

    it('should use incoming X-Request-ID header if present', () => {
      const incomingId = 'upstream-request-id-123'
      mockReq.get.mockReturnValue(incomingId)

      middleware(mockReq, mockRes, mockNext)

      expect(mockReq.get).toHaveBeenCalledWith('X-Request-ID')
      expect(mockReq.requestId).toBe(incomingId)
      expect(mockRes.set).toHaveBeenCalledWith('X-Request-ID', incomingId)
    })

    it('should generate UUID v4 if no incoming header', () => {
      mockReq.get.mockReturnValue(undefined)

      middleware(mockReq, mockRes, mockNext)

      expect(mockReq.requestId).toBeDefined()
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(mockReq.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
      expect(mockRes.set).toHaveBeenCalledWith('X-Request-ID', mockReq.requestId)
    })

    it('should generate UUID when header is empty string', () => {
      mockReq.get.mockReturnValue('')

      middleware(mockReq, mockRes, mockNext)

      expect(mockReq.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('should set request ID on req object', () => {
      mockReq.get.mockReturnValue(undefined)

      middleware(mockReq, mockRes, mockNext)

      expect(mockReq.requestId).toBeDefined()
    })

    it('should set X-Request-ID response header', () => {
      const incomingId = 'test-id'
      mockReq.get.mockReturnValue(incomingId)

      middleware(mockReq, mockRes, mockNext)

      expect(mockRes.set).toHaveBeenCalledWith('X-Request-ID', incomingId)
    })

    it('should call next() to continue middleware chain', () => {
      mockReq.get.mockReturnValue(undefined)

      middleware(mockReq, mockRes, mockNext)

      expect(mockNext).toHaveBeenCalledTimes(1)
      expect(mockNext).toHaveBeenCalledWith()
    })

    it('should generate unique IDs for different requests', () => {
      mockReq.get.mockReturnValue(undefined)

      const ids = new Set()
      for (let i = 0; i < 100; i++) {
        const req = { get: vi.fn().mockReturnValue(undefined) }
        middleware(req, mockRes, mockNext)
        ids.add(req.requestId)
      }

      expect(ids.size).toBe(100) // All unique
    })
  })
})
