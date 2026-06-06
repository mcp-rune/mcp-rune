import { describe, expect, it } from 'vitest'

import {
  validateAssociation,
  validateAttributeDefinition
} from '../../../../src/mcp/model-layer/model-validator.js'
import { getKind } from '../../../../src/mcp/models/kinds/index.js'
import { UnknownKindError } from '../../../../src/mcp/models/kinds/registry.js'

describe('lib/mcp/model-layer/model-validator: kinds strict mode', () => {
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

describe('model-validator: validateAttributeDefinition', () => {
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

describe('model-validator: validateAssociation', () => {
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
