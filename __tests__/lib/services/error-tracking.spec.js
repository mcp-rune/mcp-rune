import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the vendor module
vi.mock('../../../src/services/vendor/sentry/index.js', () => ({
  ErrorCategory: {
    VALIDATION: 'validation_error',
    AUTH: 'auth_error',
    NOT_FOUND: 'not_found',
    CONNECTION: 'connection_error',
    RATE_LIMIT: 'rate_limit',
    TIMEOUT: 'timeout',
    INTERNAL: 'internal_error'
  },
  initialize: vi.fn(() => true),
  isConfigured: vi.fn(() => true),
  captureToolError: vi.fn(),
  captureApiError: vi.fn(),
  capturePromptError: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  categorizeError: vi.fn(() => 'internal_error'),
  addBreadcrumb: vi.fn(),
  addToolBreadcrumb: vi.fn(),
  setMcpClientContext: vi.fn(),
  setUser: vi.fn(),
  clearUser: vi.fn(),
  sanitizeToolArgs: vi.fn((args) => args),
  flush: vi.fn(() => Promise.resolve(true)),
  close: vi.fn(() => Promise.resolve(true))
}))

import {
  initErrorTracking,
  isErrorTrackingEnabled,
  captureToolError,
  captureApiError,
  capturePromptError,
  captureException,
  captureMessage,
  categorizeError,
  addBreadcrumb,
  addToolBreadcrumb,
  setMcpClientContext,
  setUser,
  clearUser,
  sanitizeToolArgs,
  flushErrorTracking,
  closeErrorTracking,
  ErrorCategory
} from '../../../src/services/error-tracking.js'

import * as vendor from '../../../src/services/vendor/sentry/index.js'

describe('lib/services/error-tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('ErrorCategory', () => {
    it('should export error categories from vendor', () => {
      expect(ErrorCategory.VALIDATION).toBe('validation_error')
      expect(ErrorCategory.AUTH).toBe('auth_error')
      expect(ErrorCategory.INTERNAL).toBe('internal_error')
    })
  })

  describe('initErrorTracking', () => {
    it('should delegate to vendor.initialize', () => {
      const options = { serviceName: 'test-service' }
      const result = initErrorTracking(options)

      expect(vendor.initialize).toHaveBeenCalledWith(options)
      expect(result).toBe(true)
    })
  })

  describe('isErrorTrackingEnabled', () => {
    it('should delegate to vendor.isConfigured', () => {
      const result = isErrorTrackingEnabled()

      expect(vendor.isConfigured).toHaveBeenCalled()
      expect(result).toBe(true)
    })
  })

  describe('captureToolError', () => {
    it('should delegate to vendor.captureToolError', () => {
      const error = new Error('Test error')
      const toolName = 'find_model'
      const args = { model: 'book' }
      const context = { requestId: '123' }

      captureToolError(error, toolName, args, context)

      expect(vendor.captureToolError).toHaveBeenCalledWith(error, toolName, args, context)
    })

    it('should handle missing optional arguments', () => {
      const error = new Error('Test error')
      captureToolError(error, 'test_tool')

      expect(vendor.captureToolError).toHaveBeenCalledWith(error, 'test_tool', {}, {})
    })
  })

  describe('captureApiError', () => {
    it('should delegate to vendor.captureApiError', () => {
      const error = new Error('API error')
      const endpoint = '/api/users'
      const method = 'POST'
      const context = { userId: '123' }

      captureApiError(error, endpoint, method, context)

      expect(vendor.captureApiError).toHaveBeenCalledWith(error, endpoint, method, context)
    })

    it('should default to GET method', () => {
      const error = new Error('API error')
      captureApiError(error, '/api/users')

      expect(vendor.captureApiError).toHaveBeenCalledWith(error, '/api/users', 'GET', {})
    })
  })

  describe('capturePromptError', () => {
    it('should delegate to vendor.capturePromptError', () => {
      const error = new Error('Prompt error')
      const promptName = 'create_book'
      const context = { step: 1 }

      capturePromptError(error, promptName, context)

      expect(vendor.capturePromptError).toHaveBeenCalledWith(error, promptName, context)
    })
  })

  describe('captureException', () => {
    it('should delegate to vendor.captureException', () => {
      const error = new Error('Generic error')
      const context = { tags: { component: 'test' } }

      captureException(error, context)

      expect(vendor.captureException).toHaveBeenCalledWith(error, context)
    })
  })

  describe('captureMessage', () => {
    it('should delegate to vendor.captureMessage', () => {
      const message = 'Important event'
      const level = 'warning'
      const context = { extra: { count: 5 } }

      captureMessage(message, level, context)

      expect(vendor.captureMessage).toHaveBeenCalledWith(message, level, context)
    })

    it('should default to info level', () => {
      captureMessage('Test message')

      expect(vendor.captureMessage).toHaveBeenCalledWith('Test message', 'info', {})
    })
  })

  describe('categorizeError', () => {
    it('should delegate to vendor.categorizeError', () => {
      const error = new Error('Test')
      categorizeError(error)

      expect(vendor.categorizeError).toHaveBeenCalledWith(error)
    })
  })

  describe('breadcrumbs', () => {
    it('should delegate addBreadcrumb to vendor', () => {
      const breadcrumb = { category: 'test', message: 'Test breadcrumb' }
      addBreadcrumb(breadcrumb)

      expect(vendor.addBreadcrumb).toHaveBeenCalledWith(breadcrumb)
    })

    it('should delegate addToolBreadcrumb to vendor', () => {
      const toolName = 'find_model'
      const args = { model: 'book' }
      addToolBreadcrumb(toolName, args)

      expect(vendor.addToolBreadcrumb).toHaveBeenCalledWith(toolName, args)
    })
  })

  describe('context management', () => {
    it('should delegate setMcpClientContext to vendor', () => {
      const clientInfo = { name: 'claude-code', version: '1.0', transport: 'stdio' }
      setMcpClientContext(clientInfo)

      expect(vendor.setMcpClientContext).toHaveBeenCalledWith(clientInfo)
    })

    it('should delegate setUser to vendor', () => {
      const user = { id: '123', email: 'test@example.com' }
      setUser(user)

      expect(vendor.setUser).toHaveBeenCalledWith(user)
    })

    it('should delegate clearUser to vendor', () => {
      clearUser()

      expect(vendor.clearUser).toHaveBeenCalled()
    })
  })

  describe('sanitizeToolArgs', () => {
    it('should delegate to vendor.sanitizeToolArgs', () => {
      const args = { model: 'book', password: 'secret' }
      sanitizeToolArgs(args)

      expect(vendor.sanitizeToolArgs).toHaveBeenCalledWith(args)
    })
  })

  describe('lifecycle methods', () => {
    it('should delegate flushErrorTracking to vendor.flush', async () => {
      const result = await flushErrorTracking(3000)

      expect(vendor.flush).toHaveBeenCalledWith(3000)
      expect(result).toBe(true)
    })

    it('should use default timeout for flush', async () => {
      await flushErrorTracking()

      expect(vendor.flush).toHaveBeenCalledWith(2000)
    })

    it('should delegate closeErrorTracking to vendor.close', async () => {
      const result = await closeErrorTracking(5000)

      expect(vendor.close).toHaveBeenCalledWith(5000)
      expect(result).toBe(true)
    })

    it('should use default timeout for close', async () => {
      await closeErrorTracking()

      expect(vendor.close).toHaveBeenCalledWith(2000)
    })
  })
})
