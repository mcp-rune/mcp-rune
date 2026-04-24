import { SaveModelBaseTool } from '../../../../src/mcp/tools/save-model-base-tool.js'

describe('lib/mcp/tools/save-model-base-tool', () => {
  describe('getUsageRules', () => {
    it('should return empty array when no promptRegistry', () => {
      const tool = new SaveModelBaseTool()
      expect(tool.getUsageRules()).toEqual([])
    })

    it('should return empty array when promptRegistry has no relevant methods', () => {
      const tool = new SaveModelBaseTool({ promptRegistry: {} })
      expect(tool.getUsageRules()).toEqual([])
    })

    it('should include required prompt restrictions when present', () => {
      const promptRegistry = {
        getRequiredPromptRestrictions: () => '- deal: required\n- contract: required'
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      const rules = tool.getUsageRules()

      expect(rules).toHaveLength(1)
      expect(rules[0]).toContain('IMPORTANT')
      expect(rules[0]).toContain('call get_prompt_guide FIRST')
      expect(rules[0]).toContain('- deal: required')
    })

    it('should skip restrictions when getRequiredPromptRestrictions returns empty', () => {
      const promptRegistry = {
        getRequiredPromptRestrictions: () => ''
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      expect(tool.getUsageRules()).toEqual([])
    })

    it('should skip restrictions when getRequiredPromptRestrictions returns null', () => {
      const promptRegistry = {
        getRequiredPromptRestrictions: () => null
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      expect(tool.getUsageRules()).toEqual([])
    })

    it('should include bulk recommendations when present', () => {
      const promptRegistry = {
        getBulkRecommendations: () => '- activity: use bulk workflow'
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      const rules = tool.getUsageRules()

      expect(rules).toHaveLength(1)
      expect(rules[0]).toContain('RECOMMENDED')
      expect(rules[0]).toContain('bulk/nested creation')
      expect(rules[0]).toContain('- activity: use bulk workflow')
    })

    it('should skip bulk recommendations when getBulkRecommendations returns empty', () => {
      const promptRegistry = {
        getBulkRecommendations: () => ''
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      expect(tool.getUsageRules()).toEqual([])
    })

    it('should skip bulk recommendations when getBulkRecommendations returns null', () => {
      const promptRegistry = {
        getBulkRecommendations: () => null
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      expect(tool.getUsageRules()).toEqual([])
    })

    it('should include both restrictions and recommendations when both present', () => {
      const promptRegistry = {
        getRequiredPromptRestrictions: () => '- deal: required',
        getBulkRecommendations: () => '- activity: bulk workflow'
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      const rules = tool.getUsageRules()

      expect(rules).toHaveLength(2)
      expect(rules[0]).toContain('IMPORTANT')
      expect(rules[1]).toContain('RECOMMENDED')
    })
  })

  describe('requiresGuidedCreation', () => {
    it('should return false when no promptRegistry', () => {
      const tool = new SaveModelBaseTool()
      expect(tool.requiresGuidedCreation('deal')).toBe(false)
    })

    it('should return false when promptRegistry lacks getPromptRequiredModels', () => {
      const tool = new SaveModelBaseTool({ promptRegistry: {} })
      expect(tool.requiresGuidedCreation('deal')).toBe(false)
    })

    it('should return true when model is in required models list', () => {
      const promptRegistry = {
        getPromptRequiredModels: () => ['deal', 'contract']
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      expect(tool.requiresGuidedCreation('deal')).toBe(true)
    })

    it('should return false when model is not in required models list', () => {
      const promptRegistry = {
        getPromptRequiredModels: () => ['deal', 'contract']
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      expect(tool.requiresGuidedCreation('book')).toBe(false)
    })

    it('should return false when required models list is empty', () => {
      const promptRegistry = {
        getPromptRequiredModels: () => []
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      expect(tool.requiresGuidedCreation('deal')).toBe(false)
    })
  })

  describe('getRequiredPromptName', () => {
    it('should return null when no promptRegistry', () => {
      const tool = new SaveModelBaseTool()
      expect(tool.getRequiredPromptName('deal')).toBeNull()
    })

    it('should return null when promptRegistry lacks getPromptNameByModel', () => {
      const tool = new SaveModelBaseTool({ promptRegistry: {} })
      expect(tool.getRequiredPromptName('deal')).toBeNull()
    })

    it('should return prompt name when model has one', () => {
      const promptRegistry = {
        getPromptNameByModel: (model) => (model === 'deal' ? 'create_deal' : null)
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      expect(tool.getRequiredPromptName('deal')).toBe('create_deal')
    })

    it('should return null when model has no prompt name', () => {
      const promptRegistry = {
        getPromptNameByModel: () => null
      }
      const tool = new SaveModelBaseTool({ promptRegistry })
      expect(tool.getRequiredPromptName('book')).toBeNull()
    })
  })

  describe('inheritance', () => {
    it('should extend BaseTool', () => {
      const tool = new SaveModelBaseTool()
      expect(tool).toBeInstanceOf(SaveModelBaseTool)
      expect(tool.getModelNames).toBeDefined()
      expect(tool.formatResponse).toBeDefined()
    })

    it('should accept standard BaseTool dependencies', () => {
      const apiClient = { get: () => {} }
      const logger = { info: () => {} }
      const models = { book: { api: { endpoint: 'books' } } }
      const tool = new SaveModelBaseTool({ apiClient, logger, models })

      expect(tool.apiClient).toBe(apiClient)
      expect(tool.logger).toBe(logger)
      expect(tool.models).toBe(models)
    })
  })
})
