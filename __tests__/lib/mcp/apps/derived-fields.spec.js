import { describe, it, expect } from 'vitest'
import { resolveDerivedFields } from '../../../../src/mcp/apps/derived-fields.js'

describe('lib/mcp/apps/derived-fields', () => {
  function makeModel(attributes = {}) {
    return { attributes }
  }

  it('resolves derived fields from nested objects', () => {
    const Model = makeModel({
      theme_name: { derived: { from: 'theme', field: 'name' } },
      category_name: { derived: { from: 'category', field: 'name' } }
    })

    const records = [
      { id: 1, theme: { id: 10, name: 'Programming' }, category: { id: 20, name: 'Ruby' } },
      { id: 2, theme: { id: 11, name: 'Design' }, category: { id: 21, name: 'UX' } }
    ]

    resolveDerivedFields(records, Model)

    expect(records[0].theme_name).toBe('Programming')
    expect(records[0].category_name).toBe('Ruby')
    expect(records[1].theme_name).toBe('Design')
    expect(records[1].category_name).toBe('UX')
  })

  it('returns records unchanged when no derived attributes', () => {
    const Model = makeModel({
      title: { type: 'string' },
      status: { type: 'enum' }
    })

    const records = [{ id: 1, title: 'Test' }]
    const result = resolveDerivedFields(records, Model)

    expect(result).toBe(records)
    expect(records[0]).toEqual({ id: 1, title: 'Test' })
  })

  it('handles null associations gracefully', () => {
    const Model = makeModel({
      theme_name: { derived: { from: 'theme', field: 'name' } }
    })

    const records = [{ id: 1, theme: null }]
    resolveDerivedFields(records, Model)

    expect(records[0].theme_name).toBeNull()
  })

  it('handles missing associations gracefully', () => {
    const Model = makeModel({
      theme_name: { derived: { from: 'theme', field: 'name' } }
    })

    const records = [{ id: 1 }]
    resolveDerivedFields(records, Model)

    expect(records[0].theme_name).toBeNull()
  })

  it('handles missing field within association', () => {
    const Model = makeModel({
      theme_name: { derived: { from: 'theme', field: 'name' } }
    })

    const records = [{ id: 1, theme: { id: 10 } }]
    resolveDerivedFields(records, Model)

    expect(records[0].theme_name).toBeNull()
  })

  it('is a no-op for models without attributes', () => {
    const records = [{ id: 1 }]
    const result = resolveDerivedFields(records, {})

    expect(result).toBe(records)
  })

  it('returns the same records array for chaining', () => {
    const Model = makeModel({
      theme_name: { derived: { from: 'theme', field: 'name' } }
    })

    const records = [{ id: 1, theme: { name: 'Test' } }]
    const result = resolveDerivedFields(records, Model)

    expect(result).toBe(records)
  })
})
