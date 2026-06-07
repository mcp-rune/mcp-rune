import { describe, expect, it } from 'vitest'

import { generateAppFormSchema as generateFormSchema } from '../../../../src/mcp/apps/lib/app-form-schema.js'

const MockModel = {
  api: { endpoint: 'books' },
  singularName: 'book',
  attributes: {
    id: { type: 'string', prompt_visible: false, description: 'Auto-generated ID' },
    title: {
      type: 'string',
      required: true,
      description: 'Title of the book',
      examples: ['Clean Code'],
      validation: { minLength: 1 }
    },
    author: { type: 'string', description: 'Author name', examples: ['Robert C. Martin'] },
    status: {
      type: 'enum',
      enumValues: ['unread', 'reading', 'completed'],
      default: 'unread',
      description: 'Reading status'
    },
    rating: {
      type: 'integer',
      description: 'Rating 1-5',
      validation: { min: 1, max: 5 }
    },
    formats: {
      type: 'array',
      enumValues: ['physical', 'ebook', 'pdf'],
      description: 'Formats owned'
    },
    description: { type: 'text', description: 'Book description' },
    cover_url: { type: 'string', format: 'URL', label: 'Cover URL', description: 'Cover image' },
    cover_base64: { type: 'string', format: 'base64', description: 'Base64 image' },
    location_id: {
      type: 'integer',
      label: 'Location',
      description: 'Where the book is stored'
    },
    tag_ids: {
      type: 'array',
      label: 'Tags',
      description: 'Associated tags'
    },
    created_at: { type: 'datetime', prompt_visible: false, description: 'Created timestamp' }
  },
  associations: {
    belongsTo: {
      location: { rel: 'location', target_model: 'location' }
    },
    hasMany: {
      tags: { rel: 'tags', target_model: 'tag' }
    }
  }
}

const MockForm = {
  fields: [
    'title',
    'author',
    'status',
    'rating',
    'formats',
    'cover_url',
    'cover_base64',
    'description',
    'location_id',
    'tag_ids'
  ],
  fieldsets: {
    identity: {
      title: 'Book Identity',
      description: 'Core book info',
      required: true,
      fields: ['title', 'author']
    },
    details: {
      title: 'Details',
      description: 'Status and formats',
      required: false,
      fields: ['status', 'rating', 'formats', 'cover_url', 'cover_base64', 'description']
    },
    organization: {
      title: 'Organization',
      description: 'Location and tags',
      required: false,
      fields: ['location_id', 'tag_ids']
    }
  }
}

