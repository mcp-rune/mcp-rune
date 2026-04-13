import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock memory storage
vi.mock('#lib/services/memory-storage.js', () => ({
  storeAnalysisMemory: vi.fn(() => Promise.resolve('uuid-123')),
  recallAnalysisMemories: vi.fn(() =>
    Promise.resolve([
      {
        id: 'a1',
        analysisId: 'test',
        finding: 'Finding 1',
        category: 'gap',
        metadata: { count: 5 },
        createdAt: new Date()
      },
      { id: 'a2', analysisId: 'test', finding: 'Finding 2', category: 'gap', createdAt: new Date() }
    ])
  ),
  clearAnalysisMemories: vi.fn(() => Promise.resolve(3))
}))

import { StoreAnalysisMemoryTool } from '../../../../../../lib/mcp/tools/memory/analysis/store-analysis-memory-tool.js'
import { RecallAnalysisMemoriesTool } from '../../../../../../lib/mcp/tools/memory/analysis/recall-analysis-memories-tool.js'
import { ClearAnalysisMemoriesTool } from '../../../../../../lib/mcp/tools/memory/analysis/clear-analysis-memories-tool.js'
import {
  storeAnalysisMemory,
  recallAnalysisMemories,
  clearAnalysisMemories
} from '#lib/services/memory-storage.js'
import { TOOL_CATEGORIES } from '../../../../../../lib/mcp/tools/categories.js'

