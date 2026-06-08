import { BaseTool } from '../../../../../src/mcp/tools/base-tool.js'
import { BaseFormStrategyTool } from '../../../../../src/mcp/tools/form-strategies/base-form-strategy-tool.js'

describe('lib/mcp/tools/form-strategies/base-form-strategy-tool', () => {
  describe('inheritance', () => {
    it('should extend BaseTool', () => {
      const tool = new BaseFormStrategyTool({})
      expect(tool).toBeInstanceOf(BaseTool)
    })
  })

  describe('capability flags', () => {
    it('does not require auth (strategy tools are public)', () => {
      expect(BaseFormStrategyTool.requiresAuth).toBe(false)
    })

    it('declares a prompt-registry requirement', () => {
      expect(BaseFormStrategyTool.requiresPromptRegistry).toBe(true)
    })
  })

  describe('getFormStrategy', () => {
    it('should return stateless form-strategy by default', () => {
      const tool = new BaseFormStrategyTool({})
      const mockPromptClass = {}

      const strategy = tool.getFormStrategy(mockPromptClass)

      expect(strategy).toBeDefined()
      expect(strategy.name).toBe('StatelessFormStrategy')
    })

    it('should return form-strategy based on promptClass.formStrategy', () => {
      const tool = new BaseFormStrategyTool({})
      const mockPromptClass = { formStrategy: 'hybrid' }

      const strategy = tool.getFormStrategy(mockPromptClass)

      expect(strategy.name).toBe('HybridFormStrategy')
    })

    it('should return stateful form-strategy when specified', () => {
      const tool = new BaseFormStrategyTool({})
      const mockPromptClass = { formStrategy: 'stateful' }

      const strategy = tool.getFormStrategy(mockPromptClass)

      expect(strategy.name).toBe('StatefulFormStrategy')
    })
  })

  describe('getPromptClassByModel', () => {
    it('should throw when promptRegistry is not available', () => {
      const tool = new BaseFormStrategyTool({})

      expect(() => tool.getPromptClassByModel('rule')).toThrow('Prompt registry not available')
    })

    it('should throw when getPromptClassByModel method is not available', () => {
      const tool = new BaseFormStrategyTool({ promptRegistry: {} })

      expect(() => tool.getPromptClassByModel('rule')).toThrow('Prompt registry not available')
    })

    it('should return prompt class from registry', () => {
      const mockPromptClass = { formStrategy: 'stateful' }
      const mockPromptRegistry = {
        getPromptClassByModel: (model) => (model === 'rule' ? mockPromptClass : null)
      }

      const tool = new BaseFormStrategyTool({ promptRegistry: mockPromptRegistry })
      const result = tool.getPromptClassByModel('rule')

      expect(result).toBe(mockPromptClass)
    })

    it('should return null for unknown model', () => {
      const mockPromptRegistry = {
        getPromptClassByModel: () => null
      }

      const tool = new BaseFormStrategyTool({ promptRegistry: mockPromptRegistry })
      const result = tool.getPromptClassByModel('unknown')

      expect(result).toBeNull()
    })
  })

  describe('getPromptNameByModel', () => {
    it('should return null when promptRegistry is not available', () => {
      const tool = new BaseFormStrategyTool({})
      expect(tool.getPromptNameByModel('rule')).toBeNull()
    })

    it('should return null when getPromptNameByModel method is not available', () => {
      const tool = new BaseFormStrategyTool({ promptRegistry: {} })
      expect(tool.getPromptNameByModel('rule')).toBeNull()
    })

    it('should return prompt name from registry', () => {
      const mockPromptRegistry = {
        getPromptNameByModel: (model) => `create_${model}`
      }

      const tool = new BaseFormStrategyTool({ promptRegistry: mockPromptRegistry })
      expect(tool.getPromptNameByModel('rule')).toBe('create_rule')
    })
  })

  describe('checkOperation', () => {
    it('should return supported true when operation is supported', () => {
      const tool = new BaseFormStrategyTool({})
      const mockStrategy = {
        supportsOperation: (op) => op === 'validateFields'
      }

      const result = tool.checkOperation(mockStrategy, 'validateFields', 'rule')

      expect(result.supported).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return supported false with error when operation not supported', () => {
      const tool = new BaseFormStrategyTool({})
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
      expect(result.error.formStrategy).toBe('stateless')
      expect(result.error.supported_operations).toEqual(['getDocumentation'])
    })

    it('should include hint for validateFields operation', () => {
      const tool = new BaseFormStrategyTool({})
      const mockStrategy = {
        name: 'stateless',
        supportsOperation: () => false,
        getSupportedOperations: () => []
      }

      const result = tool.checkOperation(mockStrategy, 'validateFields', 'rule')

      expect(result.error.hint).toContain('Submit directly')
    })

    it('should include hint for validateSection operation', () => {
      const tool = new BaseFormStrategyTool({})
      const mockStrategy = {
        name: 'hybrid',
        supportsOperation: () => false,
        getSupportedOperations: () => []
      }

      const result = tool.checkOperation(mockStrategy, 'validateSection', 'rule')

      expect(result.error.hint).toContain('without section parameter')
    })

    it('should include hint for getProgress operation', () => {
      const tool = new BaseFormStrategyTool({})
      const mockStrategy = {
        name: 'hybrid',
        supportsOperation: () => false,
        getSupportedOperations: () => []
      }

      const result = tool.checkOperation(mockStrategy, 'getProgress', 'rule')

      expect(result.error.hint).toContain('stateful models')
    })

    it('should include hint for generateSummary operation', () => {
      const tool = new BaseFormStrategyTool({})
      const mockStrategy = {
        name: 'stateless',
        supportsOperation: () => false,
        getSupportedOperations: () => []
      }

      const result = tool.checkOperation(mockStrategy, 'generateSummary', 'rule')

      expect(result.error.hint).toContain('Generate the summary')
    })

    it('should include default hint for unknown operation', () => {
      const tool = new BaseFormStrategyTool({})
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
      const tool = new BaseFormStrategyTool({})
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

      const tool = new BaseFormStrategyTool({ promptRegistry: mockPromptRegistry })
      const result = tool.formatUnknownModelError('rule')

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.hint).toContain('create_rule')
      expect(parsed.hint).toContain('get_prompt_guide')
    })
  })

  describe('formatOperationError', () => {
    it('should format error info as JSON', () => {
      const tool = new BaseFormStrategyTool({})
      const errorInfo = {
        error: 'Operation not supported',
        hint: 'Try another approach',
        formStrategy: 'stateless'
      }

      const result = tool.formatOperationError(errorInfo)

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Operation not supported')
      expect(parsed.hint).toBe('Try another approach')
      expect(parsed.formStrategy).toBe('stateless')
    })
  })
})
