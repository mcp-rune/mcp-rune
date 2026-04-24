import { FindModelTool } from '../../../../../src/mcp/tools/data/find-model-tool.js'

describe('FindModelTool', () => {
  it('should have usage rule directing to analysis_ingest for large datasets', () => {
    const tool = new FindModelTool({ models: {}, serverContext: { appsEnabled: true } })
    const rules = tool.getUsageRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]).toContain('analysis_ingest')
  })

  it('should not cross-reference view tools in description', () => {
    const tool = new FindModelTool({ models: {}, serverContext: { appsEnabled: true } })
    expect(tool.baseDescription).not.toContain('list_records_view')
    expect(tool.baseDescription).not.toContain('search_records_view')
  })

  // ============================================================================
  // fields parameter
  // ============================================================================

  describe('fields parameter', () => {
    const mockModels = {
      brand: {
        api: { endpoint: 'brands' },
        attributes: { id: {}, name: {}, status: {}, extra: {} },
        search: { lookup: { fields: ['name'] } }
      }
    }

    let mockApiClient
    let tool

    beforeEach(() => {
      mockApiClient = {
        get: vi.fn()
      }
      tool = new FindModelTool({
        models: mockModels,
        apiClient: mockApiClient,
        logger: { info: vi.fn() }
      })
    })

    it('should return only requested fields for single record lookup', async () => {
      mockApiClient.get.mockResolvedValue({
        id: '1',
        name: 'Test',
        status: 'active',
        extra: 'noise'
      })

      const result = await tool.execute({
        model: 'brand',
        record_id: '1',
        fields: ['name', 'status']
      })

      const data = JSON.parse(result.content[0].text)
      expect(data).toEqual({ id: '1', name: 'Test', status: 'active' })
      expect(data.extra).toBeUndefined()
    })

    it('should return only requested fields for multi-record search', async () => {
      mockApiClient.get.mockResolvedValue([
        { id: '1', name: 'Brand A', status: 'active', extra: 'noise1' },
        { id: '2', name: 'Brand B', status: 'draft', extra: 'noise2' }
      ])

      const result = await tool.execute({
        model: 'brand',
        search: {},
        fields: ['name']
      })

      const data = JSON.parse(result.content[0].text)
      expect(data).toEqual([
        { id: '1', name: 'Brand A' },
        { id: '2', name: 'Brand B' }
      ])
      expect(data[0].status).toBeUndefined()
      expect(data[0].extra).toBeUndefined()
    })

    it('should return all fields when fields param is omitted', async () => {
      const fullRecord = { id: '1', name: 'Test', status: 'active', extra: 'noise' }
      mockApiClient.get.mockResolvedValue(fullRecord)

      const result = await tool.execute({
        model: 'brand',
        record_id: '1'
      })

      const data = JSON.parse(result.content[0].text)
      expect(data).toEqual(fullRecord)
    })
  })
})
