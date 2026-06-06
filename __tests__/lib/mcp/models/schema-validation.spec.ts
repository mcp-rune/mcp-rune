import { describe, expect, it } from 'vitest'

import { closestMatch, levenshtein } from '../../../../src/core/suggestions.js'
import { getKind, UnknownKindError } from '../../../../src/mcp/models/kind-metadata.js'
import {
  formatReport,
  SchemaValidationError,
  validateAssociation,
  validateAttributeDefinition,
  validateFormClass,
  validatePromptClass,
  validateRegistries
} from '../../../../src/mcp/models/schema-validation.js'

// ─── suggestions ───────────────────────────────────────────────────────────

describe('lib/core/suggestions', () => {
  describe('levenshtein', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshtein('datetime', 'datetime')).toBe(0)
    })

    it('is case-insensitive', () => {
      expect(levenshtein('DateTime', 'datetime')).toBe(0)
    })

    it('counts single substitution as 1', () => {
      expect(levenshtein('datetime', 'datetimx')).toBe(1)
    })

    it('counts insertion + substitution', () => {
      expect(levenshtein('datetimme', 'datetime')).toBe(1)
    })
  })

  describe('closestMatch', () => {
    it('finds the obvious typo', () => {
      const match = closestMatch('datetimme', ['datetime', 'date', 'time', 'integer'])
      expect(match).toBe('datetime')
    })

    it('returns null when nothing is within maxDistance', () => {
      expect(closestMatch('completely_unrelated', ['datetime', 'date'])).toBeNull()
    })

    it('respects custom maxDistance', () => {
      // edit distance from "data" → "date" is 1 (substitution); with
      // maxDistance=0 it should not match, with maxDistance=1 it should.
      expect(closestMatch('data', ['date'], 0)).toBeNull()
      expect(closestMatch('data', ['date'], 1)).toBe('date')
    })
  })
})

// ─── kind-metadata strict mode ─────────────────────────────────────────────

describe('lib/core/kind-metadata: strict mode', () => {
  it('throws UnknownKindError for an unregistered kind', () => {
    expect(() => getKind('datetimme')).toThrow(UnknownKindError)
  })

  it('throws when kind is undefined and no format resolves', () => {
    expect(() => getKind(undefined, 'completely-unknown-format')).toThrow(UnknownKindError)
  })

  it('still resolves valid kinds', () => {
    expect(getKind('datetime').htmlInputType).toBe('datetime-local')
  })

  it('still resolves valid kind:format narrowings', () => {
    expect(getKind('string', 'url').htmlInputType).toBe('url')
  })

  it('exposes the registered kinds in the error message', () => {
    try {
      getKind('bogus')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownKindError)
      expect((err as Error).message).toContain('datetime')
      expect((err as Error).message).toContain('Registered kinds')
    }
  })
})

// ─── validateAttributeDefinition ───────────────────────────────────────────

