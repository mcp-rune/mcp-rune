import { describe, it, expect } from 'vitest'
import { generateFormSchema } from '../../../../src/mcp/apps/form-schema.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const MockModel = {
  endpoint: 'books',
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

const MockPrompt = {
  title: 'Create Book',
  fieldGroups: {
    identity: {
      fields: ['title', 'author'],
      context: 'Identity',
      required: true
    },
    status: {
      fields: ['status', 'rating', 'formats'],
      context: 'Status'
    },
    media: {
      fields: ['cover_url', 'cover_base64'],
      context: 'Media'
    },
    content: {
      fields: ['description'],
      context: 'Content'
    },
    associations: {
      fields: ['location_id', 'tag_ids'],
      context: 'Associations'
    }
  },
  sections: {
    identity: {
      title: 'Book Identity',
      description: 'Core book info',
      required: true,
      groups: ['identity']
    },
    details: {
      title: 'Details',
      description: 'Status and formats',
      required: false,
      groups: ['status', 'media', 'content']
    },
    organization: {
      title: 'Organization',
      description: 'Location and tags',
      required: false,
      groups: ['associations']
    }
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('lib/mcp/apps/form-schema', () => {
  describe('generateFormSchema', () => {
    it('returns schema with model name', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      expect(schema.model).toBe('book')
    })

    it('returns schema with title from prompt', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      expect(schema.title).toBe('Create Book')
    })

    it('returns fieldsets from sections', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      expect(schema.fieldsets).toHaveLength(3)
      expect(schema.fieldsets[0]).toEqual({
        key: 'identity',
        title: 'Book Identity',
        description: 'Core book info',
        required: true,
        groups: ['identity']
      })
    })

    it('excludes fields with prompt_visible: false', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const fieldNames = schema.fields.map((f) => f.name)
      expect(fieldNames).not.toContain('id')
      expect(fieldNames).not.toContain('created_at')
    })

    it('maps string type to text', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const titleField = schema.fields.find((f) => f.name === 'title')
      expect(titleField.type).toBe('text')
    })

    it('maps text type to textarea', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const descField = schema.fields.find((f) => f.name === 'description')
      expect(descField.type).toBe('textarea')
    })

    it('maps integer type to number', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const ratingField = schema.fields.find((f) => f.name === 'rating')
      expect(ratingField.type).toBe('number')
    })

    it('maps enum type to select with options', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
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
      const schema = generateFormSchema(MockModel, MockPrompt)
      const formatsField = schema.fields.find((f) => f.name === 'formats')
      expect(formatsField.type).toBe('checkbox_group')
      expect(formatsField.options).toEqual([
        { value: 'physical', label: 'Physical' },
        { value: 'ebook', label: 'Ebook' },
        { value: 'pdf', label: 'Pdf' }
      ])
    })

    it('maps format: URL to url type', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const coverField = schema.fields.find((f) => f.name === 'cover_url')
      expect(coverField.type).toBe('url')
    })

    it('maps format: base64 to file type', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const base64Field = schema.fields.find((f) => f.name === 'cover_base64')
      expect(base64Field.type).toBe('file')
    })

    it('maps belongsTo association to select with association metadata', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const locationField = schema.fields.find((f) => f.name === 'location_id')
      expect(locationField.type).toBe('select')
      expect(locationField.association).toEqual({
        endpoint: 'locations',
        labelField: 'name'
      })
    })

    it('maps hasMany association to multiselect with association metadata', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const tagField = schema.fields.find((f) => f.name === 'tag_ids')
      expect(tagField.type).toBe('multiselect')
      expect(tagField.association).toEqual({
        endpoint: 'tags',
        labelField: 'name'
      })
    })

    it('preserves required flag', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const titleField = schema.fields.find((f) => f.name === 'title')
      const authorField = schema.fields.find((f) => f.name === 'author')
      expect(titleField.required).toBe(true)
      expect(authorField.required).toBe(false)
    })

    it('preserves validation constraints', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const ratingField = schema.fields.find((f) => f.name === 'rating')
      expect(ratingField.validation).toEqual({ min: 1, max: 5 })
    })

    it('generates placeholder from examples', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const titleField = schema.fields.find((f) => f.name === 'title')
      expect(titleField.placeholder).toBe('e.g. Clean Code')
    })

    it('uses custom label when provided', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const coverField = schema.fields.find((f) => f.name === 'cover_url')
      expect(coverField.label).toBe('Cover URL')
    })

    it('humanizes field name when no label', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const authorField = schema.fields.find((f) => f.name === 'author')
      expect(authorField.label).toBe('Author')
    })

    it('humanizes _id suffix in label', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const locationField = schema.fields.find((f) => f.name === 'location_id')
      expect(locationField.label).toBe('Location')
    })

    it('assigns group key to each field', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const titleField = schema.fields.find((f) => f.name === 'title')
      const statusField = schema.fields.find((f) => f.name === 'status')
      expect(titleField.group).toBe('identity')
      expect(statusField.group).toBe('status')
    })

    it('preserves field ordering from fieldGroups', () => {
      const schema = generateFormSchema(MockModel, MockPrompt)
      const fieldNames = schema.fields.map((f) => f.name)
      const titleIdx = fieldNames.indexOf('title')
      const authorIdx = fieldNames.indexOf('author')
      const statusIdx = fieldNames.indexOf('status')
      expect(titleIdx).toBeLessThan(authorIdx)
      expect(authorIdx).toBeLessThan(statusIdx)
    })

    describe('association transformers', () => {
      const TransformerModel = {
        endpoint: 'schedulings',
        singularName: 'scheduling',
        attributes: {
          put_up: { type: 'date', required: true, description: 'Start date' },
          take_down: { type: 'date', required: true, description: 'End date' },
          external_id: { type: 'string', description: 'External ID' }
        },
        associations: {}
      }

      const TransformerPrompt = {
        title: 'Create Scheduling',
        fieldGroups: {
          platform: { fields: ['platform_link'], context: 'Platform' },
          content: { fields: ['content_type', 'content_id'], context: 'Content' },
          dates: { fields: ['put_up', 'take_down'], context: 'Dates' },
          optional: { fields: ['external_id'], context: 'Optional' }
        },
        sections: {
          platform: { title: 'Platform', required: true, groups: ['platform'] },
          content: { title: 'Content', required: true, groups: ['content'] },
          dates: { title: 'Dates', required: true, groups: ['dates'] },
          optional: { title: 'Optional', required: false, groups: ['optional'] }
        },
        associationTransformers: {
          platform: {
            type: 'select',
            source: { model: 'platform' },
            targetField: 'platform_link',
            valueField: 'self_link',
            labelField: 'name'
          },
          content_selection: {
            type: 'autocomplete',
            source: { group: 'catalogue' },
            targetFields: ['content_type', 'content_id'],
            transform: {
              content_type: { from: 'entityType' },
              content_id: { from: 'id' }
            }
          }
        }
      }

      it('renders select transformer as select field with association metadata', () => {
        const schema = generateFormSchema(TransformerModel, TransformerPrompt)
        const platformField = schema.fields.find((f) => f.name === 'platform_link')
        expect(platformField).toBeDefined()
        expect(platformField.type).toBe('select')
        expect(platformField.association).toEqual({
          endpoint: 'platforms',
          labelField: 'name',
          valueField: 'self_link'
        })
      })

      it('humanizes _link suffix in label', () => {
        const schema = generateFormSchema(TransformerModel, TransformerPrompt)
        const platformField = schema.fields.find((f) => f.name === 'platform_link')
        expect(platformField.label).toBe('Platform')
      })

      it('skips autocomplete transformer fields', () => {
        const schema = generateFormSchema(TransformerModel, TransformerPrompt)
        const fieldNames = schema.fields.map((f) => f.name)
        expect(fieldNames).not.toContain('content_type')
        expect(fieldNames).not.toContain('content_id')
      })

      it('filters out fieldsets where all fields are autocomplete targets', () => {
        const schema = generateFormSchema(TransformerModel, TransformerPrompt)
        const contentFieldset = schema.fieldsets.find((fs) => fs.key === 'content')
        expect(contentFieldset).toBeUndefined()
      })

      it('keeps fieldsets with select transformer fields', () => {
        const schema = generateFormSchema(TransformerModel, TransformerPrompt)
        const platformFieldset = schema.fieldsets.find((fs) => fs.key === 'platform')
        expect(platformFieldset).toBeDefined()
      })

      it('preserves non-transformer model fields', () => {
        const schema = generateFormSchema(TransformerModel, TransformerPrompt)
        const putUpField = schema.fields.find((f) => f.name === 'put_up')
        expect(putUpField).toBeDefined()
        expect(putUpField.type).toBe('date')
      })

      it('propagates valueField from transformer config', () => {
        const schema = generateFormSchema(TransformerModel, TransformerPrompt)
        const platformField = schema.fields.find((f) => f.name === 'platform_link')
        expect(platformField.association.valueField).toBe('self_link')
      })

      it('defaults valueField to id when not specified', () => {
        const PromptWithIdDefault = {
          ...TransformerPrompt,
          associationTransformers: {
            platform: {
              type: 'select',
              source: { model: 'platform' },
              targetField: 'platform_link',
              labelField: 'name'
            }
          }
        }
        const schema = generateFormSchema(TransformerModel, PromptWithIdDefault)
        const platformField = schema.fields.find((f) => f.name === 'platform_link')
        expect(platformField.association.valueField).toBe('id')
      })

      it('skips multi_select transformer fields', () => {
        const PromptWithMultiSelect = {
          ...TransformerPrompt,
          fieldGroups: {
            ...TransformerPrompt.fieldGroups,
            platforms: { fields: ['selected_platforms'], context: 'Platforms' }
          },
          sections: {
            ...TransformerPrompt.sections,
            platforms: { title: 'Platforms', required: false, groups: ['platforms'] }
          },
          associationTransformers: {
            ...TransformerPrompt.associationTransformers,
            platforms: {
              type: 'multi_select',
              source: { model: 'platform' },
              targetField: 'selected_platforms',
              valueField: 'self_link',
              labelField: 'name'
            }
          }
        }
        const schema = generateFormSchema(TransformerModel, PromptWithMultiSelect)
        const fieldNames = schema.fields.map((f) => f.name)
        expect(fieldNames).not.toContain('selected_platforms')
      })

      it('works with no associationTransformers (backward compatible)', () => {
        const NoTransformerPrompt = {
          title: 'Create Item',
          fieldGroups: { basic: { fields: ['external_id'], context: 'Basic' } },
          sections: { basic: { title: 'Basic', required: true, groups: ['basic'] } }
        }
        const schema = generateFormSchema(TransformerModel, NoTransformerPrompt)
        expect(schema.fields).toHaveLength(1)
        expect(schema.fields[0].name).toBe('external_id')
      })
    })

    describe('empty fieldset filtering', () => {
      it('filters out fieldsets when all group fields are missing from attributes', () => {
        const Model = {
          endpoint: 'items',
          singularName: 'item',
          attributes: {
            name: { type: 'string', required: true }
          },
          associations: {}
        }
        const Prompt = {
          fieldGroups: {
            basic: { fields: ['name'], context: 'Basic' },
            relations: { fields: ['platform_link', 'content_link'], context: 'Relations' }
          },
          sections: {
            basic: { title: 'Basic Info', required: true, groups: ['basic'] },
            relations: { title: 'Relations', required: false, groups: ['relations'] }
          }
        }

        const schema = generateFormSchema(Model, Prompt)
        expect(schema.fieldsets).toHaveLength(1)
        expect(schema.fieldsets[0].key).toBe('basic')
      })

      it('keeps fieldsets with mixed fields when some are renderable', () => {
        const Model = {
          endpoint: 'items',
          singularName: 'item',
          attributes: {
            name: { type: 'string' },
            status: { type: 'enum', enumValues: ['active', 'inactive'] }
          },
          associations: {}
        }
        const Prompt = {
          fieldGroups: {
            basic: { fields: ['name', 'missing_field'], context: 'Basic' },
            meta: { fields: ['status'], context: 'Meta' }
          },
          sections: {
            info: { title: 'Info', required: true, groups: ['basic', 'meta'] }
          }
        }

        const schema = generateFormSchema(Model, Prompt)
        expect(schema.fieldsets).toHaveLength(1)
        expect(schema.fields).toHaveLength(2)
      })

      it('works normally when all fields are in attributes', () => {
        const schema = generateFormSchema(MockModel, MockPrompt)
        expect(schema.fieldsets).toHaveLength(3)
      })
    })

    describe('conditional visibility', () => {
      it('passes visibleWhen from attribute config to field schema', () => {
        const Model = {
          endpoint: 'items',
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
        const Prompt = {
          fieldGroups: {
            basic: { fields: ['status', 'archive_reason'], context: 'Basic' }
          },
          sections: { basic: { title: 'Basic', required: true, groups: ['basic'] } }
        }

        const schema = generateFormSchema(Model, Prompt)
        const archiveField = schema.fields.find((f) => f.name === 'archive_reason')
        expect(archiveField.visibleWhen).toEqual({
          field: 'status',
          equals: 'archived'
        })
      })

      it('omits visibleWhen when not configured', () => {
        const schema = generateFormSchema(MockModel, MockPrompt)
        const titleField = schema.fields.find((f) => f.name === 'title')
        expect(titleField.visibleWhen).toBeUndefined()
      })
    })

    describe('FormClass mode', () => {
      const SimpleModel = {
        endpoint: 'books',
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

      const SimpleFormClass = {
        fields: ['title', 'author', 'status', 'rating', 'location_id']
      }

      it('generates schema from FormClass.fields', () => {
        const schema = generateFormSchema(SimpleModel, SimpleFormClass)
        const fieldNames = schema.fields.map((f) => f.name)
        expect(fieldNames).toEqual(['title', 'author', 'status', 'rating', 'location_id'])
      })

      it('excludes fields not in FormClass.fields', () => {
        const schema = generateFormSchema(SimpleModel, SimpleFormClass)
        const fieldNames = schema.fields.map((f) => f.name)
        expect(fieldNames).not.toContain('id')
        expect(fieldNames).not.toContain('created_at')
      })

      it('creates a single default fieldset when no fieldsets configured', () => {
        const schema = generateFormSchema(SimpleModel, SimpleFormClass)
        expect(schema.fieldsets).toHaveLength(1)
        expect(schema.fieldsets[0].title).toBe('Book Details')
        expect(schema.fieldsets[0].groups).toEqual(['default'])
      })

      it('preserves field types and metadata', () => {
        const schema = generateFormSchema(SimpleModel, SimpleFormClass)
        const titleField = schema.fields.find((f) => f.name === 'title')
        expect(titleField.type).toBe('text')
        expect(titleField.required).toBe(true)
        expect(titleField.placeholder).toBe('e.g. Clean Code')

        const statusField = schema.fields.find((f) => f.name === 'status')
        expect(statusField.type).toBe('select')
        expect(statusField.default).toBe('unread')
      })

      it('detects associations from model', () => {
        const schema = generateFormSchema(SimpleModel, SimpleFormClass)
        const locationField = schema.fields.find((f) => f.name === 'location_id')
        expect(locationField.type).toBe('select')
        expect(locationField.association).toEqual({
          endpoint: 'locations',
          labelField: 'name'
        })
      })

      it('supports FormClass.fieldsets for custom layout', () => {
        const FormWithFieldsets = {
          fields: ['title', 'author', 'status', 'rating', 'location_id'],
          fieldsets: {
            identity: { title: 'Identity', fields: ['title', 'author'], required: true },
            details: { title: 'Details', fields: ['status', 'rating', 'location_id'] }
          }
        }

        const schema = generateFormSchema(SimpleModel, FormWithFieldsets)
        expect(schema.fieldsets).toHaveLength(2)
        expect(schema.fieldsets[0].title).toBe('Identity')
        expect(schema.fieldsets[0].required).toBe(true)
        expect(schema.fieldsets[1].title).toBe('Details')

        const titleField = schema.fields.find((f) => f.name === 'title')
        expect(titleField.group).toBe('identity')
        const statusField = schema.fields.find((f) => f.name === 'status')
        expect(statusField.group).toBe('details')
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

      it('returns empty schema when no FormClass or PromptClass', () => {
        const schema = generateFormSchema(SimpleModel)
        expect(schema.fields).toHaveLength(0)
        expect(schema.fieldsets).toHaveLength(0)
      })
    })
  })
})
