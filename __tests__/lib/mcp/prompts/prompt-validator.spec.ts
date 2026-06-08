import { describe, expect, it } from 'vitest'

import type { PromptClassLike } from '../../../../src/mcp/prompts/prompt-definitions.js'
import { validatePromptClass } from '../../../../src/mcp/prompts/prompt-validator.js'

function prompt(overrides: Partial<PromptClassLike>): PromptClassLike {
  return {
    formStrategy: 'stateless',
    fieldDefinitions: {},
    fieldGroups: {},
    sections: {},
    ...overrides
  }
}

function section(groups: string[]) {
  return { title: '', description: '', required: false, groups }
}

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
      prompt({
        fieldGroups: { identity: { fields: ['title'] } },
        sections: { main: section(['identity']) }
      }),
      BookModel
    )
    expect(issues).toEqual([])
  })

  it('errors on an unknown attribute in fieldGroups', () => {
    const issues = validatePromptClass(
      'book',
      prompt({ fieldGroups: { identity: { fields: ['titel'] } } }),
      BookModel
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]!.hint).toContain('did you mean "title"')
  })

  it('errors on an unknown fieldGroup in sections.groups', () => {
    const issues = validatePromptClass(
      'book',
      prompt({
        fieldGroups: { identity: { fields: ['title'] } },
        sections: { main: section(['idntiy']) }
      }),
      BookModel
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]!.hint).toContain('did you mean "identity"')
  })
})
