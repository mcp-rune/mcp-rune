/**
 * API Convention Adapter Tests
 */

import { jsonApiConvention } from '../../../../src/mcp/prompts/api-conventions.js'

describe('lib/mcp/prompts/api-conventions', () => {
  const relConfig = {
    rel: 'licensor',
    target_model: 'licensor'
  }

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
