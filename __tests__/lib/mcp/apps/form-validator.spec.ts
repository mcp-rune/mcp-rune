import { describe, expect, it } from 'vitest'

import { validateFormClass } from '../../../../src/mcp/apps/lib/form-validator.js'

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
    expect(issues[0]!.message).toContain('not in FormClass.fields')
  })
})
