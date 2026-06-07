import { describe, expect, it } from 'vitest'

import { validateAppForm as validateFormClass } from '../../../../src/mcp/apps/lib/app-form-validator.js'

const BookModel = {
  modelName: 'book',
  api: { endpoint: 'books' },
  attributes: {
    title: { type: 'string' as const, required: true },
    status: { type: 'enum' as const, enumValues: ['a', 'b'] }
  },
  associations: {
    belongsTo: { location: { rel: 'location', target_model: 'location' } },
    hasMany: { tags: { rel: 'tags', target_model: 'tag' } }
  }
}

describe('form-validator: validateFormClass', () => {
  it('passes a form that lists only valid attributes and associations', () => {
    const issues = validateFormClass(
      'book',
      { fields: ['title', 'status', 'location_id', 'tag_ids'] },
      BookModel
    )
    expect(issues).toEqual([])
  })

  it('errors on an unknown attribute and suggests the closest match', () => {
    const issues = validateFormClass('book', { fields: ['titel'] }, BookModel)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.hint).toContain('did you mean "title"')
  })

  it('errors when a fieldset references a field not in fields', () => {
    const issues = validateFormClass(
      'book',
      { fields: ['title'], fieldsets: { details: { fields: ['title', 'status'] } } },
      BookModel
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('not in AppFormClass.fields')
  })

  it('errors when fields is missing', () => {
    const issues = validateFormClass('book', {}, BookModel)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('has no fields')
  })

  it('errors when fields is empty', () => {
    const issues = validateFormClass('book', { fields: [] }, BookModel)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('has no fields')
  })

  it('errors when every listed field is prompt_visible: false', () => {
    const Model = {
      modelName: 'book',
      api: { endpoint: 'books' },
      attributes: {
        id: { type: 'string' as const, prompt_visible: false },
        created_at: { type: 'datetime' as const, prompt_visible: false }
      },
      associations: {}
    }
    const issues = validateFormClass('book', { fields: ['id', 'created_at'] }, Model)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('no renderable fields')
  })
})
