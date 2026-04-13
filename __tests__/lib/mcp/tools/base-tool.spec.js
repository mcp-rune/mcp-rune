import { vi, describe, it, expect } from 'vitest'
import { BaseTool } from '../../../../lib/mcp/tools/base-tool.js'
import { TOOL_CATEGORIES } from '../../../../lib/mcp/tools/categories.js'

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
    it('should accept apiClient', () => {
      const apiClient = { get: () => {} }
      const tool = new BaseTool({ apiClient })
      expect(tool.apiClient).toBe(apiClient)
    })

    it('should accept logger', () => {
      const logger = { info: () => {} }
      const tool = new BaseTool({ logger })
      expect(tool.logger).toBe(logger)
    })

    it('should use provided models config', () => {
      const models = { custom_model: { endpoint: 'custom' } }
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
      expect(tool.apiClient).toBeUndefined()
      expect(tool.logger).toBeUndefined()
    })
  })

  describe('category and authentication', () => {
    it('should default to CRUD category', () => {
      expect(BaseTool.category).toBe(TOOL_CATEGORIES.CRUD)
    })

    it('should require auth by default', () => {
      expect(BaseTool.requiresAuth).toBe(true)
    })

    it('should allow custom categories', () => {
      class StrategyTool extends BaseTool {
        static get category() {
          return TOOL_CATEGORIES.STRATEGY
        }
      }
      expect(StrategyTool.category).toBe(TOOL_CATEGORIES.STRATEGY)
      expect(StrategyTool.requiresAuth).toBe(false)
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

    it('should generate disambiguation note from serverContext', () => {
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

      const tool = new TestTool({
        serverContext: {
          name: 'Engineer',
          description: 'personal learning tracker',
          productLines: ['Engineer', 'Other App']
        }
      })
      expect(tool.description).toContain('Engineer')
      expect(tool.description).toContain('personal learning tracker')
      expect(tool.description).toContain('Engineer, Other App')
    })
  })

  describe('getDisambiguationNote', () => {
    it('should return empty string when no serverContext name', () => {
      const tool = new BaseTool()
      expect(tool.getDisambiguationNote()).toBe('')
    })

    it('should generate note with name only', () => {
      const tool = new BaseTool({ serverContext: { name: 'Test Server' } })
      const note = tool.getDisambiguationNote()
      expect(note).toContain('This tool operates on Test Server specifically')
      expect(note).toContain('confirm they intend to use')
      expect(note).not.toContain('Multiple product lines')
    })

    it('should include description when provided', () => {
      const tool = new BaseTool({
        serverContext: { name: 'Test Server', description: 'a test system' }
      })
      const note = tool.getDisambiguationNote()
      expect(note).toContain('Test Server is the a test system')
    })

    it('should include product lines when multiple', () => {
      const tool = new BaseTool({
        serverContext: {
          name: 'Test Server',
          productLines: ['Product A', 'Product B', 'Product C']
        }
      })
      const note = tool.getDisambiguationNote()
      expect(note).toContain(
        'Multiple product lines may be available (Product A, Product B, Product C)'
      )
    })

    it('should not include product lines when single', () => {
      const tool = new BaseTool({
        serverContext: {
          name: 'Test Server',
          productLines: ['Only One']
        }
      })
      const note = tool.getDisambiguationNote()
      expect(note).not.toContain('Multiple product lines')
    })
  })

  describe('formatError', () => {
    it('should format error with message', () => {
      const tool = new BaseTool()
      const error = new Error('Something failed')
      const result = tool.formatError(error)

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Something failed')
    })

    it('should include response data when available', () => {
      const tool = new BaseTool()
      const error = new Error('API Error')
      error.response = {
        status: 422,
        data: { errors: ['Title is required'] }
      }

      const result = tool.formatError(error)
      expect(result.content[0].text).toContain('Title is required')
      expect(result.content[0].text).toContain('422')
    })

    it('should handle string response data', () => {
      const tool = new BaseTool()
      const error = new Error('API Error')
      error.response = {
        status: 500,
        data: 'Internal Server Error'
      }

      const result = tool.formatError(error)
      expect(result.content[0].text).toContain('Internal Server Error')
    })

    it('should truncate long error responses', () => {
      const tool = new BaseTool()
      const error = new Error('API Error')
      error.response = {
        status: 500,
        data: 'x'.repeat(6000)
      }

      const result = tool.formatError(error)
      expect(result.content[0].text).toContain('[truncated]')
    })

    it('should log error when logger is available', () => {
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

  describe('requireApiClient', () => {
    it('should throw when apiClient is not set', () => {
      const tool = new BaseTool()
      expect(() => tool.requireApiClient()).toThrow('Not authenticated')
    })

    it('should not throw when apiClient is set', () => {
      const tool = new BaseTool({ apiClient: { get: () => {} } })
      expect(() => tool.requireApiClient()).not.toThrow()
    })
  })
})
