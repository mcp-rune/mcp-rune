import { generateDetailSchema } from '../../../../src/mcp/apps/detail-schema.js'

describe('lib/mcp/apps/detail-schema', () => {
  function makeModel(overrides = {}) {
    return {
      api: { endpoint: '/api/books' },
      singularName: 'book',
      description: 'Books for study',
      attributes: {
        id: { type: 'string', prompt_visible: false },
        title: { type: 'string', label: 'Title' },
        author: { type: 'string' },
        status: { type: 'enum', enumValues: ['draft', 'active', 'archived'] },
        theme: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array' },
        cover_data: { type: 'string', format: 'base64' },
        notes: { type: 'text', validation: { maxLength: 5000 } }
      },
      ...overrides
    }
  }

  function makePrompt(overrides = {}) {
    return {
      fieldGroups: {
        identity: {
          fields: ['title', 'author'],
          context: 'Identity'
        },
        classification: {
          fields: ['status', 'tags'],
          context: 'Classification'
        }
      },
      ...overrides
    }
  }

  describe('without PromptClass', () => {
    it('generates model name from singularName', () => {
      const schema = generateDetailSchema(makeModel())
      expect(schema.model).toBe('book')
    })

    it('generates title from model name', () => {
      const schema = generateDetailSchema(makeModel())
      expect(schema.title).toBe('Book')
    })

    it('includes endpoint', () => {
      const schema = generateDetailSchema(makeModel())
      expect(schema.endpoint).toBe('/api/books')
    })

    it('includes all visible fields', () => {
      const schema = generateDetailSchema(makeModel())
      const names = schema.fields.map((f) => f.name)

      expect(names).toContain('title')
      expect(names).toContain('author')
      expect(names).toContain('status')
      expect(names).toContain('theme')
      expect(names).toContain('category')
      expect(names).toContain('tags')
      expect(names).toContain('notes')
    })

    it('excludes prompt_visible: false fields', () => {
      const schema = generateDetailSchema(makeModel())
      const names = schema.fields.map((f) => f.name)
      expect(names).not.toContain('id')
    })

    it('excludes base64 fields', () => {
      const schema = generateDetailSchema(makeModel())
      const names = schema.fields.map((f) => f.name)
      expect(names).not.toContain('cover_data')
    })

    it('does not include fieldsets', () => {
      const schema = generateDetailSchema(makeModel())
      expect(schema.fieldsets).toBeUndefined()
    })

    it('uses custom label when provided', () => {
      const schema = generateDetailSchema(makeModel())
      const field = schema.fields.find((f) => f.name === 'title')
      expect(field.label).toBe('Title')
    })

    it('humanizes field name when no label', () => {
      const schema = generateDetailSchema(
        makeModel({
          attributes: { publication_year: { type: 'integer' } }
        })
      )
      const field = schema.fields.find((f) => f.name === 'publication_year')
      expect(field.label).toBe('Publication Year')
    })

    it('humanizes _id suffix in label', () => {
      const schema = generateDetailSchema(
        makeModel({
          attributes: { licensor_id: { type: 'integer' } }
        })
      )
      const field = schema.fields.find((f) => f.name === 'licensor_id')
      expect(field.label).toBe('Licensor')
    })

    it('includes enumValues for enum fields', () => {
      const schema = generateDetailSchema(makeModel())
      const field = schema.fields.find((f) => f.name === 'status')
      expect(field.enumValues).toEqual(['draft', 'active', 'archived'])
    })

    it('includes validation when present', () => {
      const schema = generateDetailSchema(makeModel())
      const field = schema.fields.find((f) => f.name === 'notes')
      expect(field.validation).toEqual({ maxLength: 5000 })
    })

    it('includes format when present', () => {
      const schema = generateDetailSchema(
        makeModel({
          attributes: { url: { type: 'string', format: 'URL' } }
        })
      )
      const field = schema.fields.find((f) => f.name === 'url')
      expect(field.format).toBe('URL')
    })

    it('defaults type to string', () => {
      const schema = generateDetailSchema(makeModel({ attributes: { simple: {} } }))
      const field = schema.fields.find((f) => f.name === 'simple')
      expect(field.type).toBe('string')
    })

    it('handles empty attributes', () => {
      const schema = generateDetailSchema(makeModel({ attributes: {} }))
      expect(schema.fields).toEqual([])
    })
  })

  describe('with PromptClass', () => {
    it('includes ALL visible model attributes, not just grouped ones', () => {
      const schema = generateDetailSchema(makeModel(), makePrompt())
      const names = schema.fields.map((f) => f.name)

      // Grouped fields
      expect(names).toContain('title')
      expect(names).toContain('author')
      expect(names).toContain('status')
      expect(names).toContain('tags')

      // Non-grouped fields that were previously missing
      expect(names).toContain('theme')
      expect(names).toContain('category')
      expect(names).toContain('notes')
    })

    it('orders grouped fields first, then remaining', () => {
      const schema = generateDetailSchema(makeModel(), makePrompt())
      const names = schema.fields.map((f) => f.name)

      const titleIdx = names.indexOf('title')
      const authorIdx = names.indexOf('author')
      const statusIdx = names.indexOf('status')
      const tagsIdx = names.indexOf('tags')
      const themeIdx = names.indexOf('theme')
      const categoryIdx = names.indexOf('category')

      expect(titleIdx).toBeLessThan(authorIdx)
      expect(authorIdx).toBeLessThan(statusIdx)
      expect(statusIdx).toBeLessThan(tagsIdx)
      expect(tagsIdx).toBeLessThan(themeIdx)
      expect(themeIdx).toBeLessThan(categoryIdx)
    })

    it('excludes prompt_visible: false fields', () => {
      const schema = generateDetailSchema(makeModel(), makePrompt())
      const names = schema.fields.map((f) => f.name)
      expect(names).not.toContain('id')
    })

    it('excludes base64 fields', () => {
      const schema = generateDetailSchema(makeModel(), makePrompt())
      const names = schema.fields.map((f) => f.name)
      expect(names).not.toContain('cover_data')
    })

    it('skips prompt-only fields not in model', () => {
      const prompt = makePrompt({
        fieldGroups: {
          identity: {
            fields: ['title', 'content_type', 'nonexistent'],
            context: 'Identity'
          }
        }
      })
      const schema = generateDetailSchema(makeModel(), prompt)
      const names = schema.fields.map((f) => f.name)

      expect(names).toContain('title')
      expect(names).not.toContain('content_type')
      expect(names).not.toContain('nonexistent')
    })

    it('does not include fieldsets', () => {
      const schema = generateDetailSchema(makeModel(), makePrompt())
      expect(schema.fieldsets).toBeUndefined()
    })

    it('does not duplicate fields across groups', () => {
      const prompt = makePrompt({
        fieldGroups: {
          group_a: { fields: ['title', 'author'] },
          group_b: { fields: ['author', 'status'] }
        }
      })
      const schema = generateDetailSchema(makeModel(), prompt)
      const names = schema.fields.map((f) => f.name)

      const authorCount = names.filter((n) => n === 'author').length
      expect(authorCount).toBe(1)
    })

    it('handles empty fieldGroups', () => {
      const prompt = makePrompt({ fieldGroups: {} })
      const schema = generateDetailSchema(makeModel(), prompt)
      const names = schema.fields.map((f) => f.name)

      expect(names).toContain('title')
      expect(names).toContain('theme')
    })

    it('preserves label, type, enumValues, validation from model', () => {
      const schema = generateDetailSchema(makeModel(), makePrompt())

      const title = schema.fields.find((f) => f.name === 'title')
      expect(title.label).toBe('Title')
      expect(title.type).toBe('string')

      const status = schema.fields.find((f) => f.name === 'status')
      expect(status.enumValues).toEqual(['draft', 'active', 'archived'])

      const notes = schema.fields.find((f) => f.name === 'notes')
      expect(notes.validation).toEqual({ maxLength: 5000 })
    })

    it('fields do not have group property', () => {
      const schema = generateDetailSchema(makeModel(), makePrompt())
      for (const field of schema.fields) {
        expect(field.group).toBeUndefined()
      }
    })
  })

  describe('association marking', () => {
    it('marks _id fields with association when model has belongsTo', () => {
      const model = makeModel({
        attributes: {
          theme_id: { type: 'integer', description: 'Theme' },
          title: { type: 'string' }
        },
        associations: {
          belongsTo: {
            theme: { rel: 'theme', target_model: 'theme' }
          }
        }
      })

      const schema = generateDetailSchema(model)
      const field = schema.fields.find((f) => f.name === 'theme_id')
      expect(field.association).toEqual({ endpoint: 'themes', labelField: 'name' })
    })

    it('does not mark _id fields without matching association', () => {
      const model = makeModel({
        attributes: {
          author_id: { type: 'integer' }
        },
        associations: {
          belongsTo: {
            theme: { rel: 'theme', target_model: 'theme' }
          }
        }
      })

      const schema = generateDetailSchema(model)
      const field = schema.fields.find((f) => f.name === 'author_id')
      expect(field.association).toBeUndefined()
    })

    it('does not mark _id fields when no associations exist', () => {
      const model = makeModel({
        attributes: { theme_id: { type: 'integer' } }
      })

      const schema = generateDetailSchema(model)
      const field = schema.fields.find((f) => f.name === 'theme_id')
      expect(field.association).toBeUndefined()
    })

    it('marks associations in ordered fields with PromptClass', () => {
      const model = makeModel({
        attributes: {
          title: { type: 'string' },
          category_id: { type: 'integer' }
        },
        associations: {
          belongsTo: {
            category: { rel: 'category', target_model: 'category' }
          }
        }
      })
      const prompt = makePrompt({
        fieldGroups: { main: { fields: ['title', 'category_id'] } }
      })

      const schema = generateDetailSchema(model, prompt)
      const field = schema.fields.find((f) => f.name === 'category_id')
      expect(field.association).toEqual({ endpoint: 'categories', labelField: 'name' })
    })
  })
})
