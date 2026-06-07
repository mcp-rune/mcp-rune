import { describe, expect, it } from 'vitest'

import { bindAppForm } from '../../../../src/mcp/apps/lib/bind-app-form.js'
import { flatConvention } from '../../../__fixtures__/flat-convention.js'

const ModelWithoutConvention = {
  api: { endpoint: 'books' },
  singularName: 'book',
  attributes: {
    id: { type: 'string' as const, prompt_visible: false },
    title: { type: 'string' as const, required: true },
    location_id: { type: 'integer' as const },
    tag_ids: { type: 'array' as const }
  },
  associations: {
    belongsTo: { location: { rel: 'location', target_model: 'location' } },
    hasMany: { tags: { rel: 'tags', target_model: 'tag' } }
  }
}

const ModelWithFlatConvention = {
  api: { endpoint: 'books', convention: flatConvention },
  singularName: 'book',
  attributes: {
    title: { type: 'string' as const, required: true },
    location_id: { type: 'string' as const },
    location_link: { type: 'string' as const }
  },
  associations: {
    belongsTo: { location: { rel: 'location', target_model: 'location' } }
  }
}

describe('bindAppForm', () => {
  describe('field binding', () => {
    it('lists each FormClass.field with its attribute', () => {
      const bound = bindAppForm({ fields: ['title', 'location_id'] }, ModelWithoutConvention)
      expect(bound.fields.map((f) => f.name)).toEqual(['title', 'location_id'])
      expect(bound.fields[0]?.attribute.required).toBe(true)
    })

    it('skips attributes that do not exist on the model', () => {
      const bound = bindAppForm({ fields: ['title', 'nonexistent'] }, ModelWithoutConvention)
      expect(bound.fields.map((f) => f.name)).toEqual(['title'])
    })

    it('skips attributes with prompt_visible: false', () => {
      const bound = bindAppForm({ fields: ['id', 'title'] }, ModelWithoutConvention)
      expect(bound.fields.map((f) => f.name)).toEqual(['title'])
    })

    it('preserves declaration order from FormClass.fields', () => {
      const bound = bindAppForm(
        { fields: ['tag_ids', 'title', 'location_id'] },
        ModelWithoutConvention
      )
      expect(bound.fields.map((f) => f.name)).toEqual(['tag_ids', 'title', 'location_id'])
    })
  })

  describe('field → association mapping (no convention)', () => {
    it('attaches the belongsTo association to a `<name>_id` field', () => {
      const bound = bindAppForm({ fields: ['location_id'] }, ModelWithoutConvention)
      expect(bound.fields[0]?.association).toEqual({
        name: 'location',
        targetModel: 'location',
        many: false
      })
    })

    it('attaches the hasMany association to a `<singular>_ids` field', () => {
      const bound = bindAppForm({ fields: ['tag_ids'] }, ModelWithoutConvention)
      expect(bound.fields[0]?.association).toEqual({
        name: 'tags',
        targetModel: 'tag',
        many: true
      })
    })

    it('leaves non-association fields without an association property', () => {
      const bound = bindAppForm({ fields: ['title'] }, ModelWithoutConvention)
      expect(bound.fields[0]?.association).toBeUndefined()
    })
  })

  describe('field → association mapping (with convention)', () => {
    it('maps every convention-produced field name to the association', () => {
      // flatConvention produces BOTH location_link and location_id for the
      // location belongsTo. Both should resolve to the same association.
      const linkBound = bindAppForm({ fields: ['location_link'] }, ModelWithFlatConvention)
      expect(linkBound.fields[0]?.association).toEqual({
        name: 'location',
        targetModel: 'location',
        many: false
      })

      const idBound = bindAppForm({ fields: ['location_id'] }, ModelWithFlatConvention)
      expect(idBound.fields[0]?.association).toEqual({
        name: 'location',
        targetModel: 'location',
        many: false
      })
    })
  })

  describe('form-level association merging', () => {
    it('merges each association entry with model belongsTo metadata', () => {
      const RequiredModel = {
        api: { endpoint: 'books' },
        singularName: 'book',
        attributes: {},
        associations: {
          belongsTo: {
            title: { rel: 'title', target_model: 'title', required: true },
            asset: { rel: 'asset', target_model: 'asset' }
          }
        }
      }
      const bound = bindAppForm({ fields: [], associations: ['title', 'asset'] }, RequiredModel)
      expect(bound.associations).toEqual([
        { association: 'title', required: true, targetModel: 'title' },
        { association: 'asset', required: false, targetModel: 'asset' }
      ])
    })

    it('marks hasMany associations with many: true', () => {
      const TagModel = {
        api: { endpoint: 'books' },
        singularName: 'book',
        attributes: {},
        associations: {
          hasMany: { tags: { rel: 'tags', target_model: 'tag' } }
        }
      }
      const bound = bindAppForm({ fields: [], associations: ['tags'] }, TagModel)
      expect(bound.associations[0]).toMatchObject({
        association: 'tags',
        targetModel: 'tag',
        many: true
      })
    })

    it('passes through dependsOn and picker', () => {
      const bound = bindAppForm(
        {
          fields: [],
          associations: [{ name: 'location', dependsOn: 'title', picker: 'autocomplete' }]
        },
        ModelWithoutConvention
      )
      expect(bound.associations[0]).toMatchObject({
        association: 'location',
        dependsOn: 'title',
        picker: 'autocomplete'
      })
    })

    it('skips entries whose targetModel cannot be inferred from model or entry', () => {
      const bound = bindAppForm(
        { fields: [], associations: [{ name: 'orphan' }] },
        ModelWithoutConvention
      )
      expect(bound.associations).toEqual([])
    })
  })

  it('passes through FormClass.fieldsets verbatim', () => {
    const bound = bindAppForm(
      {
        fields: ['title'],
        fieldsets: {
          identity: { title: 'Identity', fields: ['title'] }
        }
      },
      ModelWithoutConvention
    )
    expect(bound.fieldsets).toEqual({
      identity: { title: 'Identity', fields: ['title'] }
    })
  })

  it('exposes modelClass on the bound result for downstream consumers', () => {
    const bound = bindAppForm({ fields: ['title'] }, ModelWithoutConvention)
    expect(bound.modelClass).toBe(ModelWithoutConvention)
  })
})
