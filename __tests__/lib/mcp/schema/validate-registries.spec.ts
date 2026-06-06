import { describe, expect, it } from 'vitest'

import {
  formatReport,
  SchemaValidationError,
  validateRegistries
} from '../../../../src/mcp/schema/index.js'

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

describe('schema: validateRegistries', () => {
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
