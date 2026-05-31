import { BaseTool } from '../../../../src/mcp/tools/base-tool.js'
import { TOOL_CATEGORIES } from '../../../../src/mcp/tools/categories.js'

vi.mock('../../../../src/services/vector-storage.js', () => ({
  storeOperation: vi.fn().mockResolvedValue(null)
}))

describe('lib/mcp/tools/base-tool', () => {
  describe('abstract methods', () => {
    it('should throw when name getter is not implemented', () => {
      const tool = new BaseTool()
      expect(() => tool.name).toThrow('Tool must implement name getter')
    })

    it('should throw when baseDescription getter is not implemented', () => {
      const tool = new BaseTool()
      expect(() => tool.baseDescription).toThrow('Tool must implement baseDescription getter')
    })

    it('should throw when inputSchema getter is not implemented', () => {
      const tool = new BaseTool()
      expect(() => tool.inputSchema).toThrow('Tool must implement inputSchema getter')
    })

    it('should throw when execute is not implemented', async () => {
      const tool = new BaseTool()
      await expect(tool.execute({})).rejects.toThrow('Tool must implement execute method')
    })
  })

  describe('constructor dependency injection', () => {
    it('should accept dataLayer', () => {
      const dataLayer = { create: () => {}, find: () => {} } as never
      const tool = new BaseTool({ dataLayer })
      expect(tool.dataLayer).toBe(dataLayer)
    })

    it('should accept logger', () => {
      const logger = { info: () => {} }
      const tool = new BaseTool({ logger })
      expect(tool.logger).toBe(logger)
    })

    it('should use provided models config', () => {
      const models = { custom_model: { api: { endpoint: 'custom' } } }
      const tool = new BaseTool({ models })
      expect(tool.models).toBe(models)
    })

    it('should use empty object when models not provided', () => {
      const tool = new BaseTool()
      expect(tool.models).toEqual({})
    })

    it('should accept promptRegistry', () => {
      const promptRegistry = { create_book: {} }
      const tool = new BaseTool({ promptRegistry })
      expect(tool.promptRegistry).toBe(promptRegistry)
    })

    it('should accept serverContext', () => {
      const serverContext = { name: 'Test Server', description: 'A test server' }
      const tool = new BaseTool({ serverContext })
      expect(tool.serverContext).toBe(serverContext)
    })

    it('should default serverContext to empty object', () => {
      const tool = new BaseTool()
      expect(tool.serverContext).toEqual({})
    })

    it('should handle empty dependencies', () => {
      const tool = new BaseTool()
      expect(tool.dataLayer).toBeUndefined()
      expect(tool.logger).toBeUndefined()
    })
  })

  describe('category and authentication', () => {
    it('should default to DATA category', () => {
      expect(BaseTool.category).toBe(TOOL_CATEGORIES.DATA)
    })

    it('should require auth by default', () => {
      expect(BaseTool.getRequiresAuth()).toBe(true)
    })

    it('should allow custom categories', () => {
      class StrategyTool extends BaseTool {
        static get category() {
          return TOOL_CATEGORIES.STRATEGY
        }
      }
      expect(StrategyTool.category).toBe(TOOL_CATEGORIES.STRATEGY)
      expect(StrategyTool.getRequiresAuth()).toBe(false)
    })

    it('should let a subclass override requiresAuth via field syntax', () => {
      class AnalysisWithAuth extends BaseTool {
        static override get category() {
          return TOOL_CATEGORIES.ANALYSIS
        }
        static override requiresAuth = true
      }
      // ANALYSIS category defaults to no-auth; the per-tool field wins.
      expect(AnalysisWithAuth.requiresAuth).toBe(true)
      expect(AnalysisWithAuth.getRequiresAuth()).toBe(true)
    })

    it('should let a subclass override requiresAuth to false against an auth-required category', () => {
      class DataNoAuth extends BaseTool {
        static override get category() {
          return TOOL_CATEGORIES.DATA
        }
        static override requiresAuth = false
      }
      // DATA category defaults to auth; the per-tool field still wins when explicitly false.
      expect(DataNoAuth.requiresAuth).toBe(false)
      expect(DataNoAuth.getRequiresAuth()).toBe(false)
    })

    it('should fall back to the category default when requiresAuth is unset', () => {
      class PlainAnalysis extends BaseTool {
        static override get category() {
          return TOOL_CATEGORIES.ANALYSIS
        }
      }
      expect(PlainAnalysis.requiresAuth).toBeUndefined()
      expect(PlainAnalysis.getRequiresAuth()).toBe(false)
    })
  })

  describe('annotations', () => {
    it('should return DATA category defaults for base tool', () => {
      const tool = new BaseTool()
      const annotations = tool.annotations
      expect(annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      })
    })

    it('should return category-specific defaults for subclasses', () => {
      class StrategyTool extends BaseTool {
        static get category() {
          return TOOL_CATEGORIES.STRATEGY
        }
      }
      const tool = new StrategyTool()
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      })
    })

    it('should allow per-tool overrides', () => {
      class ReadOnlyDataTool extends BaseTool {
        get annotations() {
          return {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true
          }
        }
      }
      const tool = new ReadOnlyDataTool()
      expect(tool.annotations.readOnlyHint).toBe(true)
      expect(tool.annotations.destructiveHint).toBe(false)
    })

    it('should return a fresh copy each time', () => {
      const tool = new BaseTool()
      const a = tool.annotations
      const b = tool.annotations
      expect(a).toEqual(b)
      expect(a).not.toBe(b)
    })
  })

  describe('getModelNames', () => {
    it('should return array of model names', () => {
      const tool = new BaseTool({
        models: { activity: {}, book: {}, theme: {} }
      })
      const models = tool.getModelNames()

      expect(Array.isArray(models)).toBe(true)
      expect(models).toEqual(['activity', 'book', 'theme'])
    })

    it('should return empty array when no models', () => {
      const tool = new BaseTool()
      const models = tool.getModelNames()
      expect(models).toEqual([])
    })
  })

  describe('description composition', () => {
    it('should return baseDescription by default', () => {
      class TestTool extends BaseTool {
        get name() {
          return 'test_tool'
        }
        get baseDescription() {
          return 'Base description'
        }
        get inputSchema() {
          return { type: 'object', properties: {} }
        }
      }

      const tool = new TestTool()
      expect(tool.description).toContain('Base description')
    })

    it('should include description sections when provided', () => {
      class TestTool extends BaseTool {
        get name() {
          return 'test_tool'
        }
        get baseDescription() {
          return 'Base description'
        }
        get inputSchema() {
          return { type: 'object', properties: {} }
        }
        getUsageRules() {
          return ['Section 1', 'Section 2']
        }
      }

      const tool = new TestTool()
      expect(tool.description).toContain('Base description')
      expect(tool.description).toContain('Section 1')
      expect(tool.description).toContain('Section 2')
    })
  })

  describe('formatError', () => {
    it('formats non-HTTP error without status (falls back to error.message)', () => {
      const tool = new BaseTool()
      // Network error, timeout, DNS failure — no HTTP response
      const error = new Error('Connection timeout')
      const result = tool.formatError(error)

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toBe('Connection timeout')
    })

    it('formats string response body with inline status', () => {
      const tool = new BaseTool()
      // Proxy/nginx 500: plain text body
      const error = Object.assign(new Error('API Error'), {
        response: { status: 500, data: 'Internal Server Error' }
      })
      const result = tool.formatError(error)
      expect(result.content[0].text).toBe('Internal Server Error (500)')
    })

    it('formats Rails validation hash as semicolon-separated field errors', () => {
      const tool = new BaseTool()
      // Rails 422: POST /api/titles with invalid attributes
      const error = Object.assign(new Error('API Error'), {
        response: {
          status: 422,
          data: {
            errors: { title: ["can't be blank"], status: ['is not included in the list'] }
          }
        }
      })
      const result = tool.formatError(error)
      expect(result.content[0].text).toBe(
        "title: can't be blank; status: is not included in the list (422)"
      )
    })

    it('formats single error object with inline status', () => {
      const tool = new BaseTool()
      // Rails 404: GET /api/titles/999
      const error = Object.assign(new Error('API Error'), {
        response: { status: 404, data: { error: 'Record not found' } }
      })
      const result = tool.formatError(error)
      expect(result.content[0].text).toBe('Record not found (404)')
    })

    it('formats error array with semicolons', () => {
      const tool = new BaseTool()
      // Rails 422: bulk validation errors as array
      const error = Object.assign(new Error('API Error'), {
        response: { status: 422, data: { errors: ['Title is required', 'Status must be valid'] } }
      })
      const result = tool.formatError(error)
      expect(result.content[0].text).toBe('Title is required; Status must be valid (422)')
    })

    it('shows Unknown error when response has no data', () => {
      const tool = new BaseTool()
      // Empty response body from upstream timeout
      const error = Object.assign(new Error('API Error'), {
        response: { status: 504 }
      })
      const result = tool.formatError(error)
      expect(result.content[0].text).toBe('Unknown error (504)')
    })

    it('truncates long error responses', () => {
      const tool = new BaseTool()
      const error = Object.assign(new Error('API Error'), {
        response: { status: 500, data: 'x'.repeat(6000) }
      })
      const result = tool.formatError(error)
      expect(result.content[0].text).toContain('[truncated]')
    })

    it('logs error when logger is available', () => {
      const mockLogger = { error: vi.fn() }
      class TestTool extends BaseTool {
        get name() {
          return 'test_tool'
        }
      }

      const tool = new TestTool({ logger: mockLogger })
      tool.formatError(new Error('Test error'))

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Tool execution failed',
        expect.objectContaining({
          tool: 'test_tool',
          error: 'Test error'
        })
      )
    })
  })

  describe('storeToolMemory', () => {
    it('calls storeOperation with correct params including sessionId', async () => {
      const { storeOperation } = await import('../../../../src/services/vector-storage.js')
      vi.mocked(storeOperation).mockResolvedValue(null)

      class TestTool extends BaseTool {
        get name() {
          return 'test_tool'
        }
        // Expose protected method for testing
        callStoreToolMemory(
          ...args: Parameters<BaseTool['storeToolMemory']>
        ): ReturnType<BaseTool['storeToolMemory']> {
          return this.storeToolMemory(...args)
        }
      }

      const tool = new TestTool({ serverContext: { sessionId: 'session-123' } })
      tool.callStoreToolMemory({
        toolName: 'test_tool',
        toolArgs: { model: 'title', id: '42' },
        toolOutput: { status: 'updated' },
        userId: 'user-1'
      })

      expect(storeOperation).toHaveBeenCalledWith({
        toolName: 'test_tool',
        toolArgs: { model: 'title', id: '42' },
        toolOutput: { status: 'updated' },
        userId: 'user-1',
        sessionId: 'session-123'
      })
    })

    it('logs warning when storeOperation rejects', async () => {
      const { storeOperation } = await import('../../../../src/services/vector-storage.js')
      vi.mocked(storeOperation).mockRejectedValue(new Error('DB connection failed'))

      const mockLogger = { warn: vi.fn() }
      class TestTool extends BaseTool {
        get name() {
          return 'test_tool'
        }
        callStoreToolMemory(
          ...args: Parameters<BaseTool['storeToolMemory']>
        ): ReturnType<BaseTool['storeToolMemory']> {
          return this.storeToolMemory(...args)
        }
      }

      const tool = new TestTool({ logger: mockLogger })
      tool.callStoreToolMemory({ toolName: 'test', toolArgs: {} })

      // Wait for the promise rejection to be handled
      await vi.waitFor(() => {
        expect(mockLogger.warn).toHaveBeenCalledWith('Vector storage failed', {
          service: 'mcp-tools',
          error: 'DB connection failed'
        })
      })
    })

    it('does not throw when logger is missing and storeOperation rejects', async () => {
      const { storeOperation } = await import('../../../../src/services/vector-storage.js')
      vi.mocked(storeOperation).mockRejectedValue(new Error('DB down'))

      class TestTool extends BaseTool {
        get name() {
          return 'test_tool'
        }
        callStoreToolMemory(
          ...args: Parameters<BaseTool['storeToolMemory']>
        ): ReturnType<BaseTool['storeToolMemory']> {
          return this.storeToolMemory(...args)
        }
      }

      const tool = new TestTool()
      // Should not throw
      tool.callStoreToolMemory({ toolName: 'test', toolArgs: {} })
      await new Promise((r) => setTimeout(r, 10))
    })
  })

  describe('formatResponse', () => {
    it('should format object as JSON', () => {
      const tool = new BaseTool()
      const result = tool.formatResponse({ id: 1, name: 'Test' })

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toBe('{\n  "id": 1,\n  "name": "Test"\n}')
      expect(result.isError).toBeUndefined()
    })

    it('should pass string directly', () => {
      const tool = new BaseTool()
      const result = tool.formatResponse('Plain text response')

      expect(result.content[0].text).toBe('Plain text response')
    })

    it('should format arrays', () => {
      const tool = new BaseTool()
      const result = tool.formatResponse([1, 2, 3])

      expect(result.content[0].text).toBe('[\n  1,\n  2,\n  3\n]')
    })
  })

  describe('truncateString', () => {
    it('should return string if shorter than maxLength', () => {
      const tool = new BaseTool()
      const result = tool.truncateString('hello', 10)
      expect(result).toBe('hello')
    })

    it('should truncate and add indicator if longer', () => {
      const tool = new BaseTool()
      const result = tool.truncateString('hello world', 5)
      expect(result).toBe('hello...\n[truncated]')
    })
  })

  describe('sanitizeResponseData', () => {
    it('should return JSON string', () => {
      const tool = new BaseTool()
      const result = tool.sanitizeResponseData({ foo: 'bar' })
      expect(result).toBe('{\n  "foo": "bar"\n}')
    })
  })

  describe('requireDataLayer', () => {
    it('should throw when dataLayer is not set', () => {
      const tool = new BaseTool()
      expect(() => tool.requireDataLayer()).toThrow('Not authenticated')
    })

    it('should not throw when dataLayer is set', () => {
      const tool = new BaseTool({ dataLayer: { create: () => {} } as never })
      expect(() => tool.requireDataLayer()).not.toThrow()
    })
  })

  describe('sendProgress', () => {
    class TestTool extends BaseTool {
      get name() {
        return 'test_tool'
      }
      get baseDescription() {
        return 'Test'
      }
      get inputSchema() {
        return {}
      }
      async callSendProgress(
        ...args: Parameters<BaseTool['sendProgress']>
      ): ReturnType<BaseTool['sendProgress']> {
        return this.sendProgress(...args)
      }
    }

    it('should send progress notification when progressToken is set', async () => {
      const sendNotification = vi.fn().mockResolvedValue(undefined)
      const tool = new TestTool()
      tool._extra = {
        _meta: { progressToken: 'tok-1' },
        sendNotification
      }

      await tool.callSendProgress({ progress: 3, total: 10, message: 'Page 3/10' })

      expect(sendNotification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: { progressToken: 'tok-1', progress: 3, total: 10, message: 'Page 3/10' }
      })
    })

    it('should support numeric progressToken', async () => {
      const sendNotification = vi.fn().mockResolvedValue(undefined)
      const tool = new TestTool()
      tool._extra = {
        _meta: { progressToken: 42 },
        sendNotification
      }

      await tool.callSendProgress({ progress: 1 })

      expect(sendNotification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: { progressToken: 42, progress: 1 }
      })
    })

    it('should no-op when no progressToken', async () => {
      const sendNotification = vi.fn()
      const tool = new TestTool()
      tool._extra = { _meta: {}, sendNotification }

      await tool.callSendProgress({ progress: 1 })

      expect(sendNotification).not.toHaveBeenCalled()
    })

    it('should no-op when no _extra', async () => {
      const tool = new TestTool()

      // Should not throw
      await tool.callSendProgress({ progress: 1 })
    })

    it('should no-op when no sendNotification', async () => {
      const tool = new TestTool()
      tool._extra = { _meta: { progressToken: 'tok' } }

      // Should not throw
      await tool.callSendProgress({ progress: 1 })
    })
  })

  describe('abortSignal', () => {
    it('should return signal from _extra', () => {
      class TestTool extends BaseTool {
        get name() {
          return 'test_tool'
        }
        getSignal() {
          return this.abortSignal
        }
      }

      const controller = new AbortController()
      const tool = new TestTool()
      tool._extra = { signal: controller.signal }

      expect(tool.getSignal()).toBe(controller.signal)
    })

    it('should return undefined when no _extra', () => {
      class TestTool extends BaseTool {
        get name() {
          return 'test_tool'
        }
        getSignal() {
          return this.abortSignal
        }
      }

      const tool = new TestTool()
      expect(tool.getSignal()).toBeUndefined()
    })
  })
})
