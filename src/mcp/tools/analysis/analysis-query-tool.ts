import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type { GraphStratifierSpec } from '#src/runtime/vector-storage.js'
import {
  describeAnalysisSession,
  ensureRecordEmbeddings,
  findEdgePaths,
  getSessionGraphInfo,
  queryIngestedData,
  recallAnalysisMemories,
  searchIngestedRecords
} from '#src/runtime/vector-storage.js'

import type { ToolResult } from '../tool-result.js'
import { BaseAnalysisTool } from './base-analysis-tool.js'
import { StratifiersArraySchema, toGraphStratifierSpec } from './stratifier-validator.js'

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
 *   - semantic: Search findings/page summaries (target:'findings') or the
 *     ingested records themselves (target:'records') by meaning
 *   - path: Shortest typed edge chains between two records ("how is A
 *     connected to B")
 *   - aggregate: Get counts and distributions by field
 *   - filter: Find specific records matching exact criteria or range conditions
 *   - sample: Get a random sample of records
 */
export class AnalysisQueryTool extends BaseAnalysisTool {
  override get name(): string {
    return 'analysis_query'
  }

  override get baseDescription(): string {
    return `Query ingested data and stored findings from an analysis session. Supports six modes for different types of reasoning:

- describe: Discover available fields, their types, and query syntax. Call this before querying to understand the data shape and learn which operators are available.
- semantic: Search by meaning. target:'findings' (default) recalls stored findings and page summaries — use for qualitative questions ("what issues were found?"). target:'records' ranks the ingested records themselves by similarity to the query, composable with "where" for hybrid semantic + filter retrieval ("records like X, among status=active").
- aggregate: Get counts and distributions by field. Use for quantitative questions ("how many records per status?", "what's the distribution of types?").
- filter: Find specific records matching criteria. Supports exact match and range operators ($gt, $gte, $lt, $lte) for numeric and date fields.
- sample: Get a sample of records. Supports stratify_by for discrete field stratification, "where" for pre-filtering, and "proximity" for date-windowed sampling with temporal bucket stratification. All three compose freely.
- path: Explain how two records are connected. Walks the session's edge graph (from_model/from_id to to_model/to_id) and returns the shortest typed edge chains, e.g. book/1 —belongsTo:author→ author/7. Requires hop-expanded ingestion (hop_depth > 0).

Typical reasoning flow:
1. Start with describe to discover available fields and query syntax
2. Use aggregate to understand distributions
3. Use filter (with range operators) to inspect specific subsets
4. Use sample to spot-check representative records — use proximity to focus around a date
5. Use semantic to recall stored findings, or with target:'records' to rank the records themselves by meaning
6. Use path to explain how two records are connected through the session's edge graph`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      analysis_id: z.string().describe('Analysis session ID to query'),
      mode: z
        .enum(['describe', 'semantic', 'aggregate', 'filter', 'sample', 'path'])
        .describe(
          'Query mode: "describe" for field/operator discovery, "semantic" for meaning-based search, "aggregate" for counts/distributions, "filter" for exact/range matches, "sample" for random records, "path" for typed edge chains between two records'
        ),

      // semantic mode params
      query: z.string().optional().describe('Semantic search query (required for semantic mode)'),
      category: z.string().optional().describe('Filter by finding category (semantic mode)'),
      target: z
        .enum(['findings', 'records'])
        .optional()
        .describe(
          'Semantic-mode target: "findings" (default) searches stored findings and page summaries; ' +
            '"records" ranks the ingested records themselves by similarity to the query ' +
            '(composable with "where" and "model").'
        ),
      min_similarity: z
        .number()
        .optional()
        .describe(
          'Cosine-similarity floor for semantic target:"records" (0-1). Omit for rank-only.'
        ),
      from_model: this.zodEnum(this.getModelNames())
        .optional()
        .describe('Path mode: source record model'),
      from_id: z.string().optional().describe('Path mode: source record id'),
      to_model: this.zodEnum(this.getModelNames())
        .optional()
        .describe('Path mode: destination record model'),
      to_id: z.string().optional().describe('Path mode: destination record id'),
      max_depth: z
        .number()
        .optional()
        .describe('Path mode: maximum path length in edges (default 4, capped at 6)'),
      top_k: z.number().optional().describe('Maximum results (semantic mode, default: 50)'),
      rerank: z
        .boolean()
        .optional()
        .describe(
          'Semantic target:"records": over-fetch by cosine, then rerank the pool with the ' +
            'local cross-encoder for higher precision (slower). Degrades to cosine order when ' +
            'the model is unavailable.'
        ),

      // aggregate mode params
      group_by: z
        .string()
        .optional()
        .describe('Field to group by, e.g., "status" (required for aggregate mode)'),

      // filter mode params (where also applies to sample mode)
      where: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Filter criteria (filter mode, also accepted in sample mode for pre-filtering). ' +
            'Exact match: {"status": "active"}. ' +
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
        ),
      proximity: z
        .object({
          field: z.string().describe('Date/datetime field to center the window on'),
          origin: z.string().describe('Center date in ISO 8601 format (e.g., "2026-03-15")'),
          window: z
            .string()
            .describe('Time window around origin, e.g., "7 days", "2 weeks", "1 month"'),
          bucket: z
            .string()
            .optional()
            .describe(
              'Bucket interval for temporal stratification within the window (e.g., "1 day", "1 week"). ' +
                'When set, samples are distributed evenly across time buckets. ' +
                'When omitted, uniform random sampling within the window.'
            )
        })
        .optional()
        .describe(
          'Proximity window for date-based sampling (sample mode). Centers on a date and samples within a time window. ' +
            'Combine with "where" to filter first, then sample around a date. ' +
            'E.g., {"field": "created_at", "origin": "2026-03-15", "window": "7 days", "bucket": "1 day"}'
        ),
      stratifiers: StratifiersArraySchema.optional(),
      model: this.zodEnum(this.getModelNames())
        .optional()
        .describe(
          'Model scope for aggregate/filter/sample. Required when the session holds multiple models ' +
            '(hop-expanded ingestion); resolved automatically for single-model sessions. ' +
            'Also the source model for concept stratifiers.'
        )
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const {
      analysis_id,
      mode,
      query,
      category,
      target,
      min_similarity,
      from_model,
      from_id,
      to_model,
      to_id,
      max_depth,
      top_k,
      rerank,
      group_by,
      where,
      limit,
      sample_size,
      stratify_by,
      proximity,
      stratifiers,
      model
    } = args as {
      analysis_id: string
      mode: 'describe' | 'semantic' | 'aggregate' | 'filter' | 'sample' | 'path'
      query?: string
      category?: string
      target?: 'findings' | 'records'
      min_similarity?: number
      from_model?: string
      from_id?: string
      to_model?: string
      to_id?: string
      max_depth?: number
      top_k?: number
      rerank?: boolean
      group_by?: string
      where?: Record<string, unknown>
      limit?: number
      sample_size?: number
      stratify_by?: string
      proximity?: { field: string; origin: string; window: string; bucket?: string }
      stratifiers?: Array<
        | { kind: 'concept'; concept: string }
        | { kind: 'edge'; edge_type: string; bucket?: 'present' | 'count' }
        | { kind: 'cluster'; k: number }
      >
      model?: string
    }

    switch (mode) {
      case 'describe':
        return this._queryDescribe(analysis_id)
      case 'semantic':
        return target === 'records'
          ? this._querySemanticRecords(
              analysis_id,
              query,
              top_k,
              where,
              model,
              min_similarity,
              rerank
            )
          : this._querySemantic(analysis_id, query, category, top_k)
      case 'aggregate':
        return this._queryAggregate(analysis_id, group_by, model)
      case 'filter':
        return this._queryFilter(analysis_id, where, limit, model)
      case 'sample':
        return this._querySample(
          analysis_id,
          sample_size,
          stratify_by,
          where,
          proximity,
          stratifiers,
          model
        )
      case 'path':
        return this._queryPath(analysis_id, from_model, from_id, to_model, to_id, max_depth, top_k)
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

    const { models, totalRecords } = session
    // Field/syntax documentation renders for the session's dominant model;
    // multi-model sessions list every model and the scoping requirement.
    const model = models[0]!.model
    const modelConfig = this.getModelConfig(model)

    const parts: string[] = [
      `# Analysis Session: ${analysisId}`,
      models.length === 1
        ? `Model: ${model} | Records: ${totalRecords}`
        : `Models: ${models.map((m) => `${m.model} (${m.count})`).join(', ')} | Records: ${totalRecords}`,
      ''
    ]

    if (models.length > 1) {
      parts.push(
        'Multi-model session (hop-expanded). aggregate/filter/sample require the `model` ' +
          `parameter; field documentation below covers the dominant model \`${model}\`.`,
        ''
      )
    }

    if (modelConfig?.attributes) {
      const attrs = modelConfig.attributes
      parts.push('## Available Fields', '')
      parts.push('| Field | Type | Description |')
      parts.push('|-------|------|-------------|')

      const numericFields: string[] = []
      const dateFields: string[] = []
      const enumFields: string[] = []

      for (const [name, config] of Object.entries(attrs)) {
        const type = config.type ?? 'unknown'
        const desc = config.description ?? ''
        let details = desc

        if (type === 'enum' && config.enumValues) {
          const values = config.enumValues.map((v) => `\`${v}\``).join(', ')
          details += ` Values: ${values}`
          enumFields.push(name)
        }

        parts.push(`| \`${name}\` | ${type} | ${details} |`)

        if (type === 'integer') {
          numericFields.push(name)
        }
        if (type === 'datetime') {
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

      // Proximity sampling section when date fields exist
      if (dateFields.length > 0) {
        const dateField = dateFields[0]!
        parts.push('')
        parts.push('### Proximity sampling')
        parts.push(
          'Use sample mode with `proximity` to get representative records around a date. ' +
            'Combine with `where` to pre-filter and `stratify_by` for discrete field stratification.'
        )
        parts.push('')
        parts.push(
          `\`mode: "sample", proximity: {"field": "${dateField}", "origin": "2026-03-15", "window": "7 days", "bucket": "1 day"}\``
        )
        parts.push('')
        parts.push(
          'Distributes sample slots evenly across time buckets within the window. ' +
            'Without `bucket`, returns uniform random within the window.'
        )
      }
    } else {
      parts.push(
        `Model "${model}" has no attribute metadata. Use sample mode to inspect record shape.`
      )
    }

    // Graph dimensions: concepts touching this model, observed edge types,
    // embedding coverage. Surfaces what graph-aware sampling and the
    // GraphRAG strategies have to work with.
    const graphInfo = await getSessionGraphInfo(analysisId)
    const concepts = this.domainRegistry ? await this.domainRegistry.getConceptsForModel(model) : []

    if (concepts.length > 0 || graphInfo.edgeTypes.length > 0 || graphInfo.totalRecordCount > 0) {
      parts.push('')
      parts.push('## Graph dimensions available', '')

      if (concepts.length > 0) {
        parts.push(
          `Concepts covering \`${model}\`: ` + concepts.map((c) => `\`${c.name}\``).join(', ')
        )
      } else {
        parts.push(`Concepts covering \`${model}\`: (none registered)`)
      }

      if (graphInfo.edgeTypes.length > 0) {
        parts.push(
          `Edge types in this session: ${graphInfo.edgeTypes.map((t) => `\`${t}\``).join(', ')}`
        )
      } else {
        parts.push(`Edge types in this session: (none — re-run analysis_ingest with hop_depth ≥ 0)`)
      }

      const pct =
        graphInfo.totalRecordCount > 0
          ? Math.round((graphInfo.embeddedRecordCount / graphInfo.totalRecordCount) * 100)
          : 0
      parts.push(
        `Embedding coverage: ${graphInfo.embeddedRecordCount}/${graphInfo.totalRecordCount} (${pct}%). ` +
          (pct === 100
            ? 'cluster stratifier ready.'
            : pct === 0
              ? 'cluster stratifier will trigger back-fill on first use.'
              : 'partial — cluster stratifier auto-back-fills the rest.')
      )

      parts.push('')
      parts.push('### Graph-aware sample stratifiers')
      parts.push(
        '`stratifiers: [{kind:"concept", concept:"<name>"}, {kind:"edge", edge_type:"<type>", bucket:"present"|"count"}, {kind:"cluster", k:<2-20>}]` (max 3, composes with `where` / `proximity` / `stratify_by`).'
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

  /**
   * Shortest typed edge chains between two records ("how is A connected to
   * B"). Traversal is undirected over the directed edges; each step renders
   * with the direction it used, so the chain reads as schema semantics:
   * book/1 \u2014belongsTo:author\u2192 author/7 \u2190fk:owner_id\u2014 project/3.
   */
  private async _queryPath(
    analysisId: string,
    fromModel?: string,
    fromId?: string,
    toModel?: string,
    toId?: string,
    maxDepth?: number,
    topK?: number
  ): Promise<ToolResult> {
    if (!fromModel || !fromId || !toModel || !toId) {
      return this.formatResponse(
        'Path mode needs "from_model", "from_id", "to_model", and "to_id" (e.g. from_model: "book", from_id: "1", to_model: "author", to_id: "7").'
      )
    }

    const paths = await findEdgePaths(analysisId, {
      from: { model: fromModel, id: fromId },
      to: { model: toModel, id: toId },
      maxDepth,
      limit: topK
    })

    if (paths.length === 0) {
      return this.formatResponse(
        `No path found between ${fromModel}/${fromId} and ${toModel}/${toId} within ` +
          `${Math.min(maxDepth ?? 4, 6)} edges. Try a larger max_depth, or re-run analysis_ingest ` +
          'with hop_depth > 0 so the connecting records and their edges are in the session.'
      )
    }

    const parts: string[] = [
      `${paths.length} path(s) between ${fromModel}/${fromId} and ${toModel}/${toId} (shortest: ${paths[0]!.depth} edge(s)):\n`
    ]
    for (const path of paths) {
      let chain = `${fromModel}/${fromId}`
      for (const step of path.steps) {
        chain +=
          step.direction === 'forward'
            ? ` \u2014${step.edgeType}\u2192 ${step.toModel}/${step.toId}`
            : ` \u2190${step.edgeType}\u2014 ${step.toModel}/${step.toId}`
      }
      parts.push(`- ${chain}`)
    }

    return this.formatResponse(parts.join('\n'))
  }

  /**
   * Semantic ranking over the session's record embeddings (target:"records").
   * Backfills missing embeddings for the scoped model first (same policy as
   * the cluster stratifier), then ranks by cosine similarity — hybrid with
   * the JSONB "where" pre-filter in one statement.
   */
  private async _querySemanticRecords(
    analysisId: string,
    query?: string,
    topK?: number,
    where?: Record<string, unknown>,
    model?: string,
    minSimilarity?: number,
    rerank?: boolean
  ): Promise<ToolResult> {
    if (!query) {
      return this.formatResponse(
        'Please provide a "query" parameter for semantic mode (e.g., "books about distributed systems").'
      )
    }

    // Backfill embeddings when the scope is resolvable here; a multi-model
    // session without an explicit model errors below with the candidate list.
    const scopedModel = model ?? (await this._resolveSessionModel(analysisId))
    if (scopedModel) {
      await ensureRecordEmbeddings(analysisId, scopedModel)
    }

    const hits = await searchIngestedRecords(analysisId, query, {
      model,
      topK,
      where,
      minSimilarity,
      rerank
    })

    if (hits.length === 0) {
      return this.formatResponse(
        `No records match "${query}"${where ? ` with filter ${JSON.stringify(where)}` : ''} in analysis "${analysisId}". ` +
          'Records without embeddings are invisible to semantic ranking — ingest with embed_records or re-run this query to back-fill more.'
      )
    }

    const parts: string[] = [`Top ${hits.length} record(s) by similarity to "${query}":\n`]
    for (const hit of hits) {
      parts.push(`- [${(hit.similarity * 100).toFixed(1)}%] ${JSON.stringify(hit.record)}`)
    }

    const graphInfo = await getSessionGraphInfo(analysisId)
    if (graphInfo.embeddedRecordCount < graphInfo.totalRecordCount) {
      parts.push(
        `\nEmbedding coverage: ${graphInfo.embeddedRecordCount}/${graphInfo.totalRecordCount} — ` +
          'unembedded records are invisible to this ranking (each query back-fills up to 500 more).'
      )
    }

    return this.formatResponse(parts.join('\n'))
  }

  /** Aggregate query on ingested_records */
  private async _queryAggregate(
    analysisId: string,
    groupBy?: string,
    model?: string
  ): Promise<ToolResult> {
    if (!groupBy) {
      return this.formatResponse(
        'Please provide a "group_by" parameter for aggregate mode (e.g., "status").'
      )
    }

    const results = await queryIngestedData(analysisId, {
      mode: 'aggregate',
      groupBy,
      model
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
    limit?: number,
    model?: string
  ): Promise<ToolResult> {
    if (!where || Object.keys(where).length === 0) {
      return this.formatResponse(
        'Please provide a "where" parameter for filter mode (e.g., {"status": "active"}).'
      )
    }

    const results = await queryIngestedData(analysisId, {
      mode: 'filter',
      where,
      limit,
      model
    })

    if (results.length === 0) {
      return this.formatResponse(
        `No records match the filter ${JSON.stringify(where)} in analysis "${analysisId}".`
      )
    }

    return this.formatResponse(results as unknown as Record<string, unknown>)
  }

  /**
   * Sample records — supports discrete-field stratification, pre-filtering,
   * proximity windowing, and composable graph stratifiers (concept/edge/cluster).
   *
   * When `stratifiers` includes `kind:"cluster"`, embeddings are auto-backfilled
   * for any records lacking them so the cluster CTE has data to work with.
   */
  private async _querySample(
    analysisId: string,
    sampleSize?: number,
    stratifyBy?: string,
    where?: Record<string, unknown>,
    proximity?: { field: string; origin: string; window: string; bucket?: string },
    stratifiers?: Array<
      | { kind: 'concept'; concept: string }
      | { kind: 'edge'; edge_type: string; bucket?: 'present' | 'count' }
      | { kind: 'cluster'; k: number }
    >,
    model?: string
  ): Promise<ToolResult> {
    let resolvedStratifiers: ReadonlyArray<GraphStratifierSpec> | undefined
    let stratifierModel: string | undefined
    if (stratifiers && stratifiers.length > 0) {
      stratifierModel = model ?? (await this._resolveSessionModel(analysisId))
      if (!stratifierModel) {
        return this._textError(
          'Could not resolve source model for sample stratifiers. Pass `model` explicitly or ingest data first.'
        )
      }

      try {
        // Pre-fetch concepts for the source model so toGraphStratifierSpec can
        // resolve concept stratifiers synchronously inside the map.
        const conceptsForModel = this.domainRegistry
          ? await this.domainRegistry.getConceptsForModel(stratifierModel)
          : []
        const sourceModel = stratifierModel
        const conceptResolver =
          conceptsForModel.length > 0
            ? {
                knowledge: {
                  getConceptsForModel: (m: string) => (m === sourceModel ? conceptsForModel : [])
                }
              }
            : undefined
        resolvedStratifiers = stratifiers.map((s) =>
          toGraphStratifierSpec(
            s as Parameters<typeof toGraphStratifierSpec>[0],
            conceptResolver,
            sourceModel
          )
        )
      } catch (err) {
        return this._textError((err as Error).message)
      }

      // Auto-backfill embeddings when a cluster stratifier is requested.
      if (resolvedStratifiers.some((s) => s.kind === 'cluster')) {
        await ensureRecordEmbeddings(analysisId, stratifierModel)
      }
    }

    const results = await queryIngestedData(analysisId, {
      mode: 'sample',
      sampleSize,
      stratifyBy,
      where,
      proximity,
      stratifiers: resolvedStratifiers,
      model
    })

    if (results.length === 0) {
      return this.formatResponse(
        `No ingested records found for analysis "${analysisId}". Run analysis_ingest first.`
      )
    }

    return this.formatResponse(results as unknown as Record<string, unknown>)
  }

  private async _resolveSessionModel(analysisId: string): Promise<string | undefined> {
    const session = await describeAnalysisSession(analysisId)
    if (!session || session.models.length !== 1) return undefined
    return session.models[0]!.model
  }

  private _textError(text: string): ToolResult {
    return { content: [{ type: 'text', text }], isError: true }
  }
}
