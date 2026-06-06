import {
  validateEnum,
  validateModel,
  validatePositiveInt,
  validateRequired,
  validateUrl
} from '../../../../src/mcp/model-layer/validators.js'

describe('lib/mcp/model-layer/validators', () => {
  describe('validateRequired', () => {
    it('should return valid when all required fields are present', () => {
      const result = validateRequired({ name: 'John', age: 30 }, ['name', 'age'])
      expect(result.valid).toBe(true)
      expect(result.missing).toEqual([])
    })

    it('should return invalid with missing fields', () => {
      const result = validateRequired({ name: 'John' }, ['name', 'age', 'email'])
      expect(result.valid).toBe(false)
      expect(result.missing).toEqual(['age', 'email'])
    })

    it('should treat undefined as missing', () => {
      const result = validateRequired({ name: undefined }, ['name'])
      expect(result.valid).toBe(false)
      expect(result.missing).toEqual(['name'])
    })

    it('should treat null as missing', () => {
      const result = validateRequired({ name: null }, ['name'])
      expect(result.valid).toBe(false)
      expect(result.missing).toEqual(['name'])
    })

    it('should treat empty string as missing', () => {
      const result = validateRequired({ name: '' }, ['name'])
      expect(result.valid).toBe(false)
      expect(result.missing).toEqual(['name'])
    })

    it('should accept zero as valid', () => {
      const result = validateRequired({ count: 0 }, ['count'])
      expect(result.valid).toBe(true)
    })

    it('should accept false as valid', () => {
      const result = validateRequired({ active: false }, ['active'])
      expect(result.valid).toBe(true)
    })

    it('should handle empty required array', () => {
      const result = validateRequired({ anything: 'value' }, [])
      expect(result.valid).toBe(true)
    })
  })

  describe('validateEnum', () => {
    it('should return true for valid enum value', () => {
      expect(validateEnum('active', ['active', 'inactive', 'pending'])).toBe(true)
    })

    it('should return false for invalid enum value', () => {
      expect(validateEnum('unknown', ['active', 'inactive', 'pending'])).toBe(false)
    })

    it('should be case-sensitive', () => {
      expect(validateEnum('ACTIVE', ['active', 'inactive'])).toBe(false)
    })

    it('should handle empty allowed array', () => {
      expect(validateEnum('anything', [])).toBe(false)
    })
  })

  describe('validatePositiveInt', () => {
    it('should return true for positive integers', () => {
      expect(validatePositiveInt(1)).toBe(true)
      expect(validatePositiveInt(100)).toBe(true)
      expect(validatePositiveInt(999999)).toBe(true)
    })

    it('should return true for string positive integers', () => {
      expect(validatePositiveInt('1')).toBe(true)
      expect(validatePositiveInt('100')).toBe(true)
    })

    it('should return false for zero', () => {
      expect(validatePositiveInt(0)).toBe(false)
      expect(validatePositiveInt('0')).toBe(false)
    })

    it('should return false for negative numbers', () => {
      expect(validatePositiveInt(-1)).toBe(false)
      expect(validatePositiveInt('-5')).toBe(false)
    })

    it('should return false for non-numeric strings', () => {
      expect(validatePositiveInt('abc')).toBe(false)
      expect(validatePositiveInt('')).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(validatePositiveInt(null)).toBe(false)
      expect(validatePositiveInt(undefined)).toBe(false)
    })

    it('should handle floats by truncating', () => {
      expect(validatePositiveInt(1.9)).toBe(true)
      expect(validatePositiveInt(0.9)).toBe(false) // parseInt gives 0
    })
  })

  describe('validateUrl', () => {
    it('should return true for valid HTTP URLs', () => {
      expect(validateUrl('http://example.com')).toBe(true)
      expect(validateUrl('https://example.com')).toBe(true)
    })

    it('should return true for URLs with paths', () => {
      expect(validateUrl('https://example.com/path/to/resource')).toBe(true)
    })

    it('should return true for URLs with query strings', () => {
      expect(validateUrl('https://example.com?foo=bar')).toBe(true)
    })

    it('should return true for URLs with ports', () => {
      expect(validateUrl('http://localhost:3000')).toBe(true)
    })

    it('should return false for invalid URLs', () => {
      expect(validateUrl('not-a-url')).toBe(false)
      expect(validateUrl('example.com')).toBe(false) // missing protocol
    })

    it('should return false for empty string', () => {
      expect(validateUrl('')).toBe(false)
    })
  })

  describe('validateModel', () => {
    const modelsConfig = {
      study_session: { api: { endpoint: 'study_sessions' } },
      book: { api: { endpoint: 'books' } },
      theme: { api: { endpoint: 'themes' } }
    }

    it('should return valid for known model', () => {
      const result = validateModel('study_session', modelsConfig)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return invalid for unknown model', () => {
      const result = validateModel('unknown_model', modelsConfig)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Unknown model')
      expect(result.error).toContain('study_session')
    })

    it('should return invalid for empty model name', () => {
      const result = validateModel('', modelsConfig)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Model name is required')
    })

    it('should return invalid for null model name', () => {
      const result = validateModel(null, modelsConfig)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Model name is required')
    })

    it('should return invalid for undefined model name', () => {
      const result = validateModel(undefined, modelsConfig)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Model name is required')
    })
  })
})
