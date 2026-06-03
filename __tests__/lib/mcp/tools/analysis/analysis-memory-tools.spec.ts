// Mock memory storage
vi.mock('#src/services/vector-storage.js', () => ({
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
  clearAnalysisMemories: vi.fn(() => Promise.resolve(3)),
  clearIngestedRecords: vi.fn(() => Promise.resolve(10)),
  clearIngestedEdges: vi.fn(() => Promise.resolve(7)),
  queryIngestedData: vi.fn(() => Promise.resolve([]))
}))

import {
  clearAnalysisMemories,
  clearIngestedEdges,
  clearIngestedRecords,
  queryIngestedData,
  recallAnalysisMemories,
  storeAnalysisMemory
} from '#src/services/vector-storage.js'

import { AnalysisClearTool } from '../../../../../src/mcp/tools/analysis/analysis-clear-tool.js'
import { AnalysisQueryTool } from '../../../../../src/mcp/tools/analysis/analysis-query-tool.js'
import { AnalysisStoreTool } from '../../../../../src/mcp/tools/analysis/analysis-store-tool.js'

describe('Analysis Memory Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AnalysisStoreTool', () => {
    const tool = new AnalysisStoreTool({})

    it('should have correct metadata', () => {
      expect(tool.name).toBe('analysis_store')
      expect(AnalysisStoreTool.requiresVectorStorage).toBe(true)
      expect(AnalysisStoreTool.requiresAuth).toBe(false)
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
    })

    it('should have baseDescription mentioning insights and max batch size', () => {
      expect(tool.baseDescription).toContain('qualitative')
      expect(tool.baseDescription).toContain('25')
    })
  })

  describe('AnalysisQueryTool', () => {
    const tool = new AnalysisQueryTool({})

    it('should have correct metadata', () => {
      expect(tool.name).toBe('analysis_query')
      expect(AnalysisQueryTool.requiresVectorStorage).toBe(true)
      expect(AnalysisQueryTool.requiresAuth).toBe(false)
    })

    describe('semantic mode', () => {
      it('should recall by analysis ID and query', async () => {
        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'semantic',
          query: 'missing data'
        })

        expect(recallAnalysisMemories).toHaveBeenCalledWith(
          { analysisId: 'test', query: 'missing data' },
          {}
        )

        expect(result.content[0].text).toContain('2 finding(s)')
        expect(result.content[0].text).toContain('Finding 1')
        expect(result.content[0].text).toContain('Finding 2')
      })

      it('should require query param in semantic mode', async () => {
        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'semantic'
        })

        expect(result.content[0].text).toContain('Please provide')
        expect(recallAnalysisMemories).not.toHaveBeenCalled()
      })

      it('should pass top_k option', async () => {
        await tool.execute({
          analysis_id: 'test',
          mode: 'semantic',
          query: 'test',
          top_k: 100
        })

        expect(recallAnalysisMemories).toHaveBeenCalledWith(expect.anything(), { topK: 100 })
      })

      it('should group results by category', async () => {
        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'semantic',
          query: 'test'
        })

        expect(result.content[0].text).toContain('## gap (2)')
      })

      it('should handle no results', async () => {
        recallAnalysisMemories.mockResolvedValueOnce([])

        const result = await tool.execute({
          analysis_id: 'empty',
          mode: 'semantic',
          query: 'nothing'
        })

        expect(result.content[0].text).toContain('No findings match')
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

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'semantic',
          query: 'missing data'
        })

        expect(result.content[0].text).toContain('92.0% match')
      })

      it('should group uncategorized findings', async () => {
        recallAnalysisMemories.mockResolvedValueOnce([
          { id: 'a1', analysisId: 'test', finding: 'No category', createdAt: new Date() }
        ])

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'semantic',
          query: 'test'
        })

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

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'semantic',
          query: 'test'
        })

        expect(result.content[0].text).toContain('"count":5')
      })

      it('should not show metadata marker when absent', async () => {
        recallAnalysisMemories.mockResolvedValueOnce([
          {
            id: 'a1',
            analysisId: 'test',
            finding: 'No meta',
            category: 'gap',
            createdAt: new Date()
          }
        ])

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'semantic',
          query: 'test'
        })

        expect(result.content[0].text).toContain('No meta')
        expect(result.content[0].text).not.toContain(' | ')
      })

      it('should pass category filter', async () => {
        await tool.execute({
          analysis_id: 'test',
          mode: 'semantic',
          query: 'test',
          category: 'gap'
        })

        expect(recallAnalysisMemories).toHaveBeenCalledWith(
          { analysisId: 'test', category: 'gap', query: 'test' },
          {}
        )
      })
    })

    describe('aggregate mode', () => {
      it('should require group_by param', async () => {
        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'aggregate'
        })

        expect(result.content[0].text).toContain('Please provide')
      })

      it('should return distribution', async () => {
        queryIngestedData.mockResolvedValueOnce([
          { value: 'active', count: 100 },
          { value: 'draft', count: 50 }
        ])

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'aggregate',
          group_by: 'status'
        })

        expect(queryIngestedData).toHaveBeenCalledWith('test', {
          mode: 'aggregate',
          groupBy: 'status'
        })
        expect(result.content[0].text).toContain('active: 100')
        expect(result.content[0].text).toContain('draft: 50')
        expect(result.content[0].text).toContain('150 total')
      })

      it('should handle no data', async () => {
        queryIngestedData.mockResolvedValueOnce([])

        const result = await tool.execute({
          analysis_id: 'empty',
          mode: 'aggregate',
          group_by: 'status'
        })

        expect(result.content[0].text).toContain('No ingested records')
        expect(result.content[0].text).toContain('analysis_ingest')
      })
    })

    describe('filter mode', () => {
      it('should require where param', async () => {
        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'filter'
        })

        expect(result.content[0].text).toContain('Please provide')
      })

      it('should return matching records', async () => {
        queryIngestedData.mockResolvedValueOnce([
          { id: '1', name: 'Deal A', status: 'active' },
          { id: '2', name: 'Deal B', status: 'active' }
        ])

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'filter',
          where: { status: 'active' },
          limit: 10
        })

        expect(queryIngestedData).toHaveBeenCalledWith('test', {
          mode: 'filter',
          where: { status: 'active' },
          limit: 10
        })
        expect(result.content[0].text).toContain('Deal A')
      })

      it('should handle no matches', async () => {
        queryIngestedData.mockResolvedValueOnce([])

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'filter',
          where: { status: 'nonexistent' }
        })

        expect(result.content[0].text).toContain('No records match')
      })
    })

    describe('sample mode', () => {
      it('should return random records', async () => {
        queryIngestedData.mockResolvedValueOnce([
          { id: '1', name: 'Sample A' },
          { id: '2', name: 'Sample B' }
        ])

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'sample',
          sample_size: 2
        })

        expect(queryIngestedData).toHaveBeenCalledWith('test', {
          mode: 'sample',
          sampleSize: 2,
          stratifyBy: undefined,
          where: undefined,
          proximity: undefined
        })
        expect(result.content[0].text).toContain('Sample A')
      })

      it('should pass stratify_by for stratified sampling', async () => {
        queryIngestedData.mockResolvedValueOnce([
          { id: '1', name: 'Active Record', status: 'active' },
          { id: '2', name: 'Draft Record', status: 'draft' }
        ])

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'sample',
          sample_size: 4,
          stratify_by: 'status'
        })

        expect(queryIngestedData).toHaveBeenCalledWith('test', {
          mode: 'sample',
          sampleSize: 4,
          stratifyBy: 'status',
          where: undefined,
          proximity: undefined
        })
        expect(result.content[0].text).toContain('Active Record')
        expect(result.content[0].text).toContain('Draft Record')
      })

      it('should pass where for pre-filtered sampling', async () => {
        queryIngestedData.mockResolvedValueOnce([
          { id: '1', name: 'Null Status Record', status: null }
        ])

        const where = { status: null }
        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'sample',
          sample_size: 5,
          where
        })

        expect(queryIngestedData).toHaveBeenCalledWith('test', {
          mode: 'sample',
          sampleSize: 5,
          stratifyBy: undefined,
          where,
          proximity: undefined
        })
        expect(result.content[0].text).toContain('Null Status Record')
      })

      it('should pass proximity for date-windowed sampling', async () => {
        queryIngestedData.mockResolvedValueOnce([
          { id: '1', created_at: '2026-03-14', name: 'Day Before' },
          { id: '2', created_at: '2026-03-16', name: 'Day After' }
        ])

        const proximity = {
          field: 'created_at',
          origin: '2026-03-15',
          window: '7 days',
          bucket: '1 day'
        }

        const result = await tool.execute({
          analysis_id: 'test',
          mode: 'sample',
          sample_size: 10,
          proximity
        })

        expect(queryIngestedData).toHaveBeenCalledWith('test', {
          mode: 'sample',
          sampleSize: 10,
          stratifyBy: undefined,
          where: undefined,
          proximity
        })
        expect(result.content[0].text).toContain('Day Before')
        expect(result.content[0].text).toContain('Day After')
      })

      it('should compose where + proximity + stratify_by', async () => {
        queryIngestedData.mockResolvedValueOnce([
          { id: '1', status: 'active', created_at: '2026-03-14' }
        ])

        const where = { category: 'episode' }
        const proximity = {
          field: 'created_at',
          origin: '2026-03-15',
          window: '14 days',
          bucket: '1 week'
        }

        await tool.execute({
          analysis_id: 'test',
          mode: 'sample',
          sample_size: 8,
          stratify_by: 'status',
          where,
          proximity
        })

        expect(queryIngestedData).toHaveBeenCalledWith('test', {
          mode: 'sample',
          sampleSize: 8,
          stratifyBy: 'status',
          where,
          proximity
        })
      })

      it('should handle no data', async () => {
        queryIngestedData.mockResolvedValueOnce([])

        const result = await tool.execute({
          analysis_id: 'empty',
          mode: 'sample'
        })

        expect(result.content[0].text).toContain('No ingested records')
      })
    })

    it('should have input schema with all mode params', () => {
      const schema = tool.inputSchema
      expect(schema.analysis_id).toBeDefined()
      expect(schema.mode).toBeDefined()
      expect(schema.query).toBeDefined()
      expect(schema.category).toBeDefined()
      expect(schema.top_k).toBeDefined()
      expect(schema.group_by).toBeDefined()
      expect(schema.where).toBeDefined()
      expect(schema.limit).toBeDefined()
      expect(schema.sample_size).toBeDefined()
      expect(schema.stratify_by).toBeDefined()
      expect(schema.proximity).toBeDefined()
    })

    it('should have baseDescription mentioning all four modes', () => {
      expect(tool.baseDescription).toContain('semantic')
      expect(tool.baseDescription).toContain('aggregate')
      expect(tool.baseDescription).toContain('filter')
      expect(tool.baseDescription).toContain('sample')
    })
  })

  describe('AnalysisClearTool', () => {
    const tool = new AnalysisClearTool({})

    it('should have correct metadata', () => {
      expect(tool.name).toBe('analysis_clear')
      expect(AnalysisClearTool.requiresVectorStorage).toBe(true)
      expect(AnalysisClearTool.requiresAuth).toBe(false)
    })

    it('should cascade-clear analysis memories, ingested records, and edges', async () => {
      const result = await tool.execute({
        analysis_id: 'audit-2024'
      })

      expect(clearAnalysisMemories).toHaveBeenCalledWith('audit-2024')
      expect(clearIngestedRecords).toHaveBeenCalledWith('audit-2024')
      expect(clearIngestedEdges).toHaveBeenCalledWith('audit-2024')
      expect(result.content[0].text).toContain('10 ingested record(s)')
      expect(result.content[0].text).toContain('7 edge(s)')
      expect(result.content[0].text).toContain('3 finding(s)')
      expect(result.content[0].text).toContain('audit-2024')
    })

    it('should have input schema and baseDescription', () => {
      const schema = tool.inputSchema
      expect(schema.analysis_id).toBeDefined()
      expect(tool.baseDescription).toContain('Clean up')
      expect(tool.baseDescription).toContain('ingested records')
      expect(tool.baseDescription).toContain('findings')
    })
  })
})
