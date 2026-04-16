
vi.mock('#src/services/vector-storage.js', () => ({
  detectOperationGaps: vi.fn()
}))

import { DetectOperationGapsTool } from '../../../../../src/mcp/tools/operations/detect-operation-gaps-tool.js'
import { detectOperationGaps } from '#src/services/vector-storage.js'
import { TOOL_CATEGORIES } from '../../../../../src/mcp/tools/categories.js'

describe('DetectOperationGapsTool', () => {
  let tool

  beforeEach(() => {
    vi.clearAllMocks()
    tool = new DetectOperationGapsTool({ serverContext: {} })
  })

  it('should have correct name', () => {
    expect(tool.name).toBe('detect_operation_gaps')
  })

  it('should have OPERATIONS category', () => {
    expect(DetectOperationGapsTool.category).toBe(TOOL_CATEGORIES.OPERATIONS)
  })

  it('should require record_id, model_name, and expected_steps', () => {
    const schema = tool.inputSchema
    expect(schema.record_id.isOptional()).toBe(false)
    expect(schema.model_name.isOptional()).toBe(false)
    expect(schema.expected_steps.isOptional()).toBe(false)
  })

  it('should report gaps with status', async () => {
    detectOperationGaps.mockResolvedValue([
      { step: 'Set platforms', confidence: 0.2, status: 'missing' },
      { step: 'Add restrictions', confidence: 0.5, status: 'incomplete' }
    ])

    const result = await tool.execute({
      record_id: 'deal-123',
      model_name: 'deal',
      expected_steps: ['Create deal', 'Set platforms', 'Add restrictions']
    })

    expect(result.content[0].text).toContain('2 gap(s)')
    expect(result.content[0].text).toContain('MISSING')
    expect(result.content[0].text).toContain('INCOMPLETE')
    expect(result.content[0].text).toContain('Set platforms')
  })

  it('should pass recordId and modelName filters', async () => {
    detectOperationGaps.mockResolvedValue([])

    await tool.execute({
      record_id: 'deal-123',
      model_name: 'deal',
      expected_steps: ['Create deal']
    })

    expect(detectOperationGaps).toHaveBeenCalledWith(['Create deal'], {
      recordId: 'deal-123',
      modelName: 'deal'
    })
  })

  it('should report all steps completed', async () => {
    detectOperationGaps.mockResolvedValue([])

    const result = await tool.execute({
      record_id: 'deal-123',
      model_name: 'deal',
      expected_steps: ['Create deal', 'Set platforms']
    })

    expect(result.content[0].text).toContain('All 2 expected steps appear to be completed')
  })

  it('should handle empty expected steps', async () => {
    const result = await tool.execute({
      record_id: 'deal-123',
      model_name: 'deal',
      expected_steps: []
    })

    expect(result.content[0].text).toContain('No expected steps provided')
  })
})
