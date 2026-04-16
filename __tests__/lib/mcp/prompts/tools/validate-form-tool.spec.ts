import { BaseStrategyTool } from '../../../../../src/mcp/prompts/tools/base-strategy-tool.js'
import { ValidateFormTool } from '../../../../../src/mcp/prompts/tools/validate-form-tool.js'

describe('lib/mcp/prompts/tools/validate-form-tool', () => {
  describe('inheritance', () => {
    it('should extend BaseStrategyTool', () => {
      const tool = new ValidateFormTool({})
      expect(tool).toBeInstanceOf(BaseStrategyTool)
    })
  })

  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new ValidateFormTool({})
      expect(tool.name).toBe('validate_form')
    })

    it('should have base description about validation', () => {
      const tool = new ValidateFormTool({})
      expect(tool.baseDescription).toContain('Validate form fields')
      expect(tool.baseDescription).toContain('Stateless')
      expect(tool.baseDescription).toContain('Hybrid')
      expect(tool.baseDescription).toContain('Stateful')
    })

    it('should have correct inputSchema', () => {
      const tool = new ValidateFormTool({})
      const schema = tool.inputSchema

      expect(schema.model).toBeDefined()
      expect(schema.fields).toBeDefined()
      expect(schema.section).toBeDefined()
      expect(schema.model.isOptional()).toBe(false)
      expect(schema.fields.isOptional()).toBe(false)
      expect(schema.section.isOptional()).toBe(true)
    })
  })

  describe('execute', () => {
    it('should return error when fields is invalid', async () => {
      const mockPromptRegistry = {
        getPromptClassByModel: () => ({ strategy: 'hybrid' })
      }

      const tool = new ValidateFormTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        fields: 'not-an-object-or-json'
      })

      expect(result.content[0].text).toContain('"valid": false')
      expect(result.content[0].text).toContain('fields must be a valid object')
    })

    it('should return error for unknown model', async () => {
      const mockPromptRegistry = {
        getPromptClassByModel: () => null,
        getPromptNameByModel: () => null
      }

      const tool = new ValidateFormTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'unknown',
        fields: {}
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should return error when strategy does not support validateFields', async () => {
      const mockPromptClass = { strategy: 'stateless' }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass,
        getPromptNameByModel: () => null
      }

      const tool = new ValidateFormTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'simple',
        fields: { name: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Stateless')
      expect(result.content[0].text).toContain("doesn't support")
    })

    it('should validate fields using hybrid strategy', async () => {
      const mockPromptClass = {
        strategy: 'hybrid',
        fieldDefinitions: {
          name: { type: 'string', required: true }
        },
        fieldGroups: {}
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new ValidateFormTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        fields: { name: 'Test Rule' }
      })

      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.valid).toBeDefined()
    })

    it('should validate section when specified for stateful models', async () => {
      const mockPromptClass = {
        strategy: 'stateful',
        fieldDefinitions: {
          name: { type: 'string', required: true }
        },
        fieldGroups: {
          basic: { fields: ['name'], required: true }
        },
        sections: {
          basic: { title: 'Basic', groups: ['basic'], required: true }
        }
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new ValidateFormTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        section: 'basic',
        fields: { name: 'Test' }
      })

      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.valid).toBeDefined()
    })

    it('should log validation when logger is available', async () => {
      const mockLogger = { info: vi.fn() }
      const mockPromptClass = {
        strategy: 'hybrid',
        fieldDefinitions: {},
        fieldGroups: {}
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new ValidateFormTool({
        promptRegistry: mockPromptRegistry,
        logger: mockLogger
      })

      await tool.execute({
        model: 'rule',
        fields: { name: 'Test' }
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'validate_form invoked',
        expect.objectContaining({
          tool: 'validate_form',
          model: 'rule'
        })
      )
    })

    it('should handle JSON string fields', async () => {
      const mockPromptClass = {
        strategy: 'hybrid',
        fieldDefinitions: {
          name: { type: 'string' }
        },
        fieldGroups: {}
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new ValidateFormTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        fields: '{"name": "Test"}'
      })

      expect(result.isError).toBeFalsy()
    })

    it('should handle empty fields', async () => {
      const mockPromptClass = {
        strategy: 'hybrid',
        fieldDefinitions: {},
        fieldGroups: {}
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new ValidateFormTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        fields: {}
      })

      expect(result.isError).toBeFalsy()
    })
  })
})
