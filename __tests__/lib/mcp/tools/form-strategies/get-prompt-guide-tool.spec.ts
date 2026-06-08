import { BaseFormStrategyTool } from '../../../../../src/mcp/tools/form-strategies/base-form-strategy-tool.js'
import { GetPromptGuideTool } from '../../../../../src/mcp/tools/form-strategies/get-prompt-guide-tool.js'

describe('lib/mcp/tools/form-strategies/get-prompt-guide-tool', () => {
  describe('inheritance', () => {
    it('should extend BaseFormStrategyTool', () => {
      const tool = new GetPromptGuideTool({})
      expect(tool).toBeInstanceOf(BaseFormStrategyTool)
    })
  })

  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new GetPromptGuideTool({})
      expect(tool.name).toBe('get_prompt_guide')
    })

    it('should have base description about guidance', () => {
      const tool = new GetPromptGuideTool({})
      expect(tool.baseDescription).toContain('step-by-step guidance')
    })

    it('should have correct inputSchema with guide names from registry', () => {
      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getAllPromptNames: () => ['create_book', 'create_category']
        }
      })
      const schema = tool.inputSchema

      expect(schema.guide_name).toBeDefined()
      expect(schema.mode).toBeDefined()
      expect(schema.parent_type).toBeDefined()
      expect(schema.parent_id).toBeDefined()
    })

    it('should handle missing promptRegistry for inputSchema', () => {
      const tool = new GetPromptGuideTool({})
      const schema = tool.inputSchema

      expect(schema.guide_name).toBeDefined()
    })
  })

  describe('getUsageRules', () => {
    it('should return usage rules array', () => {
      const tool = new GetPromptGuideTool({})
      const rules = tool.getUsageRules()

      expect(Array.isArray(rules)).toBe(true)
      expect(rules.length).toBeGreaterThan(0)
      expect(rules[0]).toContain('IMPORTANT')
    })

    it('should include available guides when registry has getToolDocDescriptionList', () => {
      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getToolDocDescriptionList: () => '- create_book: Book creation guide'
        }
      })
      const rules = tool.getUsageRules()

      expect(rules.some((r) => r.includes('create_book'))).toBe(true)
    })

    it('should not include guides list when registry lacks getToolDocDescriptionList', () => {
      const tool = new GetPromptGuideTool({
        promptRegistry: {}
      })
      const rules = tool.getUsageRules()

      expect(rules.some((r) => r.includes('Available guides'))).toBe(false)
    })
  })

  describe('execute', () => {
    it('should throw when promptRegistry is not available', async () => {
      const tool = new GetPromptGuideTool({})

      await expect(tool.execute({ guide_name: 'test' })).rejects.toThrow(
        'Prompt registry not available'
      )
    })

    it('should return error for unknown prompt using getPromptInstance', async () => {
      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getPromptInstance: () => null,
          getUnknownPromptError: (name) => `Guide "${name}" not found. Available: create_book`
        }
      })

      const result = await tool.execute({ guide_name: 'unknown_guide' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Guide "unknown_guide" not found')
    })

    it('should return error for unknown prompt using getPromptClass fallback', async () => {
      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getPromptClass: () => null
        }
      })

      const result = await tool.execute({ guide_name: 'unknown_guide' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown prompt: unknown_guide')
    })

    it('should return prompt content for valid guide via getPromptInstance', async () => {
      const mockPrompt = {
        promptContent: '# Book Creation Guide\n\nFollow these steps...',
        description: 'Guide for creating a book'
      }

      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getPromptInstance: (name) => (name === 'create_book' ? mockPrompt : null)
        }
      })

      const result = await tool.execute({ guide_name: 'create_book' })

      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain('# Guide for creating a book')
      expect(result.content[0].text).toContain('Book Creation Guide')
    })

    it('should return prompt content via getPromptClass fallback', async () => {
      class MockBookPrompt {
        constructor() {
          this.promptContent = '# Book Guide Content'
          this.description = 'Book creation guide'
        }
      }

      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getPromptClass: (name) => (name === 'create_book' ? MockBookPrompt : null)
        }
      })

      const result = await tool.execute({ guide_name: 'create_book' })

      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain('Book Guide Content')
    })

    it('should pass mode and parent args to prompt instance', async () => {
      let capturedArgs = null
      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getPromptInstance: (_name, args) => {
            capturedArgs = args
            return { promptContent: 'content', description: 'desc' }
          }
        }
      })

      await tool.execute({
        guide_name: 'create_book',
        mode: 'quick',
        parent_type: 'category',
        parent_id: '42'
      })

      expect(capturedArgs).toEqual({
        mode: 'quick',
        parent_type: 'category',
        parent_id: '42'
      })
    })

    it('should default mode to guided', async () => {
      let capturedArgs = null
      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getPromptInstance: (_name, args) => {
            capturedArgs = args
            return { promptContent: 'content', description: 'desc' }
          }
        }
      })

      await tool.execute({ guide_name: 'create_book' })

      expect(capturedArgs.mode).toBe('guided')
    })

    it('should log when logger is available', async () => {
      const mockLogger = { info: vi.fn() }
      const tool = new GetPromptGuideTool({
        logger: mockLogger,
        promptRegistry: {
          getPromptInstance: () => ({ promptContent: 'content', description: 'desc' })
        }
      })

      await tool.execute({ guide_name: 'create_book', mode: 'guided' })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'get_prompt_guide invoked',
        expect.objectContaining({
          tool: 'get_prompt_guide',
          guide_name: 'create_book',
          mode: 'guided'
        })
      )

      expect(mockLogger.info).toHaveBeenCalledWith(
        'get_prompt_guide returning prompt content',
        expect.objectContaining({
          tool: 'get_prompt_guide',
          guide_name: 'create_book'
        })
      )
    })

    it('should handle getUnknownPromptError not being a function', async () => {
      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getPromptInstance: () => null,
          getUnknownPromptError: 'not a function'
        }
      })

      const result = await tool.execute({ guide_name: 'unknown' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown prompt: unknown')
    })

    it('should handle getPromptInstance not being a function', async () => {
      const tool = new GetPromptGuideTool({
        promptRegistry: {
          getPromptInstance: 'not a function',
          getPromptClass: () => null
        }
      })

      const result = await tool.execute({ guide_name: 'test' })

      expect(result.isError).toBe(true)
    })
  })
})
