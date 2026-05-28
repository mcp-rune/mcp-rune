/**
 * Schema Derivation Memoization Tests
 */

import {
  clearSchemaCaches,
  deriveFieldDefinitions,
  derivePromptSchema,
  enhanceModelConfig,
  getSchemaCacheStats
} from '../../../../src/mcp/prompts/schema-derivation.js'

describe('lib/mcp/prompts/schema-derivation - Memoization', () => {
  beforeEach(() => {
    // Clear caches before each test
    clearSchemaCaches()
  })

  describe('deriveFieldDefinitions', () => {
    it('should return cached result on subsequent calls with same inputs', () => {
      const modelConfig = {
        api: { endpoint: 'brands' },
        attributes: {
          id: { type: 'string', prompt_visible: false },
          name: {
            type: 'string',
            required: true,
            description: 'Brand name'
          }
        }
      }

      const options = { promptOnly: true }

      // First call - should compute
      const result1 = deriveFieldDefinitions(modelConfig, options)
      const statsAfterFirst = getSchemaCacheStats()
      expect(statsAfterFirst.fieldDefinitions).toBe(1)

      // Second call - should return cached
      const result2 = deriveFieldDefinitions(modelConfig, options)
      const statsAfterSecond = getSchemaCacheStats()
      expect(statsAfterSecond.fieldDefinitions).toBe(1) // No new cache entry

      // Results should be identical (same reference)
      expect(result2).toBe(result1)
    })

    it('should create separate cache entries for different options', () => {
      const modelConfig = {
        api: { endpoint: 'brands' },
        attributes: {
          id: { type: 'string', prompt_visible: false },
          name: { type: 'string', required: true }
        }
      }

      const result1 = deriveFieldDefinitions(modelConfig, { promptOnly: true })
      const result2 = deriveFieldDefinitions(modelConfig, { promptOnly: false })

      const stats = getSchemaCacheStats()
      expect(stats.fieldDefinitions).toBe(2)

      // Results should be different
      expect(result2).not.toBe(result1)
    })

    it('should create separate cache entries for different models', () => {
      const brandConfig = {
        api: { endpoint: 'brands' },
        attributes: { name: { type: 'string', required: true } }
      }

      const seriesConfig = {
        api: { endpoint: 'series' },
        attributes: {
          name: { type: 'string', required: true },
          season_number: { type: 'integer' }
        }
      }

      deriveFieldDefinitions(brandConfig)
      deriveFieldDefinitions(seriesConfig)

      const stats = getSchemaCacheStats()
      expect(stats.fieldDefinitions).toBe(2)
    })
  })

  describe('derivePromptSchema', () => {
    it('should return cached result on subsequent calls', () => {
      const modelConfig = {
        api: { endpoint: 'brands' },
        attributes: {
          id: { type: 'string', prompt_visible: false },
          name: {
            type: 'string',
            required: true,
            description: 'Brand name'
          }
        }
      }

      const options = {
        fieldGroups: {
          identity: {
            fields: ['name'],
            context: 'Identity',
            required: true
          }
        }
      }

      const result1 = derivePromptSchema(modelConfig, options)
      const statsAfterFirst = getSchemaCacheStats()
      expect(statsAfterFirst.schemas).toBe(1)

      const result2 = derivePromptSchema(modelConfig, options)
      const statsAfterSecond = getSchemaCacheStats()
      expect(statsAfterSecond.schemas).toBe(1)

      expect(result2).toBe(result1)
    })

    it('should leverage nested function caches', () => {
      const modelConfig = {
        api: { endpoint: 'brands' },
        attributes: { name: { type: 'string', required: true } }
      }

      // Call derivePromptSchema which internally calls deriveFieldDefinitions
      derivePromptSchema(modelConfig, {})

      const stats = getSchemaCacheStats()

      // Should have cache entries for both
      expect(stats.schemas).toBe(1)
      expect(stats.fieldDefinitions).toBe(1)
    })

    it('should handle multiple prompt classes using same model', () => {
      const modelConfig = {
        api: { endpoint: 'brands' },
        attributes: {
          name: { type: 'string', required: true },
          external_id: { type: 'string' }
        }
      }

      // Simulate two different prompt classes with different configurations
      const prompt1Options = {
        fieldGroups: { identity: { fields: ['name'] } },
        excludeFields: []
      }

      const prompt2Options = {
        fieldGroups: { basic: { fields: ['name', 'external_id'] } },
        excludeFields: []
      }

      const schema1 = derivePromptSchema(modelConfig, prompt1Options)
      derivePromptSchema(modelConfig, prompt2Options)

      // Should create separate cache entries
      const stats = getSchemaCacheStats()
      expect(stats.schemas).toBe(2)

      // But calling same config again should return cached
      const schema1Again = derivePromptSchema(modelConfig, prompt1Options)
      expect(schema1Again).toBe(schema1)

      const statsAfter = getSchemaCacheStats()
      expect(statsAfter.schemas).toBe(2) // No new entries
    })

    it('should pass through fieldGroups directly', () => {
      const modelConfig = {
        attributes: {
          name: { type: 'string', required: true },
          tags: { type: 'array' }
        }
      }

      const fieldGroups = {
        custom_group: {
          fields: ['tags'],
          context: 'Custom Group',
          required: false
        }
      }

      const schema = derivePromptSchema(modelConfig, { fieldGroups })

      // fieldGroups should be passed through exactly as provided
      expect(schema.fieldGroups).toBe(fieldGroups)
      expect(schema.fieldGroups.custom_group).toBeDefined()
      expect(schema.fieldGroups.custom_group.context).toBe('Custom Group')
    })

    it('should return empty fieldGroups when none provided', () => {
      const modelConfig = {
        attributes: { name: { type: 'string', required: true } }
      }

      const schema = derivePromptSchema(modelConfig, {})

      expect(schema.fieldGroups).toEqual({})
    })
  })

  describe('clearSchemaCaches', () => {
    it('should clear all caches and return statistics', () => {
      const modelConfig = {
        api: { endpoint: 'brands' },
        attributes: { name: { type: 'string', required: true } }
      }

      // Populate caches
      derivePromptSchema(modelConfig, {})

      const statsBefore = getSchemaCacheStats()
      expect(statsBefore.schemas).toBeGreaterThan(0)

      // Clear caches
      const clearedStats = clearSchemaCaches()
      expect(clearedStats.schemas).toBe(statsBefore.schemas)

      // Verify caches are empty
      const statsAfter = getSchemaCacheStats()
      expect(statsAfter.schemas).toBe(0)
      expect(statsAfter.fieldDefinitions).toBe(0)
    })
  })

  describe('enhanceModelConfig', () => {
    it('should merge prompt metadata into model attributes', () => {
      const modelConfig = {
        api: { endpoint: 'books' },
        attributes: {
          title: { type: 'string', description: 'Book title' }
        }
      }

      const result = enhanceModelConfig(modelConfig, {
        title: { examples: ['Clean Code'] },
        author: { type: 'string', description: 'Author name' }
      })

      expect(result.attributes.title.description).toBe('Book title')
      expect(result.attributes.title.examples).toEqual(['Clean Code'])
      expect(result.attributes.author.description).toBe('Author name')
      // Original should not be mutated
      expect(modelConfig.attributes.author).toBeUndefined()
    })

    it('should handle attributes not in original config', () => {
      const result = enhanceModelConfig({ attributes: {} }, { new_field: { type: 'integer' } })
      expect(result.attributes.new_field.type).toBe('integer')
    })
  })

  describe('deriveFieldDefinitions edge cases', () => {
    it('should throw when model has belongsTo associations without apiConvention', () => {
      const modelConfig = {
        attributes: { name: { type: 'string' } },
        associations: {
          belongsTo: { category: { model: 'Category' } }
        }
      }
      expect(() => deriveFieldDefinitions(modelConfig)).toThrow('apiConvention is required')
    })

    it('should add relation fields via apiConvention.resolveAssociationFields', () => {
      const modelConfig = {
        attributes: { name: { type: 'string' } },
        associations: {
          belongsTo: { category: { model: 'Category' } }
        }
      }
      const apiConvention = {
        name: 'hal',
        resolveAssociationFields: (_relName, _relConfig, _overrides) => ({
          category_id: {
            name: 'category_id',
            type: 'integer',
            required: false,
            description: 'Category ID'
          }
        })
      }

      const result = deriveFieldDefinitions(modelConfig, { apiConvention })
      expect(result.category_id).toBeDefined()
      expect(result.category_id.type).toBe('integer')
    })

    it('should not overwrite existing attributes with relation fields', () => {
      const modelConfig = {
        attributes: { category_id: { type: 'string', description: 'Custom' } },
        associations: {
          belongsTo: { category: { model: 'Category' } }
        }
      }
      const apiConvention = {
        name: 'hal',
        resolveAssociationFields: () => ({
          category_id: { name: 'category_id', type: 'integer', description: 'From relation' }
        })
      }

      const result = deriveFieldDefinitions(modelConfig, { apiConvention })
      expect(result.category_id.description).toBe('Custom')
    })

    it('should skip excluded relation fields', () => {
      const modelConfig = {
        attributes: {},
        associations: { belongsTo: { cat: {} } }
      }
      const apiConvention = {
        name: 'hal',
        resolveAssociationFields: () => ({
          cat_id: { name: 'cat_id', type: 'integer', description: 'Cat' }
        })
      }

      const result = deriveFieldDefinitions(modelConfig, { apiConvention, exclude: ['cat_id'] })
      expect(result.cat_id).toBeUndefined()
    })

    it('should handle include list', () => {
      const modelConfig = {
        attributes: {
          name: { type: 'string' },
          age: { type: 'integer' },
          email: { type: 'string' }
        }
      }
      const result = deriveFieldDefinitions(modelConfig, { include: ['name', 'email'] })
      expect(Object.keys(result)).toEqual(['name', 'email'])
    })

    it('should map unknown type to string', () => {
      const modelConfig = {
        attributes: { data: { type: 'custom_thing' } }
      }
      const result = deriveFieldDefinitions(modelConfig)
      expect(result.data.type).toBe('string')
    })

    it('should include format and completion config', () => {
      const modelConfig = {
        attributes: {
          date_field: { type: 'date', format: 'YYYY-MM-DD', completion: { endpoint: '/dates' } }
        }
      }
      const result = deriveFieldDefinitions(modelConfig)
      expect(result.date_field.format).toBe('YYYY-MM-DD')
      expect(result.date_field.completion.endpoint).toBe('/dates')
    })
  })

  describe('derivePromptSchema with promptFields', () => {
    it('should merge promptFields into derived fields', () => {
      const modelConfig = {
        attributes: { name: { type: 'string' } }
      }
      const result = derivePromptSchema(modelConfig, {
        promptFields: { extra: { type: 'boolean', description: 'Extra field' } }
      })
      expect(result.fieldDefinitions.name).toBeDefined()
      expect(result.fieldDefinitions.extra).toBeDefined()
      expect(result.fieldDefinitions.extra.type).toBe('boolean')
    })
  })

  describe('Cache key generation', () => {
    it('should differentiate between different field overrides', () => {
      const modelConfig = {
        api: { endpoint: 'brands' },
        attributes: { name: { type: 'string', required: true } }
      }

      const options1 = {
        fieldOverrides: { name: { required: true } }
      }

      const options2 = {
        fieldOverrides: { name: { required: false } }
      }

      derivePromptSchema(modelConfig, options1)
      derivePromptSchema(modelConfig, options2)

      const stats = getSchemaCacheStats()
      expect(stats.schemas).toBe(2)
    })

    it('should differentiate between different additional fields', () => {
      const modelConfig = {
        api: { endpoint: 'brands' },
        attributes: { name: { type: 'string', required: true } }
      }

      const options1 = {
        promptFields: { create_series: { type: 'boolean' } }
      }

      const options2 = {
        promptFields: { create_feature: { type: 'boolean' } }
      }

      derivePromptSchema(modelConfig, options1)
      derivePromptSchema(modelConfig, options2)

      const stats = getSchemaCacheStats()
      expect(stats.schemas).toBe(2)
    })
  })

  describe('attribute type → promptType (kind-metadata coverage)', () => {
    function promptTypeFor(attribute: Record<string, unknown>) {
      const modelConfig = { attributes: { value: attribute }, required: [] }
      return deriveFieldDefinitions(modelConfig).value.type
    }

    it('uuid attribute kind surfaces as uuid (was string before kind-metadata)', () => {
      expect(promptTypeFor({ type: 'uuid', description: '' })).toBe('uuid')
    })

    it('json attribute kind surfaces as object', () => {
      expect(promptTypeFor({ type: 'json', description: '' })).toBe('object')
    })

    it('decimal attribute kind surfaces as number', () => {
      expect(promptTypeFor({ type: 'decimal', description: '' })).toBe('number')
    })

    it('rating attribute kind surfaces as integer', () => {
      expect(promptTypeFor({ type: 'rating', description: '' })).toBe('integer')
    })

    it('unknown kind falls back to string', () => {
      expect(promptTypeFor({ type: 'wat', description: '' })).toBe('string')
    })
  })
})
