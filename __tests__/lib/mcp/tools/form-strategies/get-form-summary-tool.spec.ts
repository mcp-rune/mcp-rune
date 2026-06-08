import { BaseFormStrategyTool } from '../../../../../src/mcp/tools/form-strategies/base-form-strategy-tool.js'
import { GetFormSummaryTool } from '../../../../../src/mcp/tools/form-strategies/get-form-summary-tool.js'

describe('lib/mcp/tools/form-strategies/get-form-summary-tool', () => {
  describe('inheritance', () => {
    it('should extend BaseFormStrategyTool', () => {
      const tool = new GetFormSummaryTool({})
      expect(tool).toBeInstanceOf(BaseFormStrategyTool)
    })
  })

  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new GetFormSummaryTool({})
      expect(tool.name).toBe('get_form_summary')
    })

    it('should have base description about summaries', () => {
      const tool = new GetFormSummaryTool({})
      expect(tool.baseDescription).toContain('summary')
      expect(tool.baseDescription).toContain('human-readable')
      expect(tool.baseDescription).toContain('technical')
    })

    it('should have correct inputSchema', () => {
      const tool = new GetFormSummaryTool({})
      const schema = tool.inputSchema

      expect(schema.model).toBeDefined()
      expect(schema.fields).toBeDefined()
      expect(schema.model.isOptional()).toBe(false)
      expect(schema.fields.isOptional()).toBe(false)
    })
  })

  describe('execute', () => {
    it('should return error when fields is invalid', async () => {
      const mockPromptRegistry = {
        getPromptClassByModel: () => ({ formStrategy: 'hybrid' })
      }

      const tool = new GetFormSummaryTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        fields: 'invalid-json{'
      })

      expect(result.content[0].text).toContain('error')
      expect(result.content[0].text).toContain('valid object')
    })

    it('should return error for unknown model', async () => {
      const mockPromptRegistry = {
        getPromptClassByModel: () => null,
        getPromptNameByModel: () => null
      }

      const tool = new GetFormSummaryTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'unknown',
        fields: {}
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should return error when strategy does not support generateSummary', async () => {
      const mockPromptClass = { formStrategy: 'stateless' }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass,
        getPromptNameByModel: () => null
      }

      const tool = new GetFormSummaryTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'simple',
        fields: { name: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Stateless')
      expect(result.content[0].text).toContain("doesn't support")
    })

    it('should generate summary using hybrid strategy', async () => {
      const mockPromptClass = {
        formStrategy: 'hybrid',
        fieldDefinitions: {
          name: { type: 'string', description: 'Rule name' }
        },
        fieldGroups: {
          basic: { fields: ['name'] }
        }
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new GetFormSummaryTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        fields: { name: 'Test Rule' }
      })

      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.human).toBeDefined()
      expect(parsed.technical).toBeDefined()
    })

    it('should generate summary using stateful strategy', async () => {
      const mockPromptClass = {
        formStrategy: 'stateful',
        fieldDefinitions: {
          name: { type: 'string', description: 'Name' },
          status: { type: 'string', description: 'Status' }
        },
        fieldGroups: {
          basic: { fields: ['name'], required: true },
          settings: { fields: ['status'], required: false }
        },
        sections: {
          basic: { title: 'Basic', groups: ['basic'], required: true }
        }
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new GetFormSummaryTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        fields: { name: 'Test', status: 'active' }
      })

      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.human).toBeDefined()
    })

    it('should log summary generation when logger is available', async () => {
      const mockLogger = { info: vi.fn() }
      const mockPromptClass = {
        formStrategy: 'hybrid',
        fieldDefinitions: {},
        fieldGroups: {}
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new GetFormSummaryTool({
        promptRegistry: mockPromptRegistry,
        logger: mockLogger
      })

      await tool.execute({
        model: 'rule',
        fields: { name: 'Test' }
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'get_form_summary invoked',
        expect.objectContaining({
          tool: 'get_form_summary',
          model: 'rule'
        })
      )

      expect(mockLogger.info).toHaveBeenCalledWith(
        'get_form_summary result',
        expect.objectContaining({
          tool: 'get_form_summary',
          model: 'rule'
        })
      )
    })

    it('should handle JSON string fields', async () => {
      const mockPromptClass = {
        formStrategy: 'hybrid',
        fieldDefinitions: {
          name: { type: 'string' }
        },
        fieldGroups: {}
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new GetFormSummaryTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        fields: '{"name": "Test"}'
      })

      expect(result.isError).toBeFalsy()
    })

    it('should handle empty fields', async () => {
      const mockPromptClass = {
        formStrategy: 'hybrid',
        fieldDefinitions: {},
        fieldGroups: {}
      }
      const mockPromptRegistry = {
        getPromptClassByModel: () => mockPromptClass
      }

      const tool = new GetFormSummaryTool({ promptRegistry: mockPromptRegistry })
      const result = await tool.execute({
        model: 'rule',
        fields: {}
      })

      expect(result.isError).toBeFalsy()
    })
  })
})
