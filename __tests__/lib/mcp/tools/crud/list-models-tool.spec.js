import { describe, it, expect } from 'vitest'
import { ListModelsTool } from '../../../../../src/mcp/tools/crud/list-models-tool.js'

describe('lib/mcp/tools/crud/list-models-tool', () => {
  describe('description composition', () => {
    it('should include serverContext scope in description', () => {
      const tool = new ListModelsTool({
        serverContext: { name: 'Engineer' }
      })
      expect(tool.baseDescription).toContain('Engineer')
    })
  })

  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new ListModelsTool({})
      expect(tool.name).toBe('list_models')
    })

    it('should have correct base description', () => {
      const tool = new ListModelsTool({})
      expect(tool.baseDescription).toContain('List all available models')
    })

    it('should have empty inputSchema', () => {
      const tool = new ListModelsTool({})
      expect(Object.keys(tool.inputSchema)).toEqual([])
    })
  })

  describe('execute', () => {
    it('should return list of models', async () => {
      const mockModels = {
        activity: {
          endpoint: 'activities',
          attributes: { title: { type: 'string', required: true }, duration: { type: 'integer' } },
          required: ['title'],
          search: { autocompleteFields: ['title'] },
          description: 'Study session model'
        },
        book: {
          endpoint: 'books',
          attributes: { title: { type: 'string', required: true }, author: { type: 'string' } },
          required: ['title'],
          search: { autocompleteFields: ['title'] },
          description: 'Book model'
        }
      }

      const tool = new ListModelsTool({ models: mockModels })
      const result = await tool.execute()

      expect(result.isError).toBeFalsy()
      const content = JSON.parse(result.content[0].text)
      expect(content.length).toBe(2)

      const modelNames = content.map((m) => m.name)
      expect(modelNames).toContain('activity')
      expect(modelNames).toContain('book')
    })

    it('should include model associations when available', async () => {
      const mockModels = {
        category: {
          endpoint: 'categories',
          attributes: { name: { type: 'string', required: true } },
          required: ['name'],
          search: { autocompleteFields: ['name'] },
          description: 'Category model',
          associations: {
            belongsTo: { theme: { rel: 'theme', target_model: 'theme' } },
            hasMany: { books: { rel: 'books', target_model: 'book' } }
          }
        }
      }

      const tool = new ListModelsTool({ models: mockModels })
      const result = await tool.execute()

      const content = JSON.parse(result.content[0].text)
      expect(content[0].belongs_to).toEqual(['theme'])
      expect(content[0].has_many).toEqual(['books'])
    })

    it('should handle models without associations', async () => {
      const mockModels = {
        tag: {
          endpoint: 'tags',
          attributes: { name: { type: 'string', required: true } },
          required: ['name'],
          search: { autocompleteFields: ['name'] },
          description: 'Tag model'
        }
      }

      const tool = new ListModelsTool({ models: mockModels })
      const result = await tool.execute()

      const content = JSON.parse(result.content[0].text)
      expect(content[0].belongs_to).toBeUndefined()
      expect(content[0].has_many).toBeUndefined()
    })

    it('should include filterable_search when model has filters', async () => {
      const mockModels = {
        title: {
          endpoint: 'titles',
          attributes: { name: { type: 'string' } },
          required: ['name'],
          search: {
            autocompleteFields: ['name'],
            filters: {
              name: { type: 'text', label: 'Name' },
              status: { type: 'enum', label: 'Status', enumValues: ['draft', 'active'] }
            }
          },
          description: 'Title model'
        }
      }

      const tool = new ListModelsTool({ models: mockModels })
      const result = await tool.execute()

      const content = JSON.parse(result.content[0].text)
      expect(content[0].filterable_search).toEqual({
        available: true,
        filter_count: 2,
        hint: 'Call get_filters_guide for filter docs, then use search_records'
      })
    })

    it('should return enum_fields as array of field names, not full enum objects', async () => {
      const mockModels = {
        title: {
          endpoint: 'titles',
          attributes: {
            name: { type: 'string' },
            status: { type: 'enum', enumValues: ['draft', 'active'] },
            priority: { type: 'enum', enumValues: ['low', 'medium', 'high'] }
          },
          required: ['name'],
          description: 'Title model'
        }
      }

      const tool = new ListModelsTool({ models: mockModels })
      const result = await tool.execute()

      const content = JSON.parse(result.content[0].text)
      expect(content[0].enum_fields).toEqual(['status', 'priority'])
      // Must be an array of strings, not objects with enum values
      expect(content[0].enum_fields.every((f) => typeof f === 'string')).toBe(true)
    })

    it('should not include filterable_search when model has no filters', async () => {
      const mockModels = {
        book: {
          endpoint: 'books',
          attributes: { title: { type: 'string' } },
          required: ['title'],
          search: { autocompleteFields: ['title'] },
          description: 'Book model'
        }
      }

      const tool = new ListModelsTool({ models: mockModels })
      const result = await tool.execute()

      const content = JSON.parse(result.content[0].text)
      expect(content[0].filterable_search).toBeUndefined()
    })
  })
})
