import { describe, expect, it } from 'vitest'

import { validatePromptClass } from '../../../../src/mcp/prompt-layer/prompt-validator.js'

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

describe('prompt-validator: validatePromptClass', () => {
  it('passes a prompt that names only real attributes and groups', () => {
    const issues = validatePromptClass(
      'book',
      {
        fieldGroups: { identity: { fields: ['title'] } },
        sections: { main: { groups: ['identity'] } }
      },
      BookModel
    )
    expect(issues).toEqual([])
  })

  it('errors on an unknown attribute in fieldGroups', () => {
    const issues = validatePromptClass(
      'book',
      { fieldGroups: { identity: { fields: ['titel'] } } },
      BookModel
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]!.hint).toContain('did you mean "title"')
  })

  it('errors on an unknown fieldGroup in sections.groups', () => {
    const issues = validatePromptClass(
      'book',
      {
        fieldGroups: { identity: { fields: ['title'] } },
        sections: { main: { groups: ['idntiy'] } }
      },
      BookModel
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]!.hint).toContain('did you mean "identity"')
  })
})
