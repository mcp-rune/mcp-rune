import { SearchRecordsTool } from '../../../../src/api-extensions/search/index.js'

// Mock model classes with search.filters and search.query config
const mockModels = {
  title: {
    api: { endpoint: 'titles' },
    attributes: {
      id: { prompt_visible: false },
      name: { label: 'Name', type: 'string' },
      status: { label: 'Status', type: 'enum' }
    },
    search: {
      query: {
        endpoint: 'titles/search',
        method: 'POST',
        queryParam: 'q'
      },
      filters: {
        name: { type: 'text', label: 'Name', description: 'Search by name' },
        status: { type: 'enum', label: 'Status', enumValues: ['draft', 'active'] }
      }
    }
  },
  brand: {
    api: { endpoint: 'brands' },
    attributes: { id: {}, name: {} }
    // No search
  }
}

describe('SearchRecordsTool', () => {
  let tool
  let mockApiClient

  beforeEach(() => {
    mockApiClient = {
      post: vi.fn().mockResolvedValue({
        records: [{ id: '1', name: 'Test Title' }],
        pagination: { page: 1, per_page: 50, total: 1 }
      }),
      get: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, per_page: 20, total: 0 } })
    }
    tool = new SearchRecordsTool({
      models: mockModels,
      apiClient: mockApiClient,
      logger: { info: vi.fn(), error: vi.fn() }
    })
  })

  it('should have correct metadata', () => {
    expect(tool.name).toBe('search_records')
    expect(tool.baseDescription).toContain('raw JSON')
    expect(tool.baseDescription).toContain('search_records_app')
  })

  it('should have usage rules mentioning get_filters_guide', () => {
    const rules = tool.getUsageRules()
    expect(rules[0]).toContain('get_filters_guide')
  })

  it('should search with valid filters', async () => {
    const result = await tool.execute({
      model: 'title',
      filters: { name: 'Breaking Bad', status: 'active' },
      page: 1,
      per_page: 50
    })

    expect(mockApiClient.post).toHaveBeenCalledWith('titles/search', {
      name: 'Breaking Bad',
      status: 'active',
      page: 1,
      per_page: 50
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.schema).toBeDefined()
    expect(data.records).toHaveLength(1)
    expect(data.pagination).toBeDefined()
  })

  it('should reject unknown filters', async () => {
    const result = await tool.execute({
      model: 'title',
      filters: { unknown_field: 'value' }
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown filter(s)')
    expect(result.content[0].text).toContain('unknown_field')
    expect(result.content[0].text).toContain('get_filters_guide')
    expect(mockApiClient.post).not.toHaveBeenCalled()
  })

  it('should reject non-searchable models', async () => {
    const result = await tool.execute({
      model: 'brand',
      filters: {}
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('does not support search')
  })

  it('should clamp per_page to 200', async () => {
    await tool.execute({
      model: 'title',
      filters: { name: 'test' },
      per_page: 500
    })

    expect(mockApiClient.post).toHaveBeenCalledWith('titles/search', {
      name: 'test',
      page: 1,
      per_page: 200
    })
  })

  it('should build schema from model attributes', async () => {
    const result = await tool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.schema.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'name', label: 'Name' }),
        expect.objectContaining({ key: 'status', label: 'Status' })
      ])
    )
    // id has prompt_visible: false, should be excluded
    expect(data.schema.columns.find((c) => c.key === 'id')).toBeUndefined()
  })

  it('should require authentication', async () => {
    const unauthTool = new SearchRecordsTool({ models: mockModels })

    const result = await unauthTool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('authenticated')
  })

  it('should handle API errors gracefully', async () => {
    mockApiClient.post.mockRejectedValue(new Error('API timeout'))

    const result = await tool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('API timeout')
  })

  it('should include server context in description when available', () => {
    const scopedTool = new SearchRecordsTool({
      models: mockModels,
      serverContext: { name: 'Test Server' }
    })

    expect(scopedTool.baseDescription).toContain('Test Server')
  })

  it('should handle response with data instead of records', async () => {
    mockApiClient.post.mockResolvedValue({
      data: [{ id: '1', name: 'Via data' }],
      pagination: { page: 1, per_page: 50, total: 1 }
    })

    const result = await tool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.records).toEqual([{ id: '1', name: 'Via data' }])
  })

  it('should fall back to response itself when no records/data key', async () => {
    mockApiClient.post.mockResolvedValue([{ id: '1', name: 'Raw array' }])

    const result = await tool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.records).toEqual([{ id: '1', name: 'Raw array' }])
  })

  it('should construct pagination from total when pagination missing', async () => {
    mockApiClient.post.mockResolvedValue({
      records: [{ id: '1' }],
      total: 42
    })

    const result = await tool.execute({
      model: 'title',
      filters: { name: 'test' },
      page: 2,
      per_page: 25
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.pagination).toEqual({ page: 2, per_page: 25, total: 42 })
  })

  it('should default total to records.length when pagination and total missing', async () => {
    mockApiClient.post.mockResolvedValue({
      records: [{ id: '1' }]
    })

    const result = await tool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.pagination.total).toBe(1)
  })

  it('should reject unknown model', async () => {
    const result = await tool.execute({
      model: 'nonexistent',
      filters: {}
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown model')
  })

  it('should work without logger', async () => {
    const noLogTool = new SearchRecordsTool({
      models: mockModels,
      apiClient: mockApiClient
    })

    const result = await noLogTool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.records).toHaveLength(1)
  })

  it('should default per_page and page', async () => {
    await tool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    expect(mockApiClient.post).toHaveBeenCalledWith('titles/search', {
      name: 'test',
      page: 1,
      per_page: 50
    })
  })

  it('should have model name in schema', async () => {
    const result = await tool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.schema.model).toBe('title')
  })

  it('should use attribute name as label fallback in schema', async () => {
    const modelsNoLabel = {
      title: {
        api: { endpoint: 'titles' },
        attributes: {
          raw_attr: { type: 'string' }
        },
        search: {
          query: {
            endpoint: 'titles/search',
            method: 'POST',
            queryParam: 'q'
          },
          filters: { name: { type: 'text' } }
        }
      }
    }
    const noLabelTool = new SearchRecordsTool({
      models: modelsNoLabel,
      apiClient: mockApiClient,
      logger: { info: vi.fn(), error: vi.fn() }
    })

    const result = await noLabelTool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.schema.columns[0].label).toBe('raw_attr')
    expect(data.schema.columns[0].type).toBe('string')
  })

  it('should default attribute type to string in schema', async () => {
    const modelsNoType = {
      title: {
        api: { endpoint: 'titles' },
        attributes: {
          no_type: { label: 'No Type' }
        },
        search: {
          query: {
            endpoint: 'titles/search',
            method: 'POST',
            queryParam: 'q'
          },
          filters: { name: { type: 'text' } }
        }
      }
    }
    const noTypeTool = new SearchRecordsTool({
      models: modelsNoType,
      apiClient: mockApiClient,
      logger: { info: vi.fn(), error: vi.fn() }
    })

    const result = await noTypeTool.execute({
      model: 'title',
      filters: { name: 'test' }
    })

    const data = JSON.parse(result.content[0].text)
    expect(data.schema.columns[0].type).toBe('string')
  })

  it('should list searchable models in non-searchable error', async () => {
    const result = await tool.execute({
      model: 'brand',
      filters: {}
    })

    expect(result.content[0].text).toContain('title')
  })

  it('should have input schema with all fields', () => {
    const schema = tool.inputSchema
    expect(schema.model).toBeDefined()
    expect(schema.filters).toBeDefined()
    expect(schema.page).toBeDefined()
    expect(schema.per_page).toBeDefined()
  })

  // ============================================================================
  // Enum value validation
  // ============================================================================

  describe('enum value validation', () => {
    it('should reject invalid enum filter value', async () => {
      const result = await tool.execute({
        model: 'title',
        filters: { status: 'invalid_value' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Invalid value(s)')
      expect(result.content[0].text).toContain('"invalid_value"')
      expect(result.content[0].text).toContain('`draft`')
      expect(result.content[0].text).toContain('`active`')
      expect(mockApiClient.post).not.toHaveBeenCalled()
    })

    it('should accept valid enum filter value', async () => {
      const result = await tool.execute({
        model: 'title',
        filters: { status: 'active' }
      })

      expect(result.isError).toBeUndefined()
      expect(mockApiClient.post).toHaveBeenCalled()
    })

    it('should accept valid array of enum values', async () => {
      const result = await tool.execute({
        model: 'title',
        filters: { status: ['draft', 'active'] }
      })

      expect(result.isError).toBeUndefined()
      expect(mockApiClient.post).toHaveBeenCalled()
    })

    it('should reject array with invalid enum value', async () => {
      const result = await tool.execute({
        model: 'title',
        filters: { status: ['active', 'banana'] }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('"banana"')
      expect(mockApiClient.post).not.toHaveBeenCalled()
    })

    it('should not validate non-enum filter values', async () => {
      const result = await tool.execute({
        model: 'title',
        filters: { name: 'anything goes here' }
      })

      expect(result.isError).toBeUndefined()
      expect(mockApiClient.post).toHaveBeenCalled()
    })

    it('should check unknown keys before enum values', async () => {
      const result = await tool.execute({
        model: 'title',
        filters: { nonexistent: 'value' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown filter(s)')
      // Should not get to enum validation
      expect(result.content[0].text).not.toContain('Invalid value(s)')
    })
  })

  // ============================================================================
  // Comma-separated enum normalization
  // ============================================================================

  describe('comma-separated enum normalization', () => {
    it('should normalize comma-separated enum string into array before API call', async () => {
      await tool.execute({
        model: 'title',
        filters: { status: 'draft,active' }
      })

      // The normalized array should be sent to the API
      expect(mockApiClient.post).toHaveBeenCalledWith('titles/search', {
        status: ['draft', 'active'],
        page: 1,
        per_page: 50
      })
    })

    it('should not normalize comma-separated string with invalid segments', async () => {
      const result = await tool.execute({
        model: 'title',
        filters: { status: 'draft,banana' }
      })

      // 'draft,banana' stays as-is, fails enum validation
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Invalid value(s)')
      expect(mockApiClient.post).not.toHaveBeenCalled()
    })

    it('should leave non-enum filters with commas unchanged', async () => {
      await tool.execute({
        model: 'title',
        filters: { name: 'Breaking Bad, The Wire' }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('titles/search', {
        name: 'Breaking Bad, The Wire',
        page: 1,
        per_page: 50
      })
    })
  })

  // ============================================================================
  // fields parameter
  // ============================================================================

  describe('fields parameter', () => {
    it('should return only requested fields in records', async () => {
      mockApiClient.post.mockResolvedValue({
        records: [
          { id: '1', name: 'Breaking Bad', status: 'active', extra: 'noise' },
          { id: '2', name: 'The Wire', status: 'draft', extra: 'noise2' }
        ],
        pagination: { page: 1, per_page: 50, total: 2 }
      })

      const result = await tool.execute({
        model: 'title',
        filters: { name: 'test' },
        fields: ['name', 'status']
      })

      const data = JSON.parse(result.content[0].text)
      expect(data.records).toEqual([
        { id: '1', name: 'Breaking Bad', status: 'active' },
        { id: '2', name: 'The Wire', status: 'draft' }
      ])
      expect(data.records[0].extra).toBeUndefined()
    })
  })

  // ============================================================================
  // derived field resolution
  // ============================================================================

  describe('derived field resolution', () => {
    it('should resolve derived fields from expanded associations', async () => {
      const modelsWithDerived = {
        scheduling: {
          api: { endpoint: 'schedulings' },
          attributes: {
            id: { prompt_visible: false },
            put_up: { label: 'Put Up', type: 'string' },
            title_name: {
              type: 'string',
              prompt_visible: false,
              derived: { from: 'title', field: 'name' }
            }
          },
          search: {
            query: {
              endpoint: 'schedulings/search',
              method: 'POST',
              queryParam: 'q'
            },
            filters: {
              put_up: { type: 'text', label: 'Put Up' }
            }
          }
        }
      }

      const derivedApiClient = {
        post: vi.fn().mockResolvedValue({
          records: [
            { id: '1', put_up: '2024-01-01', title: { id: 10, name: 'Breaking Bad' } },
            { id: '2', put_up: '2024-02-01', title: { id: 20, name: 'The Wire' } }
          ],
          pagination: { page: 1, per_page: 50, total: 2 }
        })
      }

      const derivedTool = new SearchRecordsTool({
        models: modelsWithDerived,
        apiClient: derivedApiClient,
        logger: { info: vi.fn(), error: vi.fn() }
      })

      const result = await derivedTool.execute({
        model: 'scheduling',
        filters: { put_up: '2024-01-01' }
      })

      const data = JSON.parse(result.content[0].text)
      expect(data.records[0].title_name).toBe('Breaking Bad')
      expect(data.records[1].title_name).toBe('The Wire')
    })

    it('should support fields param with derived fields', async () => {
      const modelsWithDerived = {
        scheduling: {
          api: { endpoint: 'schedulings' },
          attributes: {
            id: { prompt_visible: false },
            put_up: { label: 'Put Up', type: 'string' },
            title_name: {
              type: 'string',
              prompt_visible: false,
              derived: { from: 'title', field: 'name' }
            }
          },
          search: {
            query: {
              endpoint: 'schedulings/search',
              method: 'POST',
              queryParam: 'q'
            },
            filters: {
              put_up: { type: 'text', label: 'Put Up' }
            }
          }
        }
      }

      const derivedApiClient = {
        post: vi.fn().mockResolvedValue({
          records: [{ id: '1', put_up: '2024-01-01', title: { id: 10, name: 'Breaking Bad' } }],
          pagination: { page: 1, per_page: 50, total: 1 }
        })
      }

      const derivedTool = new SearchRecordsTool({
        models: modelsWithDerived,
        apiClient: derivedApiClient,
        logger: { info: vi.fn(), error: vi.fn() }
      })

      const result = await derivedTool.execute({
        model: 'scheduling',
        filters: { put_up: '2024-01-01' },
        fields: ['title_name']
      })

      const data = JSON.parse(result.content[0].text)
      expect(data.records[0]).toEqual({ id: '1', title_name: 'Breaking Bad' })
      expect(data.records[0].put_up).toBeUndefined()
    })
  })
})
