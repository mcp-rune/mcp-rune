import { DisplayAdapter } from '../../../../src/mcp/apps/lib/display-adapter.js'

describe('lib/mcp/apps/display-adapter', () => {
  const adapter = new DisplayAdapter()

  function makeModel(overrides = {}) {
    return {
      api: { endpoint: 'books' },
      singularName: 'book',
      attributes: {
        id: { type: 'string', prompt_visible: false },
        title: { type: 'string', required: true },
        author: { type: 'string' },
        status: { type: 'enum', enumValues: ['draft', 'published'] },
        notes: { type: 'text' },
        description: { type: 'text' },
        cover_data: { type: 'string', format: 'base64' },
        internal_score: { type: 'integer', prompt_visible: false },
        hidden_field: { type: 'string', list_visible: false }
      },
      ...overrides
    }
  }

  describe('isColumnVisible', () => {
    it('excludes id field', () => {
      expect(adapter.isColumnVisible('id', { type: 'string' })).toBe(false)
    })

    it('excludes base64 fields', () => {
      expect(adapter.isColumnVisible('cover', { format: 'base64' })).toBe(false)
    })

    it('excludes text fields except description', () => {
      expect(adapter.isColumnVisible('notes', { type: 'text' })).toBe(false)
      expect(adapter.isColumnVisible('description', { type: 'text' })).toBe(true)
    })

    it('excludes list_visible: false fields', () => {
      expect(adapter.isColumnVisible('hidden', { list_visible: false })).toBe(false)
    })

    it('includes prompt_visible: false fields', () => {
      expect(adapter.isColumnVisible('status', { type: 'enum', prompt_visible: false })).toBe(true)
    })

    it('includes regular fields', () => {
      expect(adapter.isColumnVisible('title', { type: 'string' })).toBe(true)
    })

    it('includes derived fields with prompt_visible: false', () => {
      expect(
        adapter.isColumnVisible('title_name', {
          type: 'string',
          prompt_visible: false,
          derived: { from: 'title', field: 'name' }
        })
      ).toBe(true)
    })
  })

  describe('isDetailVisible', () => {
    it('excludes base64 fields', () => {
      expect(adapter.isDetailVisible('cover', { format: 'base64' })).toBe(false)
    })

    it('excludes list_visible: false fields', () => {
      expect(adapter.isDetailVisible('hidden', { list_visible: false })).toBe(false)
    })

    it('includes prompt_visible: false fields', () => {
      expect(adapter.isDetailVisible('status', { prompt_visible: false })).toBe(true)
    })

    it('includes id field (detail views show id)', () => {
      expect(adapter.isDetailVisible('id', { type: 'string' })).toBe(true)
    })
  })

  describe('getDefaultColumns', () => {
    it('returns model defaultColumns when defined', () => {
      const Model = { defaultColumns: ['title', 'status'] }
      expect(adapter.getDefaultColumns(Model)).toEqual(['title', 'status'])
    })

    it('returns null when model has no defaultColumns', () => {
      expect(adapter.getDefaultColumns({})).toBeNull()
    })
  })

  describe('getEnumHints', () => {
    it('returns null by default', () => {
      expect(adapter.getEnumHints('status', 'published')).toBeNull()
    })
  })

  describe('buildColumn', () => {
    it('builds column with humanized label', () => {
      const col = adapter.buildColumn('publication_year', { type: 'integer' })
      expect(col).toEqual({
        name: 'publication_year',
        label: 'Publication Year',
        type: 'integer',
        sortable: true
      })
    })

    it('uses custom label when provided', () => {
      const col = adapter.buildColumn('pub_year', { type: 'integer', label: 'Year' })
      expect(col.label).toBe('Year')
    })

    it('includes enumValues', () => {
      const col = adapter.buildColumn('status', {
        type: 'enum',
        enumValues: ['draft', 'published']
      })
      expect(col.enumValues).toEqual(['draft', 'published'])
    })

    it('includes derived metadata and marks not sortable', () => {
      const derived = { from: 'title', field: 'name' }
      const col = adapter.buildColumn('title_name', { type: 'string', derived })
      expect(col.derived).toEqual(derived)
      expect(col.sortable).toBe(false)
    })

    it('defaults type to string', () => {
      const col = adapter.buildColumn('foo', {})
      expect(col.type).toBe('string')
    })
  })

  describe('inferColumns', () => {
    it('includes standard visible fields', () => {
      const columns = adapter.inferColumns(makeModel())
      const names = columns.map((c) => c.name)
      expect(names).toContain('title')
      expect(names).toContain('author')
      expect(names).toContain('status')
    })

    it('excludes id, base64, long text, and list_visible: false', () => {
      const columns = adapter.inferColumns(makeModel())
      const names = columns.map((c) => c.name)
      expect(names).not.toContain('id')
      expect(names).not.toContain('cover_data')
      expect(names).not.toContain('notes')
      expect(names).not.toContain('hidden_field')
    })

    it('includes description (text exception)', () => {
      const columns = adapter.inferColumns(makeModel())
      const names = columns.map((c) => c.name)
      expect(names).toContain('description')
    })

    it('includes prompt_visible: false fields', () => {
      const columns = adapter.inferColumns(makeModel())
      const names = columns.map((c) => c.name)
      expect(names).toContain('internal_score')
    })

    it('includes derived fields with prompt_visible: false', () => {
      const model = makeModel({
        attributes: {
          title: { type: 'string' },
          title_name: {
            type: 'string',
            prompt_visible: false,
            derived: { from: 'title', field: 'name' }
          }
        }
      })
      const columns = adapter.inferColumns(model)
      const names = columns.map((c) => c.name)
      expect(names).toContain('title_name')
    })

    it('does not attach enumHints when adapter returns null', () => {
      const columns = adapter.inferColumns(makeModel())
      const statusCol = columns.find((c) => c.name === 'status')
      expect(statusCol.enumHints).toBeUndefined()
    })

    it('attaches enumHints from custom adapter', () => {
      class CustomAdapter extends DisplayAdapter {
        getEnumHints(fieldName, value) {
          if (fieldName === 'status' && value === 'published') {
            return { icon: '\u25CF', className: 'status-success' }
          }
          return null
        }
      }

      const customAdapter = new CustomAdapter()
      const model = makeModel()
      const columns = customAdapter.inferColumns(model)
      const statusCol = columns.find((c) => c.name === 'status')
      expect(statusCol.enumHints).toBeDefined()
      expect(statusCol.enumHints.published).toEqual({
        icon: '\u25CF',
        className: 'status-success'
      })
      expect(statusCol.enumHints.draft).toBeUndefined()
    })
  })

  describe('inferDetailFields', () => {
    it('includes prompt_visible: false fields', () => {
      const fields = adapter.inferDetailFields(makeModel())
      const names = fields.map((f) => f.name)
      expect(names).toContain('internal_score')
    })

    it('includes id in detail view', () => {
      const fields = adapter.inferDetailFields(makeModel())
      const names = fields.map((f) => f.name)
      expect(names).toContain('id')
    })

    it('excludes base64 and list_visible: false', () => {
      const fields = adapter.inferDetailFields(makeModel())
      const names = fields.map((f) => f.name)
      expect(names).not.toContain('cover_data')
      expect(names).not.toContain('hidden_field')
    })

    it('builds field with association metadata', () => {
      const model = {
        attributes: {
          category_id: { type: 'integer' }
        },
        associations: {
          belongsTo: {
            category: { target_model: 'category' }
          }
        }
      }
      const fields = adapter.inferDetailFields(model)
      const catField = fields.find((f) => f.name === 'category_id')
      expect(catField.association).toEqual({
        endpoint: 'categories',
        labelField: 'name'
      })
    })

    it('includes format and validation in field definitions', () => {
      const model = {
        attributes: {
          url: { type: 'string', format: 'URL', validation: { pattern: 'https://' } }
        }
      }
      const fields = adapter.inferDetailFields(model)
      expect(fields[0].format).toBe('URL')
      expect(fields[0].validation).toEqual({ pattern: 'https://' })
    })
  })

  describe('_pluralize', () => {
    it('pluralizes regular words', () => {
      expect(adapter._pluralize('book')).toBe('books')
    })

    it('handles words ending in y', () => {
      expect(adapter._pluralize('category')).toBe('categories')
    })

    it('does not double-pluralize words ending in s', () => {
      expect(adapter._pluralize('series')).toBe('series')
    })
  })
})