describe('Analysis Memory Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('StoreAnalysisMemoryTool', () => {
    const tool = new StoreAnalysisMemoryTool({})

    it('should have correct metadata', () => {
      expect(tool.name).toBe('store_analysis_memory')
      expect(StoreAnalysisMemoryTool.category).toBe(TOOL_CATEGORIES.MEMORY)
      expect(StoreAnalysisMemoryTool.requiresAuth).toBe(false)
    })

    it('should store a single finding via findings array', async () => {
      const result = await tool.execute({
        analysis_id: 'audit-2024',
        findings: [
          {
            finding: 'Missing metadata on 15 titles',
            category: 'gap',
            metadata: { count: 15 }
          }
        ]
      })

      expect(storeAnalysisMemory).toHaveBeenCalledTimes(1)
      expect(storeAnalysisMemory).toHaveBeenCalledWith({
        analysisId: 'audit-2024',
        finding: 'Missing metadata on 15 titles',
        category: 'gap',
        metadata: { count: 15 },
        persistent: undefined
      })

      expect(result.content[0].text).toContain('1 analysis finding(s)')
      expect(result.content[0].text).toContain('uuid-123')
      expect(result.content[0].text).toContain('ephemeral')
    })

    it('should store multiple findings in one call', async () => {
      storeAnalysisMemory
        .mockResolvedValueOnce('id-1')
        .mockResolvedValueOnce('id-2')
        .mockResolvedValueOnce('id-3')

      const result = await tool.execute({
        analysis_id: 'reclassify-2026',
        findings: [
          { finding: 'Theme A: 5 activities', category: 'Theme A', metadata: { count: 5 } },
          { finding: 'Theme B: 3 activities', category: 'Theme B', metadata: { count: 3 } },
          { finding: 'Misclassified: 2 activities', category: 'Misclassified' }
        ]
      })

      expect(storeAnalysisMemory).toHaveBeenCalledTimes(3)
      expect(result.content[0].text).toContain('3 analysis finding(s)')
      expect(result.content[0].text).toContain('id-1')
      expect(result.content[0].text).toContain('id-2')
      expect(result.content[0].text).toContain('id-3')
    })

    it('should include unique categories in response', async () => {
      storeAnalysisMemory.mockResolvedValueOnce('id-1').mockResolvedValueOnce('id-2')

      const result = await tool.execute({
        analysis_id: 'audit-2024',
        findings: [
          { finding: 'F1', category: 'gap' },
          { finding: 'F2', category: 'duplicate' }
        ]
      })

      expect(result.content[0].text).toContain('Categories: gap, duplicate')
    })

    it('should omit category line when no categories provided', async () => {
      const result = await tool.execute({
        analysis_id: 'audit-2024',
        findings: [{ finding: 'Finding without category' }]
      })

      expect(result.content[0].text).not.toContain('Categories:')
    })

    it('should indicate persistent storage', async () => {
      const result = await tool.execute({
        analysis_id: 'audit-2024',
        findings: [{ finding: 'Important finding' }],
        persistent: true
      })

      expect(storeAnalysisMemory).toHaveBeenCalledWith(
        expect.objectContaining({ persistent: true })
      )
      expect(result.content[0].text).toContain('persistent')
    })

    it('should signal consumed:true in _meta for transient context protocol', async () => {
      const result = await tool.execute({
        analysis_id: 'audit-2024',
        findings: [{ finding: 'A finding' }]
      })

      expect(result._meta).toEqual({ context: { consumed: true } })
    })

    it('should have findings array in input schema', () => {
      const schema = tool.inputSchema
      expect(schema.analysis_id).toBeDefined()
      expect(schema.findings).toBeDefined()
      expect(schema.persistent).toBeDefined()
      // Old single-finding params should not exist
      expect(schema.finding).toBeUndefined()
      expect(schema.scratch_ref).toBeUndefined()
    })

    it('should have baseDescription mentioning batching', () => {
      expect(tool.baseDescription).toContain('qualitative analysis')
      expect(tool.baseDescription).toContain('25')
    })
  })

  describe('RecallAnalysisMemoriesTool', () => {
    const tool = new RecallAnalysisMemoriesTool({})

    it('should have correct metadata', () => {
      expect(tool.name).toBe('recall_analysis_memories')
      expect(RecallAnalysisMemoriesTool.category).toBe(TOOL_CATEGORIES.MEMORY)
    })

    it('should recall by analysis ID', async () => {
      const result = await tool.execute({
        analysis_id: 'test'
      })

      expect(recallAnalysisMemories).toHaveBeenCalledWith({ analysisId: 'test' }, {})

      expect(result.content[0].text).toContain('2 finding(s)')
      expect(result.content[0].text).toContain('Finding 1')
      expect(result.content[0].text).toContain('Finding 2')
    })

    it('should recall by semantic query', async () => {
      await tool.execute({
        query: 'missing metadata'
      })

      expect(recallAnalysisMemories).toHaveBeenCalledWith({ query: 'missing metadata' }, {})
    })

    it('should require either analysis_id or query', async () => {
      const result = await tool.execute({})

      expect(result.content[0].text).toContain('Please provide')
      expect(recallAnalysisMemories).not.toHaveBeenCalled()
    })

    it('should pass top_k option', async () => {
      await tool.execute({
        analysis_id: 'test',
        top_k: 100
      })

      expect(recallAnalysisMemories).toHaveBeenCalledWith(expect.anything(), { topK: 100 })
    })

    it('should group results by category', async () => {
      const result = await tool.execute({ analysis_id: 'test' })

      expect(result.content[0].text).toContain('## gap (2)')
    })

    it('should handle no results', async () => {
      recallAnalysisMemories.mockResolvedValueOnce([])

      const result = await tool.execute({ analysis_id: 'empty' })

      expect(result.content[0].text).toContain('No analysis findings found')
    })

    it('should show similarity scores when present', async () => {
      recallAnalysisMemories.mockResolvedValueOnce([
        {
          id: 'a1',
          analysisId: 'test',
          finding: 'Semantic match',
          category: 'gap',
          similarity: 0.92,
          createdAt: new Date()
        }
      ])

      const result = await tool.execute({ query: 'missing data' })

      expect(result.content[0].text).toContain('92.0% match')
    })

    it('should group uncategorized findings', async () => {
      recallAnalysisMemories.mockResolvedValueOnce([
        { id: 'a1', analysisId: 'test', finding: 'No category', createdAt: new Date() }
      ])

      const result = await tool.execute({ analysis_id: 'test' })

      expect(result.content[0].text).toContain('## uncategorized (1)')
    })

    it('should show metadata in output when present', async () => {
      recallAnalysisMemories.mockResolvedValueOnce([
        {
          id: 'a1',
          analysisId: 'test',
          finding: 'With meta',
          category: 'gap',
          metadata: { count: 5 },
          createdAt: new Date()
        }
      ])

      const result = await tool.execute({ analysis_id: 'test' })

      expect(result.content[0].text).toContain('"count":5')
    })

    it('should not show metadata marker when absent', async () => {
      recallAnalysisMemories.mockResolvedValueOnce([
        { id: 'a1', analysisId: 'test', finding: 'No meta', category: 'gap', createdAt: new Date() }
      ])

      const result = await tool.execute({ analysis_id: 'test' })

      // Should have the finding but no " | " metadata separator
      expect(result.content[0].text).toContain('No meta')
      expect(result.content[0].text).not.toContain(' | ')
    })

    it('should pass category filter', async () => {
      await tool.execute({
        analysis_id: 'test',
        category: 'gap'
      })

      expect(recallAnalysisMemories).toHaveBeenCalledWith(
        { analysisId: 'test', category: 'gap' },
        {}
      )
    })

    it('should have input schema and baseDescription', () => {
      const schema = tool.inputSchema
      expect(schema.analysis_id).toBeDefined()
      expect(schema.query).toBeDefined()
      expect(schema.category).toBeDefined()
      expect(schema.top_k).toBeDefined()
      expect(tool.baseDescription).toContain('analysis')
    })
  })

  describe('ClearAnalysisMemoriesTool', () => {
    const tool = new ClearAnalysisMemoriesTool({})

    it('should have correct metadata', () => {
      expect(tool.name).toBe('clear_analysis_memories')
      expect(ClearAnalysisMemoriesTool.category).toBe(TOOL_CATEGORIES.MEMORY)
    })

    it('should clear and return count', async () => {
      const result = await tool.execute({
        analysis_id: 'audit-2024'
      })

      expect(clearAnalysisMemories).toHaveBeenCalledWith('audit-2024')
      expect(result.content[0].text).toContain('3 finding(s)')
      expect(result.content[0].text).toContain('audit-2024')
    })

    it('should have input schema and baseDescription', () => {
      const schema = tool.inputSchema
      expect(schema.analysis_id).toBeDefined()
      expect(tool.baseDescription).toContain('Clear')
    })
  })
})