describe('lib/core/schema-validation: validateAttributeDefinition', () => {
  it('passes a well-formed string attribute', () => {
    const issues = validateAttributeDefinition('Book', 'title', { type: 'string' })
    expect(issues).toEqual([])
  })

  it('passes a well-formed enum with enumValues', () => {
    const issues = validateAttributeDefinition('Book', 'status', {
      type: 'enum',
      enumValues: ['a', 'b']
    })
    expect(issues).toEqual([])
  })

  it('rejects a missing type with a clear error', () => {
    // @ts-expect-error — intentionally invalid attribute
    const issues = validateAttributeDefinition('Book', 'title', {})
    expect(issues).toHaveLength(1)
    expect(issues[0]!.level).toBe('error')
    expect(issues[0]!.message).toContain('missing required field "type"')
  })

  it('rejects an unknown type and offers a "did you mean" hint', () => {
    // @ts-expect-error — typo
    const issues = validateAttributeDefinition('Activity', 'started_at', { type: 'datetimme' })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.level).toBe('error')
    expect(issues[0]!.message).toContain('unknown type "datetimme"')
    expect(issues[0]!.hint).toContain('did you mean "datetime"')
  })

  it('rejects enum without enumValues', () => {
    const issues = validateAttributeDefinition('Activity', 'status', { type: 'enum' })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('no enumValues')
  })

  it('rejects enum with empty enumValues', () => {
    const issues = validateAttributeDefinition('Activity', 'status', {
      type: 'enum',
      enumValues: []
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('no enumValues')
  })

  it('warns on an unresolvable format', () => {
    const issues = validateAttributeDefinition('Book', 'cover_url', {
      type: 'string',
      format: 'definitely-not-a-format'
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.level).toBe('warning')
  })

  it('does NOT warn on free-form prose formats (anything with a space or punctuation)', () => {
    // `format: "ISO 8601"` / `"Hex color (#RRGGBB)"` are descriptive
    // documentation, not type narrowings. Suppressing them keeps the
    // validator's signal sharp.
    expect(
      validateAttributeDefinition('Book', 'created_at', {
        type: 'datetime',
        format: 'ISO 8601'
      })
    ).toEqual([])
    expect(
      validateAttributeDefinition('Tag', 'color', {
        type: 'string',
        format: 'Hex color (#RRGGBB)'
      })
    ).toEqual([])
  })

  it('accepts a known kind:format narrowing', () => {
    const issues = validateAttributeDefinition('Book', 'cover_url', {
      type: 'string',
      format: 'url'
    })
    expect(issues).toEqual([])
  })
})

// ─── validateAssociation ───────────────────────────────────────────────────

describe('lib/core/schema-validation: validateAssociation', () => {
  it('passes when target_model resolves', () => {
    const issues = validateAssociation(
      'Book',
      'location',
      { target_model: 'location' },
      ['book', 'location'],
      'belongsTo'
    )
    expect(issues).toEqual([])
  })

  it('errors on missing target_model', () => {
    const issues = validateAssociation('Book', 'location', {}, ['book', 'location'], 'belongsTo')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('missing target_model')
  })

  it('errors and suggests on unknown target_model', () => {
    const issues = validateAssociation(
      'Book',
      'location',
      { target_model: 'locaton' },
      ['book', 'location'],
      'belongsTo'
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]!.hint).toContain('did you mean "location"')
  })
})

// ─── validateFormClass ─────────────────────────────────────────────────────

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

describe('lib/core/schema-validation: validateFormClass', () => {
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

// ─── validatePromptClass ───────────────────────────────────────────────────

describe('lib/core/schema-validation: validatePromptClass', () => {
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

// ─── validateRegistries + SchemaValidationError ────────────────────────────

describe('lib/core/schema-validation: validateRegistries', () => {
  it('aggregates issues across models, forms, and prompts', () => {
    const report = validateRegistries({
      models: {
        // @ts-expect-error — bad type
        book: { ...BookModel, attributes: { ...BookModel.attributes, foo: { type: 'datetimme' } } },
        location: { attributes: {} },
        tag: { attributes: {} }
      },
      forms: { book: { fields: ['titel'] } }
    })

    const messages = report.errors.map((e) => e.message).join('\n')
    expect(messages).toContain('unknown type "datetimme"')
    expect(messages).toContain('unknown attribute "titel"')
  })

  it('separates errors from warnings', () => {
    const report = validateRegistries({
      models: {
        book: {
          ...BookModel,
          attributes: {
            ...BookModel.attributes,
            cover: { type: 'string', format: 'made-up' }
          }
        },
        location: { attributes: {} },
        tag: { attributes: {} }
      }
    })
    expect(report.errors).toHaveLength(0)
    expect(report.warnings).toHaveLength(1)
  })

  it('SchemaValidationError carries a formatted report', () => {
    const report = validateRegistries({
      models: {
        // @ts-expect-error — bad type
        book: { attributes: { foo: { type: 'datetimme' } } }
      }
    })
    const err = new SchemaValidationError(report)
    expect(err.report).toBe(report)
    expect(err.message).toContain('failed with 1 error')
    expect(err.message).toContain('datetimme')
  })

  it('formatReport groups issues by model', () => {
    const formatted = formatReport({
      errors: [
        {
          level: 'error',
          scope: 'attribute',
          model: 'book',
          attribute: 'title',
          message: 'oh no'
        },
        {
          level: 'error',
          scope: 'attribute',
          model: 'book',
          attribute: 'status',
          message: 'also oh no'
        }
      ],
      warnings: []
    })
    expect(formatted).toContain('  book:')
    expect(formatted).toContain('[attribute.title] oh no')
    expect(formatted).toContain('[attribute.status] also oh no')
  })
})
