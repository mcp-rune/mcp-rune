import { z } from 'zod'
import { BaseMemoryTool } from '../base-memory-tool.js'
import type { ToolResult } from '../../base-tool.js'
import type { ZodTypeAny } from 'zod'
import { recallAnalysisMemories, queryIngestedData } from '#src/services/memory-storage.js'

interface AnalysisMemory {
  finding: string
  category?: string
  metadata?: Record<string, unknown>
  similarity?: number
}

/**
 * Unified query tool for analysis sessions.
 *
 * Part of the analysis_* tool family:
 *   analysis_ingest → analysis_store → analysis_query → analysis_clear
 *
 * Supports four query modes:
 *   - semantic: Search findings and page summaries by meaning
 *   - aggregate: Get counts and distributions by field
 *   - filter: Find specific records matching exact criteria
 *   - sample: Get a random sample of records
 */
export class AnalysisQueryTool extends BaseMemoryTool {
  override get name(): string {
    return 'analysis_query'
  }

  override get baseDescription(): string {
    return `Query ingested data and stored findings from an analysis session. Supports four modes for different types of reasoning:

- semantic: Search findings and page summaries by meaning. Use when asking qualitative questions ("what issues were found?", "any patterns related to missing data?").
- aggregate: Get counts and distributions by field. Use for quantitative questions ("how many records per status?", "what's the distribution of types?").
- filter: Find specific records matching exact criteria. Use to inspect records that match a condition ("show me all archived deals", "find records with status=draft").
- sample: Get a random sample of records. Use to get a representative overview before diving deeper.

Typical reasoning flow:
1. Start with aggregate to understand the shape of the data
2. Use filter to inspect specific subsets
3. Use sample to spot-check representative records
4. Use semantic to recall your own stored findings or search page summaries`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      analysis_id: z.string().describe('Analysis session ID to query'),
      mode: z
        .enum(['semantic', 'aggregate', 'filter', 'sample'])
        .describe(
          'Query mode: "semantic" for meaning-based search, "aggregate" for counts/distributions, "filter" for exact matches, "sample" for random records'
        ),

      // semantic mode params
      query: z
        .string()
        .optional()
        .describe('Semantic search query (required for semantic mode)'),
      category: z.string().optional().describe('Filter by finding category (semantic mode)'),
      top_k: z.number().optional().describe('Maximum results (semantic mode, default: 50)'),

      // aggregate mode params
      group_by: z
        .string()
        .optional()
        .describe('Field to group by, e.g., "status" (required for aggregate mode)'),

      // filter mode params
      where: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'JSONB containment filter, e.g., {"status": "active"} (required for filter mode)'
        ),
      limit: z.number().optional().describe('Max records to return (filter mode, default: 20)'),

      // sample mode params
      sample_size: z.number().optional().describe('Random sample size (sample mode, default: 5)')
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const {
      analysis_id,
      mode,
      query,
      category,
      top_k,
      group_by,
      where,
      limit,
      sample_size
    } = args as {
      analysis_id: string
      mode: 'semantic' | 'aggregate' | 'filter' | 'sample'
      query?: string
      category?: string
      top_k?: number
      group_by?: string
      where?: Record<string, unknown>
      limit?: number
      sample_size?: number
    }

    switch (mode) {
      case 'semantic':
        return this._querySemantic(analysis_id, query, category, top_k)
      case 'aggregate':
        return this._queryAggregate(analysis_id, group_by)
      case 'filter':
        return this._queryFilter(analysis_id, where, limit)
      case 'sample':
        return this._querySample(analysis_id, sample_size)
    }
  }

  /** Semantic search on analysis_memories (findings + page summaries) */
  private async _querySemantic(
    analysisId: string,
    query?: string,
    category?: string,
    topK?: number
  ): Promise<ToolResult> {
    if (!query) {
      return this.formatResponse(
        'Please provide a "query" parameter for semantic mode (e.g., "missing metadata").'
      )
    }

    const filters: Record<string, unknown> = { analysisId }
    if (category) filters.category = category
    filters.query = query

    const options: Record<string, unknown> = {}
    if (topK) options.topK = topK

    const memories = (await recallAnalysisMemories(filters, options)) as unknown as AnalysisMemory[]

    if (memories.length === 0) {
      return this.formatResponse('No findings match the query.')
    }

    // Group by category if present
    const byCategory: Record<string, AnalysisMemory[]> = {}
    for (const m of memories) {
      const cat = m.category || 'uncategorized'
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat]!.push(m)
    }

    const parts: string[] = [`Found ${memories.length} finding(s):\n`]
    for (const [cat, items] of Object.entries(byCategory)) {
      parts.push(`## ${cat} (${items!.length})`)
      for (const item of items!) {
        const meta = item.metadata ? ` | ${JSON.stringify(item.metadata)}` : ''
        const sim =
          item.similarity !== undefined ? ` [${(item.similarity * 100).toFixed(1)}% match]` : ''
        parts.push(`- ${item.finding}${meta}${sim}`)
      }
      parts.push('')
    }

    return this.formatResponse(parts.join('\n'))
  }

  /** Aggregate query on ingested_records */
  private async _queryAggregate(
    analysisId: string,
    groupBy?: string
  ): Promise<ToolResult> {
    if (!groupBy) {
      return this.formatResponse(
        'Please provide a "group_by" parameter for aggregate mode (e.g., "status").'
      )
    }

    const results = await queryIngestedData(analysisId, {
      mode: 'aggregate',
      groupBy
    })

    if (results.length === 0) {
      return this.formatResponse(
        `No ingested records found for analysis "${analysisId}". Run analysis_ingest first.`
      )
    }

    // Format as a compact distribution
    const distribution: Record<string, number> = {}
    let total = 0
    for (const row of results) {
      const key = (row.value as string) ?? 'null'
      const count = row.count as number
      distribution[key] = count
      total += count
    }

    const lines = Object.entries(distribution)
      .sort(([, a], [, b]) => b - a)
      .map(([val, count]) => `  ${val}: ${count} (${((count / total) * 100).toFixed(1)}%)`)

    return this.formatResponse(
      `Distribution of "${groupBy}" (${total} total):\n${lines.join('\n')}`
    )
  }

  /** Filter query on ingested_records */
  private async _queryFilter(
    analysisId: string,
    where?: Record<string, unknown>,
    limit?: number
  ): Promise<ToolResult> {
    if (!where || Object.keys(where).length === 0) {
      return this.formatResponse(
        'Please provide a "where" parameter for filter mode (e.g., {"status": "active"}).'
      )
    }

    const results = await queryIngestedData(analysisId, {
      mode: 'filter',
      where,
      limit
    })

    if (results.length === 0) {
      return this.formatResponse(
        `No records match the filter ${JSON.stringify(where)} in analysis "${analysisId}".`
      )
    }

    return this.formatResponse(results as unknown as Record<string, unknown>)
  }

  /** Sample random records from ingested_records */
  private async _querySample(
    analysisId: string,
    sampleSize?: number
  ): Promise<ToolResult> {
    const results = await queryIngestedData(analysisId, {
      mode: 'sample',
      sampleSize
    })

    if (results.length === 0) {
      return this.formatResponse(
        `No ingested records found for analysis "${analysisId}". Run analysis_ingest first.`
      )
    }

    return this.formatResponse(results as unknown as Record<string, unknown>)
  }
}
