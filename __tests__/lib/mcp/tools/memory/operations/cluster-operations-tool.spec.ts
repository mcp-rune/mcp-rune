
vi.mock('#src/services/memory-storage.js', () => ({
  getOperationClusters: vi.fn()
}))

import { ClusterOperationsTool } from '../../../../../../src/mcp/tools/memory/operations/cluster-operations-tool.js'
import { getOperationClusters } from '#src/services/memory-storage.js'
import { TOOL_CATEGORIES } from '../../../../../../src/mcp/tools/categories.js'

describe('ClusterOperationsTool', () => {
  let tool

  beforeEach(() => {
    vi.clearAllMocks()
    tool = new ClusterOperationsTool({ serverContext: {} })
  })

  it('should have correct name', () => {
    expect(tool.name).toBe('cluster_operations')
  })

  it('should have MEMORY category', () => {
    expect(ClusterOperationsTool.category).toBe(TOOL_CATEGORIES.MEMORY)
  })

  it('should have no required parameters', () => {
    const schema = tool.inputSchema
    expect(schema.days.isOptional()).toBe(true)
    expect(schema.tool_name.isOptional()).toBe(true)
    expect(schema.min_cluster_size.isOptional()).toBe(true)
  })

  it('should have tool_name filter instead of model_name', () => {
    const schema = tool.inputSchema
    expect(schema.tool_name).toBeDefined()
    expect(schema.model_name).toBeUndefined()
  })

  it('should format clusters and outliers with tool output', async () => {
    getOperationClusters.mockResolvedValue({
      clusters: [
        {
          representative: 'create_model deal operations',
          toolName: 'create_model',
          count: 3,
          operations: [
            {
              toolName: 'create_model',
              summary: 'create_model deal A',
              createdAt: '2025-01-15T10:00:00Z',
              toolOutput: { id: '1', name: 'Deal A' }
            },
            {
              toolName: 'create_model',
              summary: 'create_model deal B',
              createdAt: '2025-01-15T11:00:00Z',
              toolOutput: { id: '2', name: 'Deal B' }
            },
            {
              toolName: 'create_model',
              summary: 'create_model deal C',
              createdAt: '2025-01-15T12:00:00Z'
            }
          ]
        }
      ],
      outliers: [{ toolName: 'delete_model', summary: 'delete_model brand X' }]
    })

    const result = await tool.execute({ days: 7 })

    expect(getOperationClusters).toHaveBeenCalledWith({ days: 7 }, {})
    expect(result.content[0].text).toContain('1 cluster(s)')
    expect(result.content[0].text).toContain('3 operations')
    expect(result.content[0].text).toContain('Outliers (1)')
    // Operations with toolOutput should show Output:
    expect(result.content[0].text).toContain('Output:')
    expect(result.content[0].text).toContain('"id":"1"')
  })

  it('should pass filters and options', async () => {
    getOperationClusters.mockResolvedValue({ clusters: [], outliers: [] })

    await tool.execute({
      days: 14,
      tool_name: 'create_model',
      min_cluster_size: 3
    })

    expect(getOperationClusters).toHaveBeenCalledWith(
      { days: 14, toolName: 'create_model' },
      { minClusterSize: 3 }
    )
  })

  it('should handle no operations', async () => {
    getOperationClusters.mockResolvedValue({ clusters: [], outliers: [] })

    const result = await tool.execute({})

    expect(result.content[0].text).toContain('No operations found')
  })
})
