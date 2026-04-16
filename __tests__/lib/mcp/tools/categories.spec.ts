import {
  TOOL_CATEGORIES,
  CATEGORY_CONFIG,
  getCategoryConfig,
  categoryRequiresAuth
} from '../../../../src/mcp/tools/categories.js'

describe('lib/mcp/tools/categories', () => {
  describe('TOOL_CATEGORIES', () => {
    it('should define all expected category values', () => {
      expect(TOOL_CATEGORIES.DATA).toBe('data')
      expect(TOOL_CATEGORIES.STRATEGY).toBe('strategy')
      expect(TOOL_CATEGORIES.AUTOCOMPLETE).toBe('autocomplete')
      expect(TOOL_CATEGORIES.ANALYSIS).toBe('analysis')
      expect(TOOL_CATEGORIES.OPERATIONS).toBe('operations')
      expect(TOOL_CATEGORIES.DOMAIN).toBe('domain')
      expect(TOOL_CATEGORIES.CUSTOM).toBe('custom')
    })

    it('should provide deprecated CRUD alias pointing to data', () => {
      expect(TOOL_CATEGORIES.CRUD).toBe('data')
    })

    it('should have exactly 8 category keys (7 + deprecated CRUD alias)', () => {
      expect(Object.keys(TOOL_CATEGORIES)).toHaveLength(8)
    })
  })

  describe('CATEGORY_CONFIG', () => {
    it('should have a config entry for every category', () => {
      for (const category of Object.values(TOOL_CATEGORIES)) {
        expect(CATEGORY_CONFIG[category]).toBeDefined()
        expect(CATEGORY_CONFIG[category]).toHaveProperty('requiresAuth')
        expect(CATEGORY_CONFIG[category]).toHaveProperty('description')
      }
    })

    it('should mark DATA as requiring auth', () => {
      expect(CATEGORY_CONFIG.data.requiresAuth).toBe(true)
      expect(CATEGORY_CONFIG.data.isGeneric).toBe(true)
    })

    it('should mark STRATEGY as not requiring auth', () => {
      expect(CATEGORY_CONFIG.strategy.requiresAuth).toBe(false)
      expect(CATEGORY_CONFIG.strategy.requiresPromptRegistry).toBe(true)
      expect(CATEGORY_CONFIG.strategy.isGeneric).toBe(true)
    })

    it('should mark AUTOCOMPLETE as requiring auth', () => {
      expect(CATEGORY_CONFIG.autocomplete.requiresAuth).toBe(true)
      expect(CATEGORY_CONFIG.autocomplete.isGeneric).toBe(false)
    })

    it('should mark ANALYSIS as not requiring auth', () => {
      expect(CATEGORY_CONFIG.analysis.requiresAuth).toBe(false)
      expect(CATEGORY_CONFIG.analysis.requiresVectorStorage).toBe(true)
    })

    it('should mark OPERATIONS as not requiring auth', () => {
      expect(CATEGORY_CONFIG.operations.requiresAuth).toBe(false)
      expect(CATEGORY_CONFIG.operations.requiresVectorStorage).toBe(true)
    })

    it('should mark DOMAIN as not requiring auth', () => {
      expect(CATEGORY_CONFIG.domain.requiresAuth).toBe(false)
      expect(CATEGORY_CONFIG.domain.requiresDomainRegistry).toBe(true)
    })

    it('should mark CUSTOM as requiring auth by default', () => {
      expect(CATEGORY_CONFIG.custom.requiresAuth).toBe(true)
      expect(CATEGORY_CONFIG.custom.isGeneric).toBe(false)
    })
  })

  describe('getCategoryConfig', () => {
    it('should return correct config for each known category', () => {
      for (const category of Object.values(TOOL_CATEGORIES)) {
        const config = getCategoryConfig(category)
        expect(config).toBe(CATEGORY_CONFIG[category])
      }
    })

    it('should fall back to CUSTOM config for unknown category', () => {
      const config = getCategoryConfig('nonexistent')
      expect(config).toBe(CATEGORY_CONFIG[TOOL_CATEGORIES.CUSTOM])
    })

    it('should fall back to CUSTOM config for undefined', () => {
      const config = getCategoryConfig(undefined)
      expect(config).toBe(CATEGORY_CONFIG[TOOL_CATEGORIES.CUSTOM])
    })
  })

  describe('categoryRequiresAuth', () => {
    it('should return true for DATA', () => {
      expect(categoryRequiresAuth(TOOL_CATEGORIES.DATA)).toBe(true)
    })

    it('should return true for AUTOCOMPLETE', () => {
      expect(categoryRequiresAuth(TOOL_CATEGORIES.AUTOCOMPLETE)).toBe(true)
    })

    it('should return true for CUSTOM', () => {
      expect(categoryRequiresAuth(TOOL_CATEGORIES.CUSTOM)).toBe(true)
    })

    it('should return false for STRATEGY', () => {
      expect(categoryRequiresAuth(TOOL_CATEGORIES.STRATEGY)).toBe(false)
    })

    it('should return false for ANALYSIS', () => {
      expect(categoryRequiresAuth(TOOL_CATEGORIES.ANALYSIS)).toBe(false)
    })

    it('should return false for OPERATIONS', () => {
      expect(categoryRequiresAuth(TOOL_CATEGORIES.OPERATIONS)).toBe(false)
    })

    it('should return false for DOMAIN', () => {
      expect(categoryRequiresAuth(TOOL_CATEGORIES.DOMAIN)).toBe(false)
    })

    it('should fall back to CUSTOM (true) for unknown category', () => {
      expect(categoryRequiresAuth('unknown_category')).toBe(true)
    })

    it('should fall back to CUSTOM (true) for null', () => {
      expect(categoryRequiresAuth(null)).toBe(true)
    })
  })
})
