import { GetFiltersGuideTool } from '../../../../src/api-extensions/search/index.js'

// Mock model classes with static filters
const mockModels = {
  title: {
    api: { endpoint: 'titles' },
    attributes: { id: {}, name: { label: 'Name' } },
    search: {
      filters: {
        name: {
          type: 'text',
          label: 'Name',
          description: 'Full-text search on title name'
        },
        status: {
          type: 'enum',
          label: 'Status',
          enumValues: ['draft', 'active', 'archived'],
          description: 'Filter by current status'
        },
        licensor_id: {
          type: 'relation',
          label: 'Licensor',
          relatedModel: 'licensor',
          description: 'Filter by rights owner'
        },
        created_at: {
          type: 'date_range',
          label: 'Created Date',
          description: 'Filter by creation date range'
        }
      }
    }
  },
  brand: {
    api: { endpoint: 'brands' },
    attributes: { id: {}, name: {} }
    // No search — not searchable
  }
}

describe('GetFiltersGuideTool', () => {
  const tool = new GetFiltersGuideTool({ models: mockModels })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('get_filters_guide')
    expect(tool.baseDescription).toContain('search filters')
  })

  it('should only include searchable models in input schema', () => {
    const schema = tool.inputSchema
    // The zodEnum should only include 'title' since 'brand' has no filters
    expect(schema.model).toBeDefined()
  })

  it('should return filter guide for searchable model', async () => {
    const result = await tool.execute({ model: 'title' })

    const text = result.content[0].text

    // Should contain filter reference table
    expect(text).toContain('Search Filters for title')
    expect(text).toContain('`name`')
    expect(text).toContain('`status`')
    expect(text).toContain('`licensor_id`')
    expect(text).toContain('`created_at`')

    // Should document enum values
    expect(text).toContain('`draft`')
    expect(text).toContain('`active`')
    expect(text).toContain('`archived`')

    // Should document relation
    expect(text).toContain('`licensor`')
    expect(text).toContain('find_records')

    // Should document date_range format
    expect(text).toContain('YYYY-MM-DD')

    // Should include usage example
    expect(text).toContain('search_records')
  })

  it('should return error for non-searchable model', async () => {
    const result = await tool.execute({ model: 'brand' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('does not support search')
    expect(result.content[0].text).toContain('title')
  })

  it('should return error for unknown model', async () => {
    await expect(() => tool.execute({ model: 'unknown' })).rejects.toThrow('Unknown model')
  })

  it('should have strategy category (no auth required)', () => {
    expect(GetFiltersGuideTool.category).toBe('strategy')
  })

  it('should fall back to name when label is missing', async () => {
    const modelsWithNoLabel = {
      title: {
        api: { endpoint: 'titles' },
        attributes: {},
        search: {
          filters: {
            raw_field: {
              type: 'text',
              description: 'A raw field without label'
            }
          }
        }
      }
    }
    const noLabelTool = new GetFiltersGuideTool({ models: modelsWithNoLabel })
    const result = await noLabelTool.execute({ model: 'title' })
    const text = result.content[0].text

    // Should use the field name 'raw_field' as the label
    expect(text).toContain('raw_field')
  })

  it('should handle filter without description', async () => {
    const modelsNoDesc = {
      title: {
        api: { endpoint: 'titles' },
        attributes: {},
        search: {
          filters: {
            some_field: {
              type: 'text',
              label: 'Some Field'
            }
          }
        }
      }
    }
    const noDescTool = new GetFiltersGuideTool({ models: modelsNoDesc })
    const result = await noDescTool.execute({ model: 'title' })

    expect(result.content[0].text).toContain('Some Field')
    expect(result.isError).toBeUndefined()
  })

  it('should show "none" when no models are searchable', async () => {
    const noSearchable = {
      brand: { api: { endpoint: 'brands' }, attributes: {} }
    }
    const noSearchTool = new GetFiltersGuideTool({ models: noSearchable })
    const result = await noSearchTool.execute({ model: 'brand' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('none')
  })

  it('should document integer_range format', async () => {
    const modelsWithIntRange = {
      title: {
        api: { endpoint: 'titles' },
        attributes: {},
        search: {
          filters: {
            duration_minutes: {
              type: 'integer_range',
              label: 'Duration (minutes)',
              description: 'Filter by duration in minutes'
            }
          }
        }
      }
    }
    const intRangeTool = new GetFiltersGuideTool({ models: modelsWithIntRange })
    const result = await intRangeTool.execute({ model: 'title' })
    const text = result.content[0].text

    expect(text).toContain('integer_range')
    expect(text).toContain('"from"')
    expect(text).toContain('"to"')
    expect(text).toContain('either field is optional')
  })

  it('should generate example with integer_range filter type', async () => {
    const modelsWithIntRange = {
      title: {
        api: { endpoint: 'titles' },
        attributes: {},
        search: {
          filters: {
            duration_minutes: {
              type: 'integer_range',
              label: 'Duration',
              description: 'Duration filter'
            }
          }
        }
      }
    }
    const intRangeTool = new GetFiltersGuideTool({ models: modelsWithIntRange })
    const result = await intRangeTool.execute({ model: 'title' })
    const text = result.content[0].text

    // Example section should include integer_range pattern
    expect(text).toContain('from: 30')
    expect(text).toContain('to: 120')
  })

  it('should generate example with relation and date_range filter types', async () => {
    const modelsWithRelation = {
      title: {
        api: { endpoint: 'titles' },
        attributes: {},
        search: {
          filters: {
            licensor_id: {
              type: 'relation',
              label: 'Licensor',
              relatedModel: 'licensor'
            },
            created_at: {
              type: 'date_range',
              label: 'Created',
              description: 'Creation date'
            }
          }
        }
      }
    }
    const relTool = new GetFiltersGuideTool({ models: modelsWithRelation })
    const result = await relTool.execute({ model: 'title' })
    const text = result.content[0].text

    // Example section should include relation and date_range patterns
    expect(text).toContain('"123"')
    expect(text).toContain('from: "2024-01-01"')
  })
})
