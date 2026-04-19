import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import {
  describeAnalysisSession,
  queryIngestedData,
  recallAnalysisMemories
} from '#src/services/vector-storage.js'

import type { ToolResult } from '../base-tool.js'
import { BaseAnalysisTool } from './base-analysis-tool.js'

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
 * Supports five query modes:
 *   - describe: Discover available fields, types, and query syntax
 *   - semantic: Search findings and page summaries by meaning
 *   - aggregate: Get counts and distributions by field
 *   - filter: Find specific records matching exact criteria or range conditions
 *   - sample: Get a random sample of records
 */
export class AnalysisQueryTool extends BaseAnalysisTool {
  override get name(): string {
    return 'analysis_query'
  }

  override get baseDescription(): string {
    return `Query ingested data and stored findings from an analysis session. Supports five modes for different types of reasoning:

- describe: Discover available fields, their types, and query syntax. Call this before querying to understand the data shape and learn which operators are available.
- semantic: Search findings and page summaries by meaning. Use when asking qualitative questions ("what issues were found?", "any patterns related to missing data?").
- aggregate: Get counts and distributions by field. Use for quantitative questions ("how many records per status?", "what's the distribution of types?").
- filter: Find specific records matching criteria. Supports exact match and range operators ($gt, $gte, $lt, $lte) for numeric and date fields.
- sample: Get a sample of records. Use stratify_by to ensure minority groups are represented — distributes sample slots evenly across distinct values of a field. Without stratify_by, returns a uniform random sample.

Typical reasoning flow:
1. Start with describe to discover available fields and query syntax
2. Use aggregate to understand distributions
3. Use filter (with range operators) to inspect specific subsets
4. Use sample to spot-check representative records
5. Use semantic to recall your own stored findings or search page summaries`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      analysis_id: z.string().describe('Analysis session ID to query'),
      mode: z
        .enum(['describe', 'semantic', 'aggregate', 'filter', 'sample'])
        .describe(
          'Query mode: "describe" for field/operator discovery, "semantic" for meaning-based search, "aggregate" for counts/distributions, "filter" for exact/range matches, "sample" for random records'
        ),

      // semantic mode params
      query: z.string().optional().describe('Semantic search query (required for semantic mode)'),
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
          'Filter criteria. Exact match: {"status": "active"}. ' +
            'Range: {"duration_minutes": {"$gte": 40, "$lte": 120}}. ' +
            'Date range: {"started_at": {"$gte": "2026-01-01"}}. ' +
            'Operators: $gt, $gte, $lt, $lte.'
        ),
      limit: z.number().optional().describe('Max records to return (filter mode, default: 20)'),

