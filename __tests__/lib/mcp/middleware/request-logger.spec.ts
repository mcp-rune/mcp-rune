/**
 * Request Logger — Structured Log Shape Tests
 *
 * The request-logger middleware produces the "generic" per-request log lines:
 * - "Request started"  → { service, method, path, requestId [, body] }
 * - "Request completed" → { service, method, path, statusCode, duration, requestId }
 *
 * The requestId field ties all log lines for the same HTTP request together
 * when queried in Loki/Grafana.
 */

// Define mock logger using vi.hoisted()
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Mock logger
vi.mock('#src/services/logger.js', () => mockLogger)

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

    middleware = createRequestLoggerMiddleware()

    mockReq = {
      method: 'GET',
      path: '/test',
      requestId: 'test-request-id'
    }

    finishHandler = null
    mockRes = {
      statusCode: 200,
      on: vi.fn((event, handler) => {
        if (event === 'finish') {
          finishHandler = handler
        }
      })
    }

    mockNext = vi.fn()
  })

  describe('createRequestLoggerMiddleware', () => {
    it('should return a middleware function', () => {
      expect(typeof middleware).toBe('function')
      expect(middleware.length).toBe(3) // req, res, next
    })

    it('should log request start with method, path, and requestId', () => {
      middleware(mockReq, mockRes, mockNext)

      expect(logger.info).toHaveBeenCalledWith('Request started', {
        service: 'express',
        method: 'GET',
        path: '/test',
        requestId: 'test-request-id'
      })
    })

    it('should include body in start log for POST requests', () => {
      mockReq.method = 'POST'
      mockReq.body = { name: 'test' }

      middleware(mockReq, mockRes, mockNext)

      expect(logger.info).toHaveBeenCalledWith('Request started', {
        service: 'express',
        method: 'POST',
        path: '/test',
        requestId: 'test-request-id',

        body: { name: 'test' }
      })
    })

    it('should include body in start log for PUT requests', () => {
      mockReq.method = 'PUT'
      mockReq.body = { id: 1, name: 'updated' }

      middleware(mockReq, mockRes, mockNext)

      expect(logger.info).toHaveBeenCalledWith('Request started', {
        service: 'express',
        method: 'PUT',
        path: '/test',
        requestId: 'test-request-id',

        body: { id: 1, name: 'updated' }
      })
    })

    it('should include body in start log for PATCH requests', () => {
      mockReq.method = 'PATCH'
      mockReq.body = { name: 'patched' }

      middleware(mockReq, mockRes, mockNext)

      expect(logger.info).toHaveBeenCalledWith('Request started', {
        service: 'express',
        method: 'PATCH',
        path: '/test',
        requestId: 'test-request-id',

        body: { name: 'patched' }
      })
    })

    it('should not include body for GET requests', () => {
      mockReq.method = 'GET'
      mockReq.body = { ignored: 'data' }

      middleware(mockReq, mockRes, mockNext)

      expect(logger.info).toHaveBeenCalledWith('Request started', {
        service: 'express',
        method: 'GET',
        path: '/test',
        requestId: 'test-request-id'
      })
    })

    it('should not include body for DELETE requests', () => {
      mockReq.method = 'DELETE'
      mockReq.body = { ignored: 'data' }

      middleware(mockReq, mockRes, mockNext)

      expect(logger.info).toHaveBeenCalledWith('Request started', {
        service: 'express',
        method: 'DELETE',
        path: '/test',
        requestId: 'test-request-id'
      })
    })

    it('should call next() to continue middleware chain', () => {
      middleware(mockReq, mockRes, mockNext)

      expect(mockNext).toHaveBeenCalledTimes(1)
    })

    it('should register finish event handler', () => {
      middleware(mockReq, mockRes, mockNext)

      expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function))
    })
  })

  describe('response finish handler', () => {
    it('should log info for successful responses (2xx)', () => {
      mockRes.statusCode = 200

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          service: 'express',
          method: 'GET',
          path: '/test',
          statusCode: 200,
          requestId: 'test-request-id'
        })
      )
    })

    it('should log info for redirect responses (3xx)', () => {
      mockRes.statusCode = 302

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          statusCode: 302
        })
      )
    })

    it('should log warn for client error responses (4xx)', () => {
      mockRes.statusCode = 404

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.warn).toHaveBeenCalledWith(
        'Request error',
        expect.objectContaining({
          statusCode: 404
        })
      )
    })

    it('should log warn for 400 Bad Request', () => {
      mockRes.statusCode = 400

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.warn).toHaveBeenCalledWith(
        'Request error',
        expect.objectContaining({
          statusCode: 400
        })
      )
    })

    it('should log warn for 401 Unauthorized', () => {
      mockRes.statusCode = 401

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.warn).toHaveBeenCalledWith(
        'Request error',
        expect.objectContaining({
          statusCode: 401
        })
      )
    })

    it('should log error for server error responses (5xx)', () => {
      mockRes.statusCode = 500

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.error).toHaveBeenCalledWith(
        'Request failed',
        expect.objectContaining({
          statusCode: 500
        })
      )
    })

    it('should log error for 502 Bad Gateway', () => {
      mockRes.statusCode = 502

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.error).toHaveBeenCalledWith(
        'Request failed',
        expect.objectContaining({
          statusCode: 502
        })
      )
    })

    it('should include duration in log', () => {
      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          duration: expect.stringMatching(/^\d+ms$/)
        })
      )
    })

    it('should include all required fields in completion log', () => {
      mockRes.statusCode = 201

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      expect(logger.info).toHaveBeenCalledWith('Request completed', {
        service: 'express',
        method: 'GET',
        path: '/test',
        statusCode: 201,
        duration: expect.stringMatching(/^\d+ms$/),
        requestId: 'test-request-id'
      })
    })
  })

  describe('structured log shape (exact keys, no extras)', () => {
    it('should produce start log with exactly the expected keys for GET', () => {
      middleware(mockReq, mockRes, mockNext)

      const startCall = logger.info.mock.calls.find((c) => c[0] === 'Request started')
      const logData = startCall[1]

      const expectedKeys = ['service', 'method', 'path', 'requestId']
      expect(Object.keys(logData).sort()).toEqual(expectedKeys.sort())
    })

    it('should produce start log with body key added for POST', () => {
      mockReq.method = 'POST'
      mockReq.body = { name: 'test' }

      middleware(mockReq, mockRes, mockNext)

      const startCall = logger.info.mock.calls.find((c) => c[0] === 'Request started')
      const logData = startCall[1]

      const expectedKeys = ['service', 'method', 'path', 'requestId', 'body']
      expect(Object.keys(logData).sort()).toEqual(expectedKeys.sort())
    })

    it('should produce completion log with exactly the expected keys', () => {
      mockRes.statusCode = 200

      middleware(mockReq, mockRes, mockNext)
      finishHandler()

      const completionCall = logger.info.mock.calls.find((c) => c[0] === 'Request completed')
      const logData = completionCall[1]

      const expectedKeys = ['service', 'method', 'path', 'statusCode', 'duration', 'requestId']
      expect(Object.keys(logData).sort()).toEqual(expectedKeys.sort())
    })
  })
})
