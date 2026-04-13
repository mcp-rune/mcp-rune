import {
  TOOL_CATEGORIES,
  CATEGORY_CONFIG,
  getCategoryConfig,
  categoryRequiresAuth
} from '../../../../src/mcp/tools/categories.js'

describe('lib/mcp/tools/categories', () => {
  describe('TOOL_CATEGORIES', () => {
    it('should define all expected category values', () => {
      expect(TOOL_CATEGORIES.CRUD).toBe('crud')
      expect(TOOL_CATEGORIES.STRATEGY).toBe('strategy')
      expect(TOOL_CATEGORIES.AUTOCOMPLETE).toBe('autocomplete')
      expect(TOOL_CATEGORIES.MEMORY).toBe('memory')
      expect(TOOL_CATEGORIES.DOMAIN).toBe('domain')
      expect(TOOL_CATEGORIES.CUSTOM).toBe('custom')
    })

    it('should have exactly 6 categories', () => {
      expect(Object.keys(TOOL_CATEGORIES)).toHaveLength(6)
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

    it('should mark CRUD as requiring auth', () => {
      expect(CATEGORY_CONFIG.crud.requiresAuth).toBe(true)
      expect(CATEGORY_CONFIG.crud.isGeneric).toBe(true)
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

    it('should mark MEMORY as not requiring auth', () => {
      expect(CATEGORY_CONFIG.memory.requiresAuth).toBe(false)
      expect(CATEGORY_CONFIG.memory.requiresMemoryStorage).toBe(true)
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
    it('should return true for CRUD', () => {
      expect(categoryRequiresAuth(TOOL_CATEGORIES.CRUD)).toBe(true)
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

    it('should return false for MEMORY', () => {
      expect(categoryRequiresAuth(TOOL_CATEGORIES.MEMORY)).toBe(false)
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
