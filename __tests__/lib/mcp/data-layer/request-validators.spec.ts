import {
  checkFiltersAgainstAttributes,
  checkFilterValuesAgainstEnums,
  checkLinkAgainstAssociations,
  normalizeFiltersAgainstAttributes
} from '../../../../src/mcp/data-layer/request-validators.js'
import { MOCK_MODELS } from '../../../__fixtures__/models-config-mock.js'

describe('lib/mcp/data-layer/request-validators', () => {
  describe('checkFiltersAgainstAttributes', () => {
    it('should return valid for empty search params', () => {
      const result = checkFiltersAgainstAttributes('title', {}, MOCK_MODELS)
      expect(result.valid).toBe(true)
    })

    it('should return valid for null search params', () => {
      const result = checkFiltersAgainstAttributes('title', undefined, MOCK_MODELS)
      expect(result.valid).toBe(true)
    })

    it('should return valid for valid filter fields', () => {
      const result = checkFiltersAgainstAttributes(
        'title',
        { external_id: 'test-123' },
        MOCK_MODELS
      )
      expect(result.valid).toBe(true)
    })

    it('should return invalid for non-existent filter fields', () => {
      const result = checkFiltersAgainstAttributes('title', { invalid_field: 'value' }, MOCK_MODELS)
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.error).toContain('invalid_field')
      expect(result.error).toContain('Unknown filter')
    })

    it('should include suggestion with available filters', () => {
      const result = checkFiltersAgainstAttributes('title', { bad_field: 'test' }, MOCK_MODELS)
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.suggestion).toContain('external_id')
    })

    it('should handle model with no filters', () => {
      const result = checkFiltersAgainstAttributes('scheduling', { anything: 'value' }, MOCK_MODELS)
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.error).toContain('does not support search filters')
    })

    it('should normalize and return filters on success', () => {
      const result = checkFiltersAgainstAttributes(
        'title',
        { title_type: 'feature,episode' },
        MOCK_MODELS
      )
      expect(result.valid).toBe(true)
      if (!result.valid) return
      expect(result.filters).toEqual({ title_type: ['feature', 'episode'] })
    })

    it('should validate enum filter values', () => {
      const result = checkFiltersAgainstAttributes(
        'title',
        { title_type: 'invalid_type' },
        MOCK_MODELS
      )
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.error).toContain('Invalid value')
      expect(result.error).toContain('title_type')
    })
  })

  describe('checkLinkAgainstAssociations', () => {
    it('should validate hasMany associations', () => {
      const result = checkLinkAgainstAssociations('title', 'images', MOCK_MODELS)
      expect(result.valid).toBe(true)
      if (!result.valid) return
      expect(result.type).toBe('hasMany')
      expect((result.linkInfo as { target_model?: string }).target_model).toBe('image')
    })

    it('should validate custom associations', () => {
      const result = checkLinkAgainstAssociations('title', 'schedule', MOCK_MODELS)
      expect(result.valid).toBe(true)
      if (!result.valid) return
      expect(result.type).toBe('custom')
    })

    it('should validate belongsTo associations', () => {
      const result = checkLinkAgainstAssociations('title', 'licensor', MOCK_MODELS)
      expect(result.valid).toBe(true)
      if (!result.valid) return
      expect(result.type).toBe('belongsTo')
    })

    it('should return invalid for unknown nested resources', () => {
      const result = checkLinkAgainstAssociations('title', 'nonexistent', MOCK_MODELS)
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.error).toContain('nonexistent')
      expect(result.availableLinks).toContain('images')
    })

    it('should handle models without associations', () => {
      const result = checkLinkAgainstAssociations('scheduling', 'anything', MOCK_MODELS)
      expect(result.valid).toBe(true)
      if (!result.valid) return
      expect(result.warning).toContain('No link metadata')
    })

    it('should provide available links in suggestions', () => {
      const result = checkLinkAgainstAssociations('title', 'nonexistent', MOCK_MODELS)
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.suggestion).toContain('images')
      expect(result.suggestion).toContain('schedule')
    })
  })

  describe('checkFilterValuesAgainstEnums', () => {
    const filterableAttributes = {
      rights_status: {
        type: 'enum',
        label: 'Rights Status',
        enumValues: ['cleared', 'conflicting', 'denied', 'no_rights']
      },
      metadata_status: {
        type: 'enum',
        label: 'Metadata Status',
        enumValues: ['valid', 'invalid', 'calculating', 'not_configured']
      },
      workflow_status: {
        type: 'enum',
        label: 'Workflow Status',
        enumValues: ['not_configured', 'no_workflow', 'pending', 'in_progress', 'completed']
      },
      platform_id: {
        type: 'relation',
        label: 'Platform',
        relatedModel: 'platform'
      },
      asset_name: {
        type: 'text',
        label: 'Asset Name'
      },
      date: {
        type: 'date_range',
        label: 'Date'
      }
    }

    it('should return null for valid single enum value', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { rights_status: 'cleared' },
        filterableAttributes
      )
      expect(result).toBeNull()
    })

    it('should return null for valid array of enum values', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { rights_status: ['no_rights', 'conflicting', 'denied'] },
        filterableAttributes
      )
      expect(result).toBeNull()
    })

    it('should reject invalid single enum value', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { rights_status: 'invalid' },
        filterableAttributes
      )
      expect(result).not.toBeNull()
      expect(result).toContain('Invalid value(s)')
      expect(result).toContain('"invalid"')
      expect(result).toContain('`cleared`')
      expect(result).toContain('`conflicting`')
      expect(result).toContain('`denied`')
      expect(result).toContain('`no_rights`')
    })

    it('should reject invalid value in array', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { rights_status: ['cleared', 'banana'] },
        filterableAttributes
      )
      expect(result).not.toBeNull()
      expect(result).toContain('"banana"')
      expect(result).toContain('`cleared`')
    })

    it('should include "did you mean?" hint when value matches another filter', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { rights_status: 'invalid' },
        filterableAttributes
      )
      expect(result).toContain('Hint:')
      expect(result).toContain('"invalid" is a valid value for filter "metadata_status"')
      expect(result).toContain('Did you mean metadata_status: "invalid"?')
    })

    it('should not include "did you mean?" when value matches no other filter', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { rights_status: 'banana' },
        filterableAttributes
      )
      expect(result).not.toBeNull()
      expect(result).not.toContain('Hint:')
      expect(result).not.toContain('Did you mean')
    })

    it('should skip validation for non-enum filters', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { platform_id: 'any-value', asset_name: 'anything', date: { from: '2024-01-01' } },
        filterableAttributes
      )
      expect(result).toBeNull()
    })

    it('should validate multiple enum filters independently', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { rights_status: 'banana', workflow_status: 'invalid_status' },
        filterableAttributes
      )
      expect(result).not.toBeNull()
      expect(result).toContain('"banana"')
      expect(result).toContain('"invalid_status"')
    })

    it('should pass when mixing valid enum with non-enum filters', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { rights_status: 'cleared', platform_id: 5, asset_name: 'trailer' },
        filterableAttributes
      )
      expect(result).toBeNull()
    })

    it('should include get_filters_guide call hint in error message', () => {
      const result = checkFilterValuesAgainstEnums(
        'scheduling',
        { rights_status: 'invalid' },
        filterableAttributes
      )
      expect(result).toContain('get_filters_guide("scheduling")')
    })

    it('should return null for empty filters', () => {
      const result = checkFilterValuesAgainstEnums('scheduling', {}, filterableAttributes)
      expect(result).toBeNull()
    })

    it('should skip enum filters without enumValues declared', () => {
      const attrsNoValues = {
        status: { type: 'enum', label: 'Status' }
      }
      const result = checkFilterValuesAgainstEnums('model', { status: 'anything' }, attrsNoValues)
      expect(result).toBeNull()
    })
  })

  describe('normalizeFiltersAgainstAttributes', () => {
    const filterableAttributes = {
      rights_status: {
        type: 'enum',
        label: 'Rights Status',
        enumValues: ['cleared', 'conflicting', 'denied', 'no_rights']
      },
      metadata_status: {
        type: 'enum',
        label: 'Metadata Status',
        enumValues: ['valid', 'invalid', 'calculating', 'not_configured']
      },
      platform_id: {
        type: 'relation',
        label: 'Platform',
        relatedModel: 'platform'
      },
      asset_name: {
        type: 'text',
        label: 'Asset Name'
      },
      date: {
        type: 'date_range',
        label: 'Date'
      }
    }

    it('should split comma-separated enum string into array', () => {
      const filters = { rights_status: 'no_rights,conflicting,denied' }
      const result = normalizeFiltersAgainstAttributes(filters, filterableAttributes)
      expect(result!.rights_status).toEqual(['no_rights', 'conflicting', 'denied'])
    })

    it('should handle spaces around commas', () => {
      const filters = { rights_status: 'no_rights, conflicting, denied' }
      const result = normalizeFiltersAgainstAttributes(filters, filterableAttributes)
      expect(result!.rights_status).toEqual(['no_rights', 'conflicting', 'denied'])
    })

    it('should not split single valid enum value', () => {
      const filters = { rights_status: 'cleared' }
      const result = normalizeFiltersAgainstAttributes(filters, filterableAttributes)
      expect(result!.rights_status).toBe('cleared')
    })

    it('should not split when any segment is invalid', () => {
      const filters = { rights_status: 'cleared,banana' }
      const result = normalizeFiltersAgainstAttributes(filters, filterableAttributes)
      expect(result!.rights_status).toBe('cleared,banana')
    })

    it('should leave arrays unchanged', () => {
      const filters = { rights_status: ['no_rights', 'conflicting'] }
      const result = normalizeFiltersAgainstAttributes(filters, filterableAttributes)
      expect(result!.rights_status).toEqual(['no_rights', 'conflicting'])
    })

    it('should not split non-enum filter values', () => {
      const filters = { asset_name: 'trailer,promo' }
      const result = normalizeFiltersAgainstAttributes(filters, filterableAttributes)
      expect(result!.asset_name).toBe('trailer,promo')
    })

    it('should not split relation filter values', () => {
      const filters = { platform_id: '1,2,3' }
      const result = normalizeFiltersAgainstAttributes(filters, filterableAttributes)
      expect(result!.platform_id).toBe('1,2,3')
    })

    it('should handle multiple filters with mixed types', () => {
      const filters = {
        rights_status: 'no_rights,conflicting',
        metadata_status: 'valid',
        platform_id: '5',
        date: { from: '2024-01-01' }
      }
      const result = normalizeFiltersAgainstAttributes(filters, filterableAttributes)
      expect(result!.rights_status).toEqual(['no_rights', 'conflicting'])
      expect(result!.metadata_status).toBe('valid')
      expect(result!.platform_id).toBe('5')
      expect(result!.date).toEqual({ from: '2024-01-01' })
    })

    it('should return filters unchanged when attribute map is undefined', () => {
      const filters = { rights_status: 'no_rights,conflicting' }
      const result = normalizeFiltersAgainstAttributes(filters, undefined)
      expect(result).toBe(filters)
    })

    it('should return undefined when filters is undefined', () => {
      const result = normalizeFiltersAgainstAttributes(undefined, filterableAttributes)
      expect(result).toBeUndefined()
    })

    it('should handle empty filters', () => {
      const result = normalizeFiltersAgainstAttributes({}, filterableAttributes)
      expect(result).toEqual({})
    })

    it('should skip enum filters without enumValues declared', () => {
      const attrsNoValues = {
        status: { type: 'enum', label: 'Status' }
      }
      const result = normalizeFiltersAgainstAttributes({ status: 'a,b,c' }, attrsNoValues)
      expect(result!.status).toBe('a,b,c')
    })

    it('should not split when result would be single element', () => {
      const filters = { rights_status: 'cleared,' }
      const result = normalizeFiltersAgainstAttributes(filters, filterableAttributes)
      expect(result!.rights_status).toBe('cleared,')
    })
  })
})
