import {
  buildFieldTransformerMap,
  getAutocompleteTransformers,
  getMultiSelectTransformers,
  getSelectTransformers
} from '../../../../src/mcp/prompts/association-transformers.js'

const transformers = {
  licensor: {
    type: 'select',
    source: { model: 'licensor' },
    targetField: 'licensor_id',
    valueField: 'id',
    labelField: 'name'
  },
  content_selection: {
    type: 'autocomplete',
    source: { group: 'catalogue' },
    targetFields: ['parent_type', 'parent_id'],
    transform: {
      parent_type: { from: 'entityType' },
      parent_id: { from: 'id' }
    }
  },
  platforms: {
    type: 'multi_select',
    source: { model: 'platform' },
    targetField: 'selected_platforms',
    valueField: 'self_link',
    labelField: 'name',
    postCreate: {
      model: 'specific_platform',
      parentPath: 'rules/{id}/specific_platforms',
      attributeMap: { platform_link: '$self_link' }
    }
  }
}

describe('lib/mcp/prompts/association-transformers', () => {
  describe('buildFieldTransformerMap', () => {
    it('maps targetField (single) to transformer config', () => {
      const map = buildFieldTransformerMap(transformers)
      const entry = map.get('licensor_id')
      expect(entry).toBeDefined()
      expect(entry.type).toBe('select')
      expect(entry.key).toBe('licensor')
      expect(entry.source.model).toBe('licensor')
    })

    it('maps targetFields (multiple) to transformer config', () => {
      const map = buildFieldTransformerMap(transformers)
      expect(map.get('parent_type')).toBeDefined()
      expect(map.get('parent_id')).toBeDefined()
      expect(map.get('parent_type').key).toBe('content_selection')
      expect(map.get('parent_id').key).toBe('content_selection')
    })

    it('includes key in each entry', () => {
      const map = buildFieldTransformerMap(transformers)
      expect(map.get('selected_platforms').key).toBe('platforms')
    })

    it('returns empty map for empty transformers', () => {
      const map = buildFieldTransformerMap({})
      expect(map.size).toBe(0)
    })
  })

  describe('getSelectTransformers', () => {
    it('returns only select type transformers', () => {
      const result = getSelectTransformers(transformers)
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('licensor')
      expect(result[0].type).toBe('select')
    })
  })

  describe('getAutocompleteTransformers', () => {
    it('returns only autocomplete type transformers', () => {
      const result = getAutocompleteTransformers(transformers)
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('content_selection')
      expect(result[0].type).toBe('autocomplete')
    })
  })

  describe('getMultiSelectTransformers', () => {
    it('returns only multi_select type transformers', () => {
      const result = getMultiSelectTransformers(transformers)
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('platforms')
      expect(result[0].type).toBe('multi_select')
    })

    it('preserves postCreate config', () => {
      const result = getMultiSelectTransformers(transformers)
      expect(result[0].postCreate).toEqual({
        model: 'specific_platform',
        parentPath: 'rules/{id}/specific_platforms',
        attributeMap: { platform_link: '$self_link' }
      })
    })
  })

  describe('type filters with no matches', () => {
    const selectOnly = {
      brand: { type: 'select', source: { model: 'brand' }, targetField: 'brand_link' }
    }

    it('getAutocompleteTransformers returns empty for select-only', () => {
      expect(getAutocompleteTransformers(selectOnly)).toHaveLength(0)
    })

    it('getMultiSelectTransformers returns empty for select-only', () => {
      expect(getMultiSelectTransformers(selectOnly)).toHaveLength(0)
    })
  })
})
