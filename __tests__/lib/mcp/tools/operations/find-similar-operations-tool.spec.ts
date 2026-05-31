vi.mock('#src/services/vector-storage.js', () => ({
  findSimilarOperations: vi.fn()
}))

import { findSimilarOperations } from '#src/services/vector-storage.js'

import { TOOL_CATEGORIES } from '../../../../../src/mcp/tools/categories.js'
import { FindSimilarOperationsTool } from '../../../../../src/mcp/tools/operations/find-similar-operations-tool.js'

describe('FindSimilarOperationsTool', () => {
  let tool

  beforeEach(() => {
    vi.clearAllMocks()
    tool = new FindSimilarOperationsTool({ serverContext: {} })
  })

  it('should have correct name', () => {
    expect(tool.name).toBe('find_similar_operations')
  })

  it('should have OPERATIONS category', () => {
    expect(FindSimilarOperationsTool.category).toBe(TOOL_CATEGORIES.OPERATIONS)
  })

  it('should not require auth', () => {
    expect(FindSimilarOperationsTool.getRequiresAuth()).toBe(false)
  })

  it('should have required query parameter', () => {
    expect(tool.inputSchema.query.isOptional()).toBe(false)
  })

  it('should have tool_name filter instead of model_name and operation_type', () => {
    const schema = tool.inputSchema
    expect(schema.tool_name).toBeDefined()
    expect(schema.model_name).toBeUndefined()
    expect(schema.operation_type).toBeUndefined()
  })

  it('should format results with similarity scores', async () => {
    findSimilarOperations.mockResolvedValue([
      {
        id: '1',
        similarity: 0.92,
        summary: "create_model deal 'BBC Drama'. Fields: name: BBC Drama",
        tool_name: 'create_model',
        tool_args: { model: 'deal', attributes: { name: 'BBC Drama' } },
        tool_output: { id: '123', name: 'BBC Drama', right_type: 'catchup' },
        created_at: '2025-01-15T10:00:00Z'
      }
    ])

    const result = await tool.execute({ query: 'BBC deals' })

    expect(findSimilarOperations).toHaveBeenCalledWith('BBC deals', {}, {})
    expect(result.content[0].text).toContain('92.0% match')
    expect(result.content[0].text).toContain('create_model')
    expect(result.content[0].text).toContain('Output:')
    expect(result.content[0].text).toContain('"id":"123"')
  })

  it('should omit Output line when tool_output is null', async () => {
    findSimilarOperations.mockResolvedValue([
      {
        id: '1',
        similarity: 0.85,
        summary: "delete_model brand '456'",
        tool_name: 'delete_model',
        tool_args: { model: 'brand', id: '456' },
        tool_output: null,
        created_at: '2025-01-15T10:00:00Z'
      }
    ])

    const result = await tool.execute({ query: 'deleted brands' })

    expect(result.content[0].text).not.toContain('Output:')
  })

  it('should pass filters correctly', async () => {
    findSimilarOperations.mockResolvedValue([])

    await tool.execute({
      query: 'test',
      tool_name: 'create_model',
      days: 7,
      top_k: 5
    })

    expect(findSimilarOperations).toHaveBeenCalledWith(
      'test',
      { toolName: 'create_model', days: 7 },
      { topK: 5 }
    )
  })

  it('should handle no results', async () => {
    findSimilarOperations.mockResolvedValue([])

    const result = await tool.execute({ query: 'nonexistent' })

    expect(result.content[0].text).toContain('No similar operations found')
  })
})