describe('lib/mcp/apps/form-schema', () => {
  describe('generateFormSchema', () => {
    it('returns schema with model name', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      expect(schema.model).toBe('book')
    })

    it('returns schema with title derived from endpoint', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      expect(schema.title).toBe('Create Books')
    })

    it('returns fieldsets from FormClass.fieldsets', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      expect(schema.fieldsets).toHaveLength(3)
      expect(schema.fieldsets[0]).toEqual({
        key: 'identity',
        title: 'Book Identity',
        description: 'Core book info',
        required: true,
        groups: ['identity']
      })
    })

    it('excludes attributes with prompt_visible: false even if listed', () => {
      const FormWithHidden = { fields: ['title', 'id', 'created_at'] }
      const schema = generateFormSchema(MockModel, FormWithHidden)
      const fieldNames = schema.fields.map((f) => f.name)
      expect(fieldNames).not.toContain('id')
      expect(fieldNames).not.toContain('created_at')
      expect(fieldNames).toContain('title')
    })

    it('maps string type to text', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const titleField = schema.fields.find((f) => f.name === 'title')
      expect(titleField.type).toBe('text')
    })

    it('maps text type to textarea', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const descField = schema.fields.find((f) => f.name === 'description')
      expect(descField.type).toBe('textarea')
    })

    it('maps integer type to number', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const ratingField = schema.fields.find((f) => f.name === 'rating')
      expect(ratingField.type).toBe('number')
    })

    it('maps enums to select with options', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const statusField = schema.fields.find((f) => f.name === 'status')
      expect(statusField.type).toBe('select')
      expect(statusField.options).toEqual([
        { value: 'unread', label: 'Unread' },
        { value: 'reading', label: 'Reading' },
        { value: 'completed', label: 'Completed' }
      ])
      expect(statusField.default).toBe('unread')
    })

    it('maps array with enumValues to checkbox_group', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const formatsField = schema.fields.find((f) => f.name === 'formats')
      expect(formatsField.type).toBe('checkbox_group')
      expect(formatsField.options).toEqual([
        { value: 'physical', label: 'Physical' },
        { value: 'ebook', label: 'Ebook' },
        { value: 'pdf', label: 'Pdf' }
      ])
    })

    it('maps format: URL (uppercase) to url type via case-insensitive lookup', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const coverField = schema.fields.find((f) => f.name === 'cover_url')
      expect(coverField.type).toBe('url')
    })

    it('maps format: base64 to text (display-only, matches formatter (binary) rendering)', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const base64Field = schema.fields.find((f) => f.name === 'cover_base64')
      expect(base64Field.type).toBe('text')
    })

    it('maps belongsTo association to select with association metadata', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const locationField = schema.fields.find((f) => f.name === 'location_id')
      expect(locationField.type).toBe('select')
      expect(locationField.association).toEqual({
        endpoint: 'locations',
        labelField: 'name'
      })
    })

    it('maps hasMany association to multiselect with association metadata', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const tagField = schema.fields.find((f) => f.name === 'tag_ids')
      expect(tagField.type).toBe('multiselect')
      expect(tagField.association).toEqual({
        endpoint: 'tags',
        labelField: 'name'
      })
    })

    it('preserves required flag', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const titleField = schema.fields.find((f) => f.name === 'title')
      const authorField = schema.fields.find((f) => f.name === 'author')
      expect(titleField.required).toBe(true)
      expect(authorField.required).toBe(false)
    })

    it('preserves validation constraints', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const ratingField = schema.fields.find((f) => f.name === 'rating')
      expect(ratingField.validation).toEqual({ min: 1, max: 5 })
    })

    it('generates placeholder from examples', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const titleField = schema.fields.find((f) => f.name === 'title')
      expect(titleField.placeholder).toBe('e.g. Clean Code')
    })

    it('uses custom label when provided', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const coverField = schema.fields.find((f) => f.name === 'cover_url')
      expect(coverField.label).toBe('Cover URL')
    })

    it('humanizes field name when no label', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const authorField = schema.fields.find((f) => f.name === 'author')
      expect(authorField.label).toBe('Author')
    })

    it('humanizes _id suffix in label', () => {
      const FormWithIdField = { fields: ['title', 'location_id'] }
      const ModelWithoutLabel = {
        ...MockModel,
        attributes: {
          ...MockModel.attributes,
          location_id: { type: 'integer', description: 'Where the book is stored' }
        }
      }
      const schema = generateFormSchema(ModelWithoutLabel, FormWithIdField)
      const locationField = schema.fields.find((f) => f.name === 'location_id')
      expect(locationField.label).toBe('Location')
    })

    it('assigns fieldset key to each field via fieldsets mapping', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const titleField = schema.fields.find((f) => f.name === 'title')
      const statusField = schema.fields.find((f) => f.name === 'status')
      expect(titleField.group).toBe('identity')
      expect(statusField.group).toBe('details')
    })

    it('preserves field ordering from FormClass.fields', () => {
      const schema = generateFormSchema(MockModel, MockForm)
      const fieldNames = schema.fields.map((f) => f.name)
      const titleIdx = fieldNames.indexOf('title')
      const authorIdx = fieldNames.indexOf('author')
      const statusIdx = fieldNames.indexOf('status')
      expect(titleIdx).toBeLessThan(authorIdx)
      expect(authorIdx).toBeLessThan(statusIdx)
    })

    describe('empty fieldset filtering', () => {
      it('filters out fieldsets when every named field is missing from attributes', () => {
        const Model = {
          api: { endpoint: 'items' },
          singularName: 'item',
          attributes: {
            name: { type: 'string', required: true }
          },
          associations: {}
        }
        const Form = {
          fields: ['name'],
          fieldsets: {
            basic: { title: 'Basic Info', required: true, fields: ['name'] },
            relations: {
              title: 'Relations',
              required: false,
              fields: ['platform_link', 'content_link']
            }
          }
        }

        const schema = generateFormSchema(Model, Form)
        expect(schema.fieldsets).toHaveLength(1)
        expect(schema.fieldsets[0].key).toBe('basic')
      })

      it('keeps fieldsets with mixed fields when some are renderable', () => {
        const Model = {
          api: { endpoint: 'items' },
          singularName: 'item',
          attributes: {
            name: { type: 'string' },
            status: { type: 'enum', enumValues: ['active', 'inactive'] }
          },
          associations: {}
        }
        const Form = {
          fields: ['name', 'status'],
          fieldsets: {
            info: { title: 'Info', required: true, fields: ['name', 'status'] }
          }
        }

        const schema = generateFormSchema(Model, Form)
        expect(schema.fieldsets).toHaveLength(1)
        expect(schema.fields).toHaveLength(2)
      })

      it('renders the full set when every field is in attributes', () => {
        const schema = generateFormSchema(MockModel, MockForm)
        expect(schema.fieldsets).toHaveLength(3)
      })
    })

    describe('conditional visibility', () => {
      it('passes visibleWhen from attribute config to field schema', () => {
        const Model = {
          api: { endpoint: 'items' },
          singularName: 'item',
          attributes: {
            status: { type: 'enum', enumValues: ['active', 'archived'] },
            archive_reason: {
              type: 'string',
              visibleWhen: { field: 'status', equals: 'archived' }
            }
          },
          associations: {}
        }
        const Form = {
          fields: ['status', 'archive_reason'],
          fieldsets: {
            basic: { title: 'Basic', required: true, fields: ['status', 'archive_reason'] }
          }
        }

        const schema = generateFormSchema(Model, Form)
        const archiveField = schema.fields.find((f) => f.name === 'archive_reason')
        expect(archiveField.visibleWhen).toEqual({
          field: 'status',
          equals: 'archived'
        })
      })

      it('omits visibleWhen when not configured', () => {
        const schema = generateFormSchema(MockModel, MockForm)
        const titleField = schema.fields.find((f) => f.name === 'title')
        expect(titleField.visibleWhen).toBeUndefined()
      })
    })

    describe('FormClass with no fieldsets', () => {
      const SimpleModel = {
        api: { endpoint: 'books' },
        singularName: 'book',
        attributes: {
          id: { type: 'string', prompt_visible: false },
          title: { type: 'string', required: true, description: 'Title', examples: ['Clean Code'] },
          author: { type: 'string', description: 'Author' },
          status: {
            type: 'enum',
            enumValues: ['unread', 'reading', 'completed'],
            default: 'unread'
          },
          rating: { type: 'integer', validation: { min: 1, max: 5 } },
          location_id: { type: 'integer', label: 'Location' },
          created_at: { type: 'datetime', prompt_visible: false }
        },
        associations: {
          belongsTo: { location: { rel: 'location', target_model: 'location' } }
        }
      }

      const SimpleForm = {
        fields: ['title', 'author', 'status', 'rating', 'location_id']
      }

      it('generates schema from FormClass.fields', () => {
        const schema = generateFormSchema(SimpleModel, SimpleForm)
        const fieldNames = schema.fields.map((f) => f.name)
        expect(fieldNames).toEqual(['title', 'author', 'status', 'rating', 'location_id'])
      })

      it('creates a single default fieldset when no fieldsets configured', () => {
        const schema = generateFormSchema(SimpleModel, SimpleForm)
        expect(schema.fieldsets).toHaveLength(1)
        expect(schema.fieldsets[0].title).toBe('Book Details')
        expect(schema.fieldsets[0].groups).toEqual(['default'])
      })

      it('filters out empty fieldsets', () => {
        const FormWithEmptyFieldset = {
          fields: ['title'],
          fieldsets: {
            identity: { title: 'Identity', fields: ['title'] },
            empty: { title: 'Empty', fields: ['nonexistent'] }
          }
        }

        const schema = generateFormSchema(SimpleModel, FormWithEmptyFieldset)
        expect(schema.fieldsets).toHaveLength(1)
        expect(schema.fieldsets[0].key).toBe('identity')
      })

      it('throws when FormClass.fields is empty', () => {
        expect(() => generateFormSchema(SimpleModel, { fields: [] })).toThrow(
          /no AppFormClass\.fields/
        )
      })

      it('throws when FormClass is missing', () => {
        expect(() => generateFormSchema(SimpleModel)).toThrow(/no AppFormClass\.fields/)
      })
    })

    describe('kind → HTML input type (kinds coverage)', () => {
      function fieldFor(attr) {
        const Model = {
          api: { endpoint: 'things' },
          singularName: 'thing',
          attributes: { value: attr }
        }
        const Form = { fields: ['value'] }
        return generateFormSchema(Model, Form).fields[0]
      }

      it('datetime → datetime-local', () => {
        expect(fieldFor({ type: 'datetime', description: '' }).type).toBe('datetime-local')
      })

      it('time → time', () => {
        expect(fieldFor({ type: 'time', description: '' }).type).toBe('time')
      })

      it('decimal → number', () => {
        expect(fieldFor({ type: 'decimal', description: '' }).type).toBe('number')
      })

      it('uuid → text', () => {
        expect(fieldFor({ type: 'uuid', description: '' }).type).toBe('text')
      })

      it('json → textarea', () => {
        expect(fieldFor({ type: 'json', description: '' }).type).toBe('textarea')
      })

      it('color → color', () => {
        expect(fieldFor({ type: 'color', description: '' }).type).toBe('color')
      })

      it('email → email', () => {
        expect(fieldFor({ type: 'email', description: '' }).type).toBe('email')
      })

      it('rating → number', () => {
        expect(fieldFor({ type: 'rating', description: '' }).type).toBe('number')
      })

      it('text → textarea', () => {
        expect(fieldFor({ type: 'text', description: '' }).type).toBe('textarea')
      })
    })
  })
})
