import { describe, it, expect } from 'vitest'
import {
  generateListSchema,
  applyColumnSelection,
  getAvailableColumnNames
} from '../../../../lib/mcp/apps/list-schema.js'

describe('lib/mcp/apps/list-schema', () => {
  function makeModel(overrides = {}) {
    return {
      endpoint: 'books',
      singularName: 'book',
      search: { autocompleteFields: ['title', 'author'] },
      description: 'Books for study',
      attributes: {
        title: { type: 'string', required: true },
        author: { type: 'string' },
        status: { type: 'enum', enumValues: ['unread', 'reading', 'completed'] },
        rating: { type: 'integer' },
        description: { type: 'text' },
        cover_data: { type: 'string', format: 'base64' },
        notes: { type: 'text' }
      },
      ...overrides
    }
  }

  describe('generateListSchema', () => {
    it('generates model name from endpoint', () => {
      const schema = generateListSchema(makeModel())
      expect(schema.model).toBe('book')
    })

    it('generates title from endpoint', () => {
      const schema = generateListSchema(makeModel())
      expect(schema.title).toBe('Books')
    })

    it('includes endpoint', () => {
      const schema = generateListSchema(makeModel())
      expect(schema.endpoint).toBe('books')
    })

    it('includes searchFields from model', () => {
      const schema = generateListSchema(makeModel())
      expect(schema.searchFields).toEqual(['title', 'author'])
    })

    it('generates columns from attributes', () => {
      const schema = generateListSchema(makeModel())
      const columnNames = schema.columns.map((c) => c.name)

      expect(columnNames).toContain('title')
      expect(columnNames).toContain('author')
      expect(columnNames).toContain('status')
      expect(columnNames).toContain('rating')
    })

    it('excludes text type fields except description', () => {
      const schema = generateListSchema(makeModel())
      const columnNames = schema.columns.map((c) => c.name)

      expect(columnNames).not.toContain('notes')
    })

    it('excludes base64 fields', () => {
      const schema = generateListSchema(makeModel())
      const columnNames = schema.columns.map((c) => c.name)

      expect(columnNames).not.toContain('cover_data')
    })

    it('excludes id field', () => {
      const schema = generateListSchema(
        makeModel({
          attributes: {
            id: { type: 'string' },
            title: { type: 'string' }
          }
        })
      )
      const columnNames = schema.columns.map((c) => c.name)
      expect(columnNames).not.toContain('id')
    })

    it('uses custom label when provided', () => {
      const schema = generateListSchema(
        makeModel({
          attributes: {
            location_id: { type: 'integer', label: 'Location' }
          }
        })
      )
      const col = schema.columns.find((c) => c.name === 'location_id')
      expect(col.label).toBe('Location')
    })

    it('humanizes field name when no label', () => {
      const schema = generateListSchema(
        makeModel({
          attributes: {
            publication_year: { type: 'integer' }
          }
        })
      )
      const col = schema.columns.find((c) => c.name === 'publication_year')
      expect(col.label).toBe('Publication Year')
    })

    it('includes enumValues for enum columns', () => {
      const schema = generateListSchema(makeModel())
      const statusCol = schema.columns.find((c) => c.name === 'status')
      expect(statusCol.enumValues).toEqual(['unread', 'reading', 'completed'])
    })

    it('marks columns as sortable', () => {
      const schema = generateListSchema(makeModel())
      for (const col of schema.columns) {
        expect(col.sortable).toBe(true)
      }
    })

    it('handles model with no searchable fields', () => {
      const schema = generateListSchema(makeModel({ search: { autocompleteFields: [] } }))
      expect(schema.searchFields).toEqual([])
    })

    it('excludes prompt_visible: false fields', () => {
      const schema = generateListSchema(
        makeModel({
          attributes: {
            title: { type: 'string' },
            hidden_field: { type: 'string', prompt_visible: false }
          }
        })
      )
      const columnNames = schema.columns.map((c) => c.name)
      expect(columnNames).not.toContain('hidden_field')
    })

    it('includes derived fields even when prompt_visible: false', () => {
      const schema = generateListSchema(
        makeModel({
          attributes: {
            title: { type: 'string' },
            theme_name: {
              type: 'string',
              label: 'Theme',
              prompt_visible: false,
              derived: { from: 'theme', field: 'name' }
            }
          }
        })
      )
      const columnNames = schema.columns.map((c) => c.name)
      expect(columnNames).toContain('theme_name')
    })

    it('marks derived columns as non-sortable', () => {
      const schema = generateListSchema(
        makeModel({
          attributes: {
            title: { type: 'string' },
            theme_name: {
              type: 'string',
              label: 'Theme',
              prompt_visible: false,
              derived: { from: 'theme', field: 'name' }
            }
          }
        })
      )
      const titleCol = schema.columns.find((c) => c.name === 'title')
      const derivedCol = schema.columns.find((c) => c.name === 'theme_name')

      expect(titleCol.sortable).toBe(true)
      expect(derivedCol.sortable).toBe(false)
    })

    it('includes derived metadata on derived columns', () => {
      const schema = generateListSchema(
        makeModel({
          attributes: {
            theme_name: {
              type: 'string',
              prompt_visible: false,
              derived: { from: 'theme', field: 'name' }
            }
          }
        })
      )
      const col = schema.columns.find((c) => c.name === 'theme_name')
      expect(col.derived).toEqual({ from: 'theme', field: 'name' })
    })
  })

  describe('getAvailableColumnNames', () => {
    it('returns column names from inferred columns', () => {
      const names = getAvailableColumnNames(makeModel())
      expect(names).toContain('title')
      expect(names).toContain('author')
      expect(names).toContain('status')
      expect(names).toContain('rating')
      expect(names).toContain('description')
    })

    it('excludes filtered columns (id, base64, non-description text)', () => {
      const names = getAvailableColumnNames(makeModel())
      expect(names).not.toContain('notes')
      expect(names).not.toContain('cover_data')
    })
  })

  describe('applyColumnSelection', () => {
    it('returns default subset when no selection and model has defaultColumns', () => {
      const schema = generateListSchema(makeModel())
      const ModelWithDefaults = { ...makeModel(), defaultColumns: ['title', 'status'] }
      const result = applyColumnSelection(schema, undefined, ModelWithDefaults)

      const names = result.columns.map((c) => c.name)
      expect(names).toEqual(['title', 'status'])
    })

    it('returns full schema when no selection and model has no defaultColumns', () => {
      const schema = generateListSchema(makeModel())
      const result = applyColumnSelection(schema, undefined, makeModel())

      expect(result).toBe(schema)
    })

    it('filters to explicit columns', () => {
      const schema = generateListSchema(makeModel())
      const result = applyColumnSelection(schema, ['title', 'rating'], makeModel())

      const names = result.columns.map((c) => c.name)
      expect(names).toEqual(['title', 'rating'])
    })

    it('ignores unknown column names', () => {
      const schema = generateListSchema(makeModel())
      const result = applyColumnSelection(schema, ['title', 'nonexistent'], makeModel())

      const names = result.columns.map((c) => c.name)
      expect(names).toEqual(['title'])
    })

    it('falls back to defaults when all selected columns are unknown', () => {
      const schema = generateListSchema(makeModel())
      const ModelWithDefaults = { ...makeModel(), defaultColumns: ['title', 'author'] }
      const result = applyColumnSelection(schema, ['fake1', 'fake2'], ModelWithDefaults)

      const names = result.columns.map((c) => c.name)
      expect(names).toEqual(['title', 'author'])
    })

    it('falls back to full schema when all selected columns are unknown and no defaults', () => {
      const schema = generateListSchema(makeModel())
      const result = applyColumnSelection(schema, ['fake1', 'fake2'], makeModel())

      expect(result.columns).toEqual(schema.columns)
    })

    it('preserves order from columnsToUse, not attribute declaration order', () => {
      const schema = generateListSchema(
        makeModel({
          attributes: {
            title: { type: 'string' },
            author: { type: 'string' },
            status: { type: 'string' },
            rating: { type: 'integer' }
          }
        })
      )
      // Request columns in reverse order of declaration
      const result = applyColumnSelection(schema, ['rating', 'title'], makeModel())

      const names = result.columns.map((c) => c.name)
      expect(names).toEqual(['rating', 'title'])
    })

    it('does not mutate the original schema', () => {
      const schema = generateListSchema(makeModel())
      const originalColumns = [...schema.columns]
      applyColumnSelection(schema, ['title'], makeModel())

      expect(schema.columns).toEqual(originalColumns)
    })
  })
})
