import { describe, expect, it } from 'vitest'

import { synthesizeDefaultFormClass } from '../../../../src/mcp/apps/lib/synthesize-form-class.js'

describe('synthesizeDefaultFormClass', () => {
  it('lists every attribute as a field in declaration order', () => {
    const ModelClass = {
      api: { endpoint: 'books' },
      singularName: 'book',
      attributes: {
        title: { type: 'string' as const, required: true },
        author: { type: 'string' as const },
        rating: { type: 'integer' as const }
      },
      associations: {}
    }
    expect(synthesizeDefaultFormClass(ModelClass)).toEqual({
      fields: ['title', 'author', 'rating']
    })
  })

  it('excludes attributes with prompt_visible: false', () => {
    const ModelClass = {
      api: { endpoint: 'books' },
      singularName: 'book',
      attributes: {
        id: { type: 'string' as const, prompt_visible: false },
        title: { type: 'string' as const, required: true },
        created_at: { type: 'datetime' as const, prompt_visible: false },
        author: { type: 'string' as const }
      },
      associations: {}
    }
    expect(synthesizeDefaultFormClass(ModelClass).fields).toEqual(['title', 'author'])
  })

  it('returns an empty fields array when every attribute is hidden', () => {
    const ModelClass = {
      api: { endpoint: 'audit_logs' },
      singularName: 'audit_log',
      attributes: {
        id: { type: 'string' as const, prompt_visible: false },
        recorded_at: { type: 'datetime' as const, prompt_visible: false }
      },
      associations: {}
    }
    expect(synthesizeDefaultFormClass(ModelClass)).toEqual({ fields: [] })
  })

  it('returns an empty fields array when the model has no attributes', () => {
    const ModelClass = {
      api: { endpoint: 'empties' },
      singularName: 'empty',
      attributes: {},
      associations: {}
    }
    expect(synthesizeDefaultFormClass(ModelClass)).toEqual({ fields: [] })
  })
})
