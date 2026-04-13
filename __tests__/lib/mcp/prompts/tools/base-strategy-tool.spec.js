import { describe, it, expect } from 'vitest'
import { BaseStrategyTool } from '../../../../../lib/mcp/prompts/tools/base-strategy-tool.js'
import { BaseTool } from '../../../../../lib/mcp/tools/base-tool.js'
import { TOOL_CATEGORIES } from '../../../../../lib/mcp/tools/categories.js'

describe('lib/mcp/prompts/tools/base-strategy-tool', () => {
  describe('inheritance', () => {
    it('should extend BaseTool', () => {
      const tool = new BaseStrategyTool({})
      expect(tool).toBeInstanceOf(BaseTool)
    })
  })

  describe('category', () => {
    it('should have STRATEGY category', () => {
      expect(BaseStrategyTool.category).toBe(TOOL_CATEGORIES.STRATEGY)
    })

    it('should not require auth (strategy tools are public)', () => {
      expect(BaseStrategyTool.requiresAuth).toBe(false)
    })
  })

  describe('getStrategy', () => {
    it('should return stateless strategy by default', () => {
      const tool = new BaseStrategyTool({})
      const mockPromptClass = {}

      const strategy = tool.getStrategy(mockPromptClass)

      expect(strategy).toBeDefined()
      expect(strategy.name).toBe('StatelessStrategy')
    })

    it('should return strategy based on promptClass.strategy', () => {
      const tool = new BaseStrategyTool({})
      const mockPromptClass = { strategy: 'hybrid' }

      const strategy = tool.getStrategy(mockPromptClass)

      expect(strategy.name).toBe('HybridStrategy')
    })

    it('should return stateful strategy when specified', () => {
      const tool = new BaseStrategyTool({})
      const mockPromptClass = { strategy: 'stateful' }

      const strategy = tool.getStrategy(mockPromptClass)

      expect(strategy.name).toBe('StatefulStrategy')
    })
  })

  describe('getPromptClassByModel', () => {
    it('should throw when promptRegistry is not available', () => {
      const tool = new BaseStrategyTool({})

      expect(() => tool.getPromptClassByModel('rule')).toThrow('Prompt registry not available')
    })

    it('should throw when getPromptClassByModel method is not available', () => {
      const tool = new BaseStrategyTool({ promptRegistry: {} })

      expect(() => tool.getPromptClassByModel('rule')).toThrow('Prompt registry not available')
    })

    it('should return prompt class from registry', () => {
      const mockPromptClass = { strategy: 'stateful' }
      const mockPromptRegistry = {
        getPromptClassByModel: (model) => (model === 'rule' ? mockPromptClass : null)
      }

      const tool = new BaseStrategyTool({ promptRegistry: mockPromptRegistry })
      const result = tool.getPromptClassByModel('rule')

      expect(result).toBe(mockPromptClass)
    })

    it('should return null for unknown model', () => {
      const mockPromptRegistry = {
        getPromptClassByModel: () => null
      }

      const tool = new BaseStrategyTool({ promptRegistry: mockPromptRegistry })
      const result = tool.getPromptClassByModel('unknown')

      expect(result).toBeNull()
    })
  })

  describe('getPromptNameByModel', () => {
    it('should return null when promptRegistry is not available', () => {
      const tool = new BaseStrategyTool({})
      expect(tool.getPromptNameByModel('rule')).toBeNull()
    })

    it('should return null when getPromptNameByModel method is not available', () => {
      const tool = new BaseStrategyTool({ promptRegistry: {} })
      expect(tool.getPromptNameByModel('rule')).toBeNull()
    })

    it('should return prompt name from registry', () => {
      const mockPromptRegistry = {
        getPromptNameByModel: (model) => `create_${model}`
      }

      const tool = new BaseStrategyTool({ promptRegistry: mockPromptRegistry })
      expect(tool.getPromptNameByModel('rule')).toBe('create_rule')
    })
  })

  describe('checkOperation', () => {
    it('should return supported true when operation is supported', () => {
      const tool = new BaseStrategyTool({})
      const mockStrategy = {
        supportsOperation: (op) => op === 'validateFields'
      }

      const result = tool.checkOperation(mockStrategy, 'validateFields', 'rule')

      expect(result.supported).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return supported false with error when operation not supported', () => {
      const tool = new BaseStrategyTool({})
      const mockStrategy = {
        name: 'stateless',
        supportsOperation: () => false,
        getSupportedOperations: () => ['getDocumentation']
      }

      const result = tool.checkOperation(mockStrategy, 'validateFields', 'rule')

      expect(result.supported).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error.error).toContain('stateless')
      expect(result.error.error).toContain('validateFields')
      expect(result.error.strategy).toBe('stateless')
      expect(result.error.supported_operations).toEqual(['getDocumentation'])
    })

    it('should include hint for validateFields operation', () => {
      const tool = new BaseStrategyTool({})
      const mockStrategy = {
        name: 'stateless',
        supportsOperation: () => false,
        getSupportedOperations: () => []
      }

      const result = tool.checkOperation(mockStrategy, 'validateFields', 'rule')

      expect(result.error.hint).toContain('Submit directly')
    })

    it('should include hint for validateSection operation', () => {
      const tool = new BaseStrategyTool({})
      const mockStrategy = {
        name: 'hybrid',
        supportsOperation: () => false,
        getSupportedOperations: () => []
      }

      const result = tool.checkOperation(mockStrategy, 'validateSection', 'rule')

      expect(result.error.hint).toContain('without section parameter')
    })

    it('should include hint for getProgress operation', () => {
      const tool = new BaseStrategyTool({})
      const mockStrategy = {
        name: 'hybrid',
        supportsOperation: () => false,
        getSupportedOperations: () => []
      }

      const result = tool.checkOperation(mockStrategy, 'getProgress', 'rule')

      expect(result.error.hint).toContain('stateful models')
    })

    it('should include hint for generateSummary operation', () => {
      const tool = new BaseStrategyTool({})
      const mockStrategy = {
        name: 'stateless',
        supportsOperation: () => false,
        getSupportedOperations: () => []
      }

      const result = tool.checkOperation(mockStrategy, 'generateSummary', 'rule')

      expect(result.error.hint).toContain('Generate the summary')
    })

    it('should include default hint for unknown operation', () => {
      const tool = new BaseStrategyTool({})
      const mockStrategy = {
        name: 'stateless',
        supportsOperation: () => false,
        getSupportedOperations: () => []
      }

      const result = tool.checkOperation(mockStrategy, 'unknownOperation', 'rule')

      expect(result.error.hint).toContain('Check supported operations')
    })
  })

  describe('formatUnknownModelError', () => {
    it('should return error with hint to check list_models', () => {
      const tool = new BaseStrategyTool({})
      const result = tool.formatUnknownModelError('unknown_model')

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toContain('Unknown model')
      expect(parsed.error).toContain('unknown_model')
      expect(parsed.hint).toContain('list_models')
    })

    it('should include prompt name hint when available', () => {
      const mockPromptRegistry = {
        getPromptNameByModel: () => 'create_rule'
      }

      const tool = new BaseStrategyTool({ promptRegistry: mockPromptRegistry })
      const result = tool.formatUnknownModelError('rule')

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.hint).toContain('create_rule')
      expect(parsed.hint).toContain('get_prompt_guide')
    })
  })

  describe('formatOperationError', () => {
    it('should format error info as JSON', () => {
      const tool = new BaseStrategyTool({})
      const errorInfo = {
        error: 'Operation not supported',
        hint: 'Try another approach',
        strategy: 'stateless'
      }

      const result = tool.formatOperationError(errorInfo)

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Operation not supported')
      expect(parsed.hint).toBe('Try another approach')
      expect(parsed.strategy).toBe('stateless')
    })
  })
})
