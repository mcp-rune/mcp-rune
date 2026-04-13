/**
 * API Convention Adapter Tests
 */

import { halConvention, jsonApiConvention } from '../../../../src/mcp/prompts/api-conventions.js'

describe('lib/mcp/prompts/api-conventions', () => {
  const relConfig = {
    rel: 'licensor',
    target_model: 'licensor'
  }

  describe('halConvention', () => {
    it('should have name "hal"', () => {
      expect(halConvention.name).toBe('hal')
    })

    it('should produce _link and _id fields', () => {
      const fields = halConvention.resolveAssociationFields('licensor', relConfig)

      expect(Object.keys(fields)).toEqual(['licensor_link', 'licensor_id'])
    })

    it('should produce string types for both fields', () => {
      const fields = halConvention.resolveAssociationFields('licensor', relConfig)

      expect(fields.licensor_link.type).toBe('string')
      expect(fields.licensor_id.type).toBe('string')
    })

    it('should include URL example for _link field', () => {
      const fields = halConvention.resolveAssociationFields('licensor', relConfig)

      expect(fields.licensor_link.examples[0]).toContain('https://api.example.com/licensors/123')
    })

    it('should set autocomplete value_field to self_link for _link field', () => {
      const fields = halConvention.resolveAssociationFields('licensor', relConfig)

      expect(fields.licensor_link.completion.value_field).toBe('self_link')
      expect(fields.licensor_link.completion.search_fields).toEqual(['name', 'external_id'])
    })

    it('should set autocomplete value_field to id for _id field', () => {
      const fields = halConvention.resolveAssociationFields('licensor', relConfig)

      expect(fields.licensor_id.completion.value_field).toBe('id')
    })

    it('should skip autocomplete when autocomplete is false', () => {
      const noAutoConfig = { ...relConfig, autocomplete: false }
      const fields = halConvention.resolveAssociationFields('licensor', noAutoConfig)

      expect(fields.licensor_link.completion).toBeUndefined()
      expect(fields.licensor_id.completion).toBeUndefined()
    })

    it('should apply per-field overrides', () => {
      const overrides = {
        licensor_link: { required: true, description: 'Custom link desc' }
      }
      const fields = halConvention.resolveAssociationFields('licensor', relConfig, overrides)

      expect(fields.licensor_link.required).toBe(true)
      expect(fields.licensor_link.description).toBe('Custom link desc')
      // _id field should not be affected
      expect(fields.licensor_id.required).toBe(false)
    })

    it('should apply completion overrides', () => {
      const overrides = {
        licensor_link: {
          completion: { display_template: '{name} custom' }
        }
      }
      const fields = halConvention.resolveAssociationFields('licensor', relConfig, overrides)

      expect(fields.licensor_link.completion.display_template).toBe('{name} custom')
      // Other completion fields should still be present
      expect(fields.licensor_link.completion.provider).toBe('relation')
    })

    it('should set correct field names from relation name', () => {
      const fields = halConvention.resolveAssociationFields('brand', {
        rel: 'brand',
        target_model: 'brand'
      })

      expect(fields.brand_link).toBeDefined()
      expect(fields.brand_link.name).toBe('brand_link')
      expect(fields.brand_id).toBeDefined()
      expect(fields.brand_id.name).toBe('brand_id')
    })
  })

  describe('halConvention.buildRequestPayload', () => {
    it('should return flat attrs without wrapping', () => {
      const result = halConvention.buildRequestPayload('scheduling', { take_down: '2027-03-30' })
      expect(result).toEqual({ take_down: '2027-03-30' })
    })

    it('should ignore the model parameter', () => {
      const attrs = { name: 'Test' }
      expect(halConvention.buildRequestPayload('brand', attrs)).toEqual(attrs)
      expect(halConvention.buildRequestPayload('title', attrs)).toEqual(attrs)
    })
  })

  describe('halConvention.normalizeListResponse', () => {
    it('should extract records from _embedded', () => {
      const response = {
        _embedded: {
          platforms: [
            { id: 1, name: 'Netflix' },
            { id: 2, name: 'HBO' }
          ]
        },
        total_count: 42
      }
      const result = halConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.records).toEqual([
        { id: 1, name: 'Netflix' },
        { id: 2, name: 'HBO' }
      ])
      expect(result.pagination.total).toBe(42)
    })

    it('should extract records from model-keyed top-level array', () => {
      const response = {
        schedulings: [{ id: 1 }, { id: 2 }],
        total_count: 50,
        total_pages: 5
      }
      const result = halConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.records).toEqual([{ id: 1 }, { id: 2 }])
      expect(result.pagination.total).toBe(50)
      expect(result.pagination.total_pages).toBe(5)
    })

    it('should handle plain array response', () => {
      const response = [{ id: 1 }, { id: 2 }]
      const result = halConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.records).toEqual([{ id: 1 }, { id: 2 }])
    })

    it('should handle empty _embedded', () => {
      const response = {
        _embedded: { platforms: [] },
        total_count: 0
      }
      const result = halConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.records).toEqual([])
      expect(result.pagination.total).toBe(0)
    })

    it('should ignore _links when looking for model-keyed arrays', () => {
      const response = {
        _links: ['self', 'next'],
        items: [{ id: 1 }],
        total_count: 1
      }
      const result = halConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.records).toEqual([{ id: 1 }])
    })

    it('should use total_entries as fallback for total', () => {
      const response = {
        _embedded: { brands: [{ id: 1 }] },
        total_entries: 99
      }
      const result = halConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.pagination.total).toBe(99)
    })

    it('should fall back to records.length when no total fields present', () => {
      const response = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const result = halConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.pagination.total).toBe(3)
    })
  })

  describe('jsonApiConvention', () => {
    it('should have name "json-api"', () => {
      expect(jsonApiConvention.name).toBe('json-api')
    })

    it('should produce only _id field', () => {
      const fields = jsonApiConvention.resolveAssociationFields('licensor', relConfig)

      expect(Object.keys(fields)).toEqual(['licensor_id'])
      expect(fields.licensor_link).toBeUndefined()
    })

    it('should produce integer type for _id field', () => {
      const fields = jsonApiConvention.resolveAssociationFields('licensor', relConfig)

      expect(fields.licensor_id.type).toBe('integer')
    })

    it('should include integer examples', () => {
      const fields = jsonApiConvention.resolveAssociationFields('licensor', relConfig)

      expect(fields.licensor_id.examples).toEqual([1, 2, 3])
    })

    it('should set autocomplete with narrower search_fields', () => {
      const fields = jsonApiConvention.resolveAssociationFields('licensor', relConfig)

      expect(fields.licensor_id.completion.value_field).toBe('id')
      expect(fields.licensor_id.completion.search_fields).toEqual(['name'])
    })

    it('should skip autocomplete when autocomplete is false', () => {
      const noAutoConfig = { ...relConfig, autocomplete: false }
      const fields = jsonApiConvention.resolveAssociationFields('licensor', noAutoConfig)

      expect(fields.licensor_id.completion).toBeUndefined()
    })

    it('should apply per-field overrides', () => {
      const overrides = {
        licensor_id: { required: true, description: 'Custom id desc' }
      }
      const fields = jsonApiConvention.resolveAssociationFields('licensor', relConfig, overrides)

      expect(fields.licensor_id.required).toBe(true)
      expect(fields.licensor_id.description).toBe('Custom id desc')
    })

    it('should apply completion overrides', () => {
      const overrides = {
        licensor_id: {
          completion: { search_fields: ['name', 'code'] }
        }
      }
      const fields = jsonApiConvention.resolveAssociationFields('licensor', relConfig, overrides)

      expect(fields.licensor_id.completion.search_fields).toEqual(['name', 'code'])
      expect(fields.licensor_id.completion.provider).toBe('relation')
    })

    it('should not produce _link fields for any relation', () => {
      const fields = jsonApiConvention.resolveAssociationFields('brand', {
        rel: 'brand',
        target_model: 'brand'
      })

      expect(fields.brand_link).toBeUndefined()
      expect(fields.brand_id).toBeDefined()
      expect(fields.brand_id.name).toBe('brand_id')
    })
  })

  describe('jsonApiConvention.buildRequestPayload', () => {
    it('should wrap attrs under the model key', () => {
      const result = jsonApiConvention.buildRequestPayload('scheduling', {
        take_down: '2027-03-30'
      })
      expect(result).toEqual({ scheduling: { take_down: '2027-03-30' } })
    })

    it('should handle empty attributes', () => {
      const result = jsonApiConvention.buildRequestPayload('brand', {})
      expect(result).toEqual({ brand: {} })
    })
  })

  describe('jsonApiConvention.normalizeListResponse', () => {
    it('should extract records from data key', () => {
      const response = {
        data: [{ id: 1, name: 'Test' }],
        meta: { page: 1, per_page: 20, total: 1 }
      }
      const result = jsonApiConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.records).toEqual([{ id: 1, name: 'Test' }])
      expect(result.pagination).toEqual({ page: 1, per_page: 20, total: 1 })
    })

    it('should handle plain array response', () => {
      const response = [{ id: 1 }, { id: 2 }]
      const result = jsonApiConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.records).toEqual([{ id: 1 }, { id: 2 }])
      expect(result.pagination).toEqual({ page: 1, per_page: 20, total: 2 })
    })

    it('should use meta for pagination when available', () => {
      const response = {
        data: [{ id: 1 }],
        meta: { page: 3, per_page: 10, total: 100 }
      }
      const result = jsonApiConvention.normalizeListResponse(response, { page: 3, perPage: 10 })
      expect(result.pagination).toEqual({ page: 3, per_page: 10, total: 100 })
    })

    it('should fall back to records.length when no meta', () => {
      const response = { data: [{ id: 1 }, { id: 2 }] }
      const result = jsonApiConvention.normalizeListResponse(response, { page: 1, perPage: 20 })
      expect(result.pagination.total).toBe(2)
    })
  })
})