      // sample mode params
      sample_size: z.number().optional().describe('Sample size (sample mode, default: 5)'),
      stratify_by: z
        .string()
        .optional()
        .describe(
          'Field to stratify by (sample mode). Distributes sample slots evenly across distinct values of this field, ensuring minority groups are represented. E.g., "status" ensures each status value appears in the sample.'
        )
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
      sample_size,
      stratify_by
    } = args as {
      analysis_id: string
      mode: 'describe' | 'semantic' | 'aggregate' | 'filter' | 'sample'
      query?: string
      category?: string
      top_k?: number
      group_by?: string
      where?: Record<string, unknown>
      limit?: number
      sample_size?: number
      stratify_by?: string
    }

    switch (mode) {
      case 'describe':
        return this._queryDescribe(analysis_id)
      case 'semantic':
        return this._querySemantic(analysis_id, query, category, top_k)
      case 'aggregate':
        return this._queryAggregate(analysis_id, group_by)
      case 'filter':
        return this._queryFilter(analysis_id, where, limit)
      case 'sample':
        return this._querySample(analysis_id, sample_size, stratify_by)
    }
  }

  /** Describe analysis session — returns fields, types, and query syntax from model config */
  private async _queryDescribe(analysisId: string): Promise<ToolResult> {
    const session = await describeAnalysisSession(analysisId)

    if (!session) {
      return this.formatResponse(
        `No ingested records found for analysis "${analysisId}". Run analysis_ingest first.`
      )
    }

    const { model, totalRecords } = session
    const modelConfig = this.getModelConfig(model)

    const parts: string[] = [
      `# Analysis Session: ${analysisId}`,
      `Model: ${model} | Records: ${totalRecords}`,
      ''
    ]

    if (modelConfig?.attributes) {
      const attrs = modelConfig.attributes as Record<string, Record<string, unknown>>
      parts.push('## Available Fields', '')
      parts.push('| Field | Type | Description |')
      parts.push('|-------|------|-------------|')

      const numericFields: string[] = []
      const dateFields: string[] = []
      const enumFields: string[] = []

      for (const [name, config] of Object.entries(attrs)) {
        const type = (config.type as string) || 'unknown'
        const desc = (config.description as string) || ''
        let details = desc

        if (type === 'enum' && config.enumValues) {
          const values = (config.enumValues as string[]).map((v) => `\`${v}\``).join(', ')
          details += ` Values: ${values}`
          enumFields.push(name)
        }

        parts.push(`| \`${name}\` | ${type} | ${details} |`)

        if (type === 'integer' || type === 'number' || type === 'float') {
          numericFields.push(name)
        }
        if (type === 'datetime' || type === 'date') {
          dateFields.push(name)
        }
      }

      parts.push('')

      // Query syntax section with concrete examples from this model's fields
      parts.push('## Query Syntax', '')

      if (enumFields.length > 0) {
        const field = enumFields[0]!
        const config = attrs[field]!
        const values = config.enumValues as string[] | undefined
        const exampleValue = values?.[0] || 'value'
        parts.push('### Exact match')
        parts.push(`\`{"${field}": "${exampleValue}"}\``)
        parts.push('')
      } else {
        parts.push('### Exact match')
        parts.push('`{"field_name": "value"}`')
        parts.push('')
      }

      if (numericFields.length > 0) {
        const field = numericFields[0]!
        parts.push('### Numeric range')
        parts.push(`\`{"${field}": {"$gte": 40, "$lte": 120}}\``)
        parts.push('')
      }

      if (dateFields.length > 0) {
        const field = dateFields[0]!
        parts.push('### Date range')
        parts.push(`\`{"${field}": {"$gte": "2026-01-01", "$lte": "2026-03-31"}}\``)
        parts.push('')
      }

      parts.push('### Combined')
      const exampleParts: string[] = []
      if (enumFields.length > 0) {
        const config = attrs[enumFields[0]!]!
        const values = config.enumValues as string[] | undefined
        exampleParts.push(`"${enumFields[0]}": "${values?.[0] || 'value'}"`)
      }
      if (numericFields.length > 0) {
        exampleParts.push(`"${numericFields[0]}": {"$gte": 60}`)
      }
      if (exampleParts.length > 0) {
        parts.push(`\`{${exampleParts.join(', ')}}\``)
      } else {
        parts.push('`{"field": "value", "numeric_field": {"$gte": 10}}`')
      }
      parts.push('')
      parts.push('Operators: `$gt` (>), `$gte` (>=), `$lt` (<), `$lte` (<=)')
    } else {
      parts.push(
        `Model "${model}" has no attribute metadata. Use sample mode to inspect record shape.`
      )
    }

    return this.formatResponse(parts.join('\n'))
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
  private async _queryAggregate(analysisId: string, groupBy?: string): Promise<ToolResult> {
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

  /** Sample records from ingested_records — supports stratified sampling */
  private async _querySample(
    analysisId: string,
    sampleSize?: number,
    stratifyBy?: string
  ): Promise<ToolResult> {
    const results = await queryIngestedData(analysisId, {
      mode: 'sample',
      sampleSize,
      stratifyBy
    })

    if (results.length === 0) {
      return this.formatResponse(
        `No ingested records found for analysis "${analysisId}". Run analysis_ingest first.`
      )
    }

    return this.formatResponse(results as unknown as Record<string, unknown>)
  }
}
