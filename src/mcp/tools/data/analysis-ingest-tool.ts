import { z } from 'zod'
import { BaseTool } from '../base-tool.js'
import type { ToolResult } from '../base-tool.js'
import type { ZodTypeAny } from 'zod'
import { validateSearchParams } from '../validators.js'
import { pickFields } from '#src/core/helpers.js'
import {
  storeIngestedRecords,
  storeAnalysisMemory
} from '#src/services/vector-storage.js'

/** Max pages allowed when ingest_all is true */
const MAX_INGEST_PAGES = 50

/**
 * Ingest model records into offline storage for large-scale analysis.
 *
 * Part of the analysis_* tool family:
 *   analysis_ingest → analysis_store → analysis_query → analysis_clear
 *
 * Fetches records from the API and stores them in structured storage
 * (ingested_records) for querying via analysis_query. Only a status
 * summary is returned to context — no raw data pollutes the LLM window.
 */
export class AnalysisIngestTool extends BaseTool {
  override get name(): string {
    return 'analysis_ingest'
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Ingest model records${scope} into offline storage for large-scale analysis without polluting context.

Use this tool instead of find_model when you need to analyze a large dataset (more than one page of results). Records are stored for querying via analysis_query — only a status summary is returned to context.

Workflow:
1. Call analysis_ingest with ingest_all: true to fetch and store all records
2. Use analysis_query to reason about the data (aggregations, filters, semantic search)
3. Use analysis_store to save your own qualitative findings
4. Call analysis_clear when analysis is complete

When NOT to use: For quick lookups of specific records by ID or small result sets you need in context immediately, use find_model instead.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(this.getModelNames()).describe('Model name'),
      analysis_id: z
        .string()
        .describe('Unique identifier for this analysis session (e.g., "q1-deal-audit")'),
      search: z
        .record(z.string(), z.unknown())
        .describe(
          'Search parameters specific to the model. Use list_models to see which fields are searchable.'
        )
        .optional(),
      page: z.number().describe('Page number to fetch (default: 1). Ignored when ingest_all is true.').optional(),
      per_page: z.number().describe('Records per page (default: 50)').optional(),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to include (e.g., ["id", "name", "status"]). Omit for all fields. Lighter storage when specified.'
        ),
      ingest_all: z
        .boolean()
        .optional()
        .describe(
          `When true, auto-paginates all pages (up to ${MAX_INGEST_PAGES} pages). Default: false (single page).`
        ),
      user_id: z
        .string()
        .describe('User ID to impersonate (service accounts only).')
        .optional()
    }
  }

  override getUsageRules(): string[] {
    return []
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      this.requireApiClient()

      const {
        model,
        analysis_id,
        search,
        page,
        per_page = 50,
        fields,
        ingest_all = false,
        user_id
      } = args as {
        model: string
        analysis_id: string
        search?: Record<string, unknown>
        page?: number
        per_page?: number
        fields?: string[]
        ingest_all?: boolean
        user_id?: string
      }

      this.validateModel(model)
      const modelConfig = this.getModelConfig(model)!
      const options = user_id ? { userId: user_id } : {}

      // Validate search params
      if (search) {
        const validation = validateSearchParams(model, search, this.models)
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `${validation.error}\n\n${validation.suggestion}` }],
            isError: true
          }
        }
      }

      if (this.logger) {
        this.logger.info('Ingesting model data', {
          service: 'mcp-tools',
          tool: 'analysis_ingest',
          model,
          analysisId: analysis_id,
          ingestAll: ingest_all
        })
      }

      const api = this.apiClient! as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      >

      if (ingest_all) {
        return await this._ingestAllPages(api, model, modelConfig, analysis_id, search, per_page, fields, options)
      } else {
        return await this._ingestPage(api, model, modelConfig, analysis_id, search, page ?? 1, per_page, fields, options)
      }
    } catch (error) {
      return this.formatError(error as Error)
    }
  }

  /** Fetch and store a single page */
  private async _ingestPage(
    api: Record<string, (...args: unknown[]) => Promise<unknown>>,
    model: string,
    modelConfig: { endpoint: string },
    analysisId: string,
    search: Record<string, unknown> | undefined,
    page: number,
    perPage: number,
    fields: string[] | undefined,
    apiOptions: Record<string, unknown>
  ): Promise<ToolResult> {
    const queryParams = { ...search, page, per_page: perPage }
    const data = (await api.get!(modelConfig.endpoint, queryParams, apiOptions)) as Record<
      string,
      unknown
    >

    const rawRecords = this._extractRecords(data)
    const records = fields ? (pickFields(rawRecords, fields) as Record<string, unknown>[]) : rawRecords
    const totalPages = this._extractTotalPages(data, page, records.length, perPage)

    // Store records
    const stored = await storeIngestedRecords({
      analysisId,
      model,
      records: records.map((r) => ({ id: r.id as string, data: r }))
    })

    // Store page summary as analysis memory
    await this._storePageSummary(analysisId, model, page, totalPages, records, fields)

    const fieldsNote = fields ? ` (${fields.length} fields per record)` : ''
    return this.formatResponse(
      `Stored ${stored} record(s)${fieldsNote} (page ${page}/${totalPages ?? '?'}).` +
        `\nAnalysis: ${analysisId}` +
        `\nModel: ${model}`,
      { meta: { context: { consumed: true } } }
    )
  }

  /** Auto-paginate and ingest all pages */
  private async _ingestAllPages(
    api: Record<string, (...args: unknown[]) => Promise<unknown>>,
    model: string,
    modelConfig: { endpoint: string },
    analysisId: string,
    search: Record<string, unknown> | undefined,
    perPage: number,
    fields: string[] | undefined,
    apiOptions: Record<string, unknown>
  ): Promise<ToolResult> {
    let currentPage = 1
    let totalStored = 0
    let totalPages: number | null = null

    while (currentPage <= MAX_INGEST_PAGES) {
      const queryParams = { ...search, page: currentPage, per_page: perPage }
      const data = (await api.get!(modelConfig.endpoint, queryParams, apiOptions)) as Record<
        string,
        unknown
      >

      const rawRecords = this._extractRecords(data)
      if (rawRecords.length === 0) break

      const records = fields
        ? (pickFields(rawRecords, fields) as Record<string, unknown>[])
        : rawRecords

      if (totalPages === null) {
        totalPages = this._extractTotalPages(data, currentPage, records.length, perPage)
      }

      // Store records
      const stored = await storeIngestedRecords({
        analysisId,
        model,
        records: records.map((r) => ({ id: r.id as string, data: r }))
      })
      totalStored += stored

      // Store page summary
      await this._storePageSummary(analysisId, model, currentPage, totalPages, records, fields)

      // Stop if we got fewer records than requested (last page)
      if (rawRecords.length < perPage) break

      // Stop if we know the total pages and reached it
      if (totalPages !== null && currentPage >= totalPages) break

      currentPage++
    }

    const pagesIngested = currentPage
    const fieldsNote = fields ? ` (${fields.length} fields per record)` : ''
    const capNote = pagesIngested >= MAX_INGEST_PAGES ? ` (capped at ${MAX_INGEST_PAGES} pages)` : ''

    return this.formatResponse(
      `Stored ${totalStored} record(s)${fieldsNote} across ${pagesIngested} page(s)${capNote}.` +
        `\nAnalysis: ${analysisId}` +
        `\nModel: ${model}`,
      { meta: { context: { consumed: true } } }
    )
  }

  /** Extract records array from API response (handles different response shapes) */
  private _extractRecords(data: Record<string, unknown>): Record<string, unknown>[] {
    if (Array.isArray(data)) return data as Record<string, unknown>[]
    return ((data?.data ?? data?.records ?? []) as unknown[]) as Record<string, unknown>[]
  }

  /** Try to extract total pages from API response metadata */
  private _extractTotalPages(
    data: Record<string, unknown>,
    currentPage: number,
    recordCount: number,
    perPage: number
  ): number | null {
    // Common pagination shapes
    const meta = (data?.meta ?? data?.pagination ?? data) as Record<string, unknown>
    if (meta?.total_pages) return meta.total_pages as number
    if (meta?.totalPages) return meta.totalPages as number
    if (meta?.total && perPage > 0) return Math.ceil((meta.total as number) / perPage)
    return null
  }

  /** Store a compact page summary as an analysis memory finding */
  private async _storePageSummary(
    analysisId: string,
    model: string,
    page: number,
    totalPages: number | null,
    records: Record<string, unknown>[],
    fields: string[] | undefined
  ): Promise<void> {
    // Build field distributions for enum-like fields
    const distributions = this._buildFieldDistributions(records)

    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`
    const distLines = Object.entries(distributions)
      .map(([field, counts]) => {
        const top = Object.entries(counts as Record<string, number>)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([val, count]) => `${val}=${count}`)
          .join(', ')
        return `${field}: ${top}`
      })
      .join('. ')

    const fieldsNote = fields ? ` Fields: ${fields.join(', ')}.` : ''
    const summary =
      `Page ${pageLabel} of ${model} records (${records.length} records).${fieldsNote}` +
      (distLines ? ` Distribution: ${distLines}.` : '')

    await storeAnalysisMemory({
      analysisId,
      finding: summary,
      category: 'page_summary',
      metadata: { page, model, record_count: records.length, distributions }
    })
  }

  /** Compute value distributions for fields with low cardinality */
  private _buildFieldDistributions(
    records: Record<string, unknown>[]
  ): Record<string, Record<string, number>> {
    if (records.length === 0) return {}

    const distributions: Record<string, Record<string, number>> = {}

    // Sample first record to identify candidate fields
    const sample = records[0]!
    const candidateFields = Object.entries(sample)
      .filter(([key, val]) => {
        if (key === 'id') return false
        return typeof val === 'string' || typeof val === 'boolean' || val === null
      })
      .map(([key]) => key)

    for (const field of candidateFields) {
      const counts: Record<string, number> = {}
      for (const record of records) {
        const val = String(record[field] ?? 'null')
        counts[val] = (counts[val] || 0) + 1
      }
      // Only include if low cardinality (< 50% unique values)
      const uniqueCount = Object.keys(counts).length
      if (uniqueCount <= records.length * 0.5 && uniqueCount <= 20) {
        distributions[field] = counts
      }
    }

    return distributions
  }
}
