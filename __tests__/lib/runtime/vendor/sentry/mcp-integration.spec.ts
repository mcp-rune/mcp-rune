import {
  addToolBreadcrumb,
  captureApiError,
  capturePromptError,
  captureToolError,
  categorizeError,
  ErrorCategory,
  getAlertLevel,
  setMcpClientContext,
  startToolTransaction
} from '../../../../../src/runtime/vendor/sentry/mcp-integration.js'

// Mock Sentry to avoid actual API calls
vi.mock('@sentry/node', () => ({
  withScope: vi.fn((callback) =>
    callback({ setTag: vi.fn(), setLevel: vi.fn(), setContext: vi.fn(), setFingerprint: vi.fn() })
  ),
  captureException: vi.fn(),
  startSpan: vi.fn((options, callback) => callback({ end: vi.fn() })),
  addBreadcrumb: vi.fn(),
  setContext: vi.fn(),
  setTag: vi.fn()
}))

describe('lib/services/vendor/sentry/mcp-integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('ErrorCategory', () => {
    it('should export all error categories', () => {
      expect(ErrorCategory.VALIDATION).toBe('validation_error')
      expect(ErrorCategory.AUTH).toBe('auth_error')
      expect(ErrorCategory.NOT_FOUND).toBe('not_found')
      expect(ErrorCategory.CONNECTION).toBe('connection_error')
      expect(ErrorCategory.RATE_LIMIT).toBe('rate_limit')
      expect(ErrorCategory.TIMEOUT).toBe('timeout')
      expect(ErrorCategory.INTERNAL).toBe('internal_error')
    })
  })

  describe('categorizeError', () => {
    it('should categorize validation errors by message', () => {
      expect(categorizeError(new Error('Unknown model: foo'))).toBe(ErrorCategory.VALIDATION)
      expect(categorizeError(new Error('Invalid parameter'))).toBe(ErrorCategory.VALIDATION)
      expect(categorizeError(new Error('Missing required field'))).toBe(ErrorCategory.VALIDATION)
    })

    it('should categorize validation errors by status code', () => {
      const error400 = new Error('Bad request')
      error400.response = { status: 400 }
      expect(categorizeError(error400)).toBe(ErrorCategory.VALIDATION)

      const error422 = new Error('Unprocessable')
      error422.response = { status: 422 }
      expect(categorizeError(error422)).toBe(ErrorCategory.VALIDATION)
    })

    it('should categorize auth errors', () => {
      const error401 = new Error('Unauthorized')
      error401.response = { status: 401 }
      expect(categorizeError(error401)).toBe(ErrorCategory.AUTH)

      const error403 = new Error('Forbidden')
      error403.response = { status: 403 }
      expect(categorizeError(error403)).toBe(ErrorCategory.AUTH)

      expect(categorizeError(new Error('unauthorized access'))).toBe(ErrorCategory.AUTH)
    })

    it('should categorize not found errors', () => {
      const error404 = new Error('Not found')
      error404.response = { status: 404 }
      expect(categorizeError(error404)).toBe(ErrorCategory.NOT_FOUND)

      expect(categorizeError(new Error('Resource not found'))).toBe(ErrorCategory.NOT_FOUND)
    })

    it('should categorize rate limit errors', () => {
      const error429 = new Error('Too many requests')
      error429.response = { status: 429 }
      expect(categorizeError(error429)).toBe(ErrorCategory.RATE_LIMIT)

      expect(categorizeError(new Error('Rate limit exceeded'))).toBe(ErrorCategory.RATE_LIMIT)
    })

    it('should categorize connection errors', () => {
      const connRefused = new Error('Connection refused')
      connRefused.code = 'ECONNREFUSED'
      expect(categorizeError(connRefused)).toBe(ErrorCategory.CONNECTION)

      const notFound = new Error('Host not found')
      notFound.code = 'ENOTFOUND'
      expect(categorizeError(notFound)).toBe(ErrorCategory.CONNECTION)

      const connReset = new Error('Connection reset')
      connReset.code = 'ECONNRESET'
      expect(categorizeError(connReset)).toBe(ErrorCategory.CONNECTION)
    })

    it('should categorize timeout errors', () => {
      const timeout = new Error('Request timeout')
      timeout.code = 'ETIMEDOUT'
      expect(categorizeError(timeout)).toBe(ErrorCategory.TIMEOUT)

      expect(categorizeError(new Error('Operation timeout'))).toBe(ErrorCategory.TIMEOUT)
    })

    it('should default to internal error', () => {
      expect(categorizeError(new Error('Something went wrong'))).toBe(ErrorCategory.INTERNAL)
      expect(categorizeError(new Error(''))).toBe(ErrorCategory.INTERNAL)
    })
  })

  describe('getAlertLevel', () => {
    it('should return error for critical categories', () => {
      expect(getAlertLevel(ErrorCategory.CONNECTION)).toBe('error')
      expect(getAlertLevel(ErrorCategory.AUTH)).toBe('error')
      expect(getAlertLevel(ErrorCategory.INTERNAL)).toBe('error')
    })

    it('should return warning for recoverable issues', () => {
      expect(getAlertLevel(ErrorCategory.RATE_LIMIT)).toBe('warning')
      expect(getAlertLevel(ErrorCategory.TIMEOUT)).toBe('warning')
    })

    it('should return info for user errors', () => {
      expect(getAlertLevel(ErrorCategory.VALIDATION)).toBe('info')
      expect(getAlertLevel(ErrorCategory.NOT_FOUND)).toBe('info')
    })

    it('should default to error for unknown categories', () => {
      expect(getAlertLevel('unknown')).toBe('error')
    })
  })

  describe('captureToolError', () => {
    it('sets scope tags and captures exception', async () => {
      const { withScope, captureException } = await import('@sentry/node')

      captureToolError(new Error('Tool failed'), 'create_model', { model: 'book' })

      expect(withScope).toHaveBeenCalled()
      expect(captureException).toHaveBeenCalled()
    })

    it('handles empty args', () => {
      captureToolError(new Error('fail'), 'find_records')
      // No error thrown
    })
  })

  describe('captureApiError', () => {
    it('captures API error with endpoint and method', async () => {
      const { withScope, captureException } = await import('@sentry/node')

      captureApiError(new Error('API down'), '/api/books', 'POST')

      expect(withScope).toHaveBeenCalled()
      expect(captureException).toHaveBeenCalled()
    })

    it('defaults method to GET', () => {
      captureApiError(new Error('Not found'), '/api/books')
      // No error thrown
    })
  })

  describe('capturePromptError', () => {
    it('captures prompt error with name', async () => {
      const { withScope, captureException } = await import('@sentry/node')

      capturePromptError(new Error('Prompt failed'), 'book_prompt')

      expect(withScope).toHaveBeenCalled()
      expect(captureException).toHaveBeenCalled()
    })
  })

  describe('startToolTransaction', () => {
    it('creates a span for tool execution', async () => {
      const { startSpan } = await import('@sentry/node')

      startToolTransaction('create_model', { model: 'book' })

      expect(startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'mcp.tool.create_model',
          op: 'mcp.tool'
        }),
        expect.any(Function)
      )
    })

    it('handles empty args', () => {
      startToolTransaction('find_records')
      // No error thrown
    })
  })

  describe('addToolBreadcrumb', () => {
    it('adds breadcrumb with tool info', async () => {
      const { addBreadcrumb } = await import('@sentry/node')

      addToolBreadcrumb('create_model', { model: 'book' })

      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'mcp.tool',
          message: 'Tool invoked: create_model',
          level: 'info'
        })
      )
    })
  })

  describe('setMcpClientContext', () => {
    it('sets client context and tags', async () => {
      const { setContext, setTag } = await import('@sentry/node')

      setMcpClientContext({ name: 'Claude Desktop', version: '1.0', transport: 'stdio' })

      expect(setContext).toHaveBeenCalledWith('mcp_client', {
        name: 'Claude Desktop',
        version: '1.0',
        transport: 'stdio'
      })
      expect(setTag).toHaveBeenCalledWith('mcp.client', 'Claude Desktop')
      expect(setTag).toHaveBeenCalledWith('mcp.transport', 'stdio')
    })
  })
})
