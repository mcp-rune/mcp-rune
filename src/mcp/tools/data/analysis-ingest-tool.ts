import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { pickFields } from '#src/core/helpers.js'
import { defaultConvention } from '#src/mcp/api-conventions/index.js'
import { SearchClient } from '#src/mcp/search/search-client.js'
import {
  getIngestedRecordIds,
  storeAnalysisMemory,
  storeIngestedRecords
} from '#src/services/vector-storage.js'

import type { ApiClient, ModelConfig, ToolAnnotations, ToolResult } from '../base-tool.js'
import { BaseTool } from '../base-tool.js'
import { LoggingApiClient } from '../logging-api-client.js'
import type { NestedValidationError, NestedValidationSuccess } from '../validators.js'
import { validateFilterParams, validateNestedResource } from '../validators.js'

/** Max pages allowed when ingest_all is true */
const MAX_INGEST_PAGES = 50

/** Max parent IDs per nested ingestion call */
const MAX_NESTED_BATCH = 25

/** Max concurrent nested resource fetches */
const MAX_NESTED_CONCURRENCY = 5

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

  override get annotations(): ToolAnnotations {
    return {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Ingest model records${scope} into offline storage for large-scale analysis without polluting context.

Use this tool instead of find_model when you need to analyze a large dataset (more than one page of results). Records are stored for querying via analysis_query — only a status summary is returned to context.

Top-level ingestion:
1. Call analysis_ingest with model + filters + ingest_all: true to fetch and store all records
2. Use analysis_query to reason about the data (aggregations, filters, semantic search)

Nested resource ingestion (for child resources like metadata_errors, conflicts):
1. Ingest parent records first: analysis_ingest({ model: "scheduling", filters: {...}, ingest_all: true })
2. Ingest children: analysis_ingest({ parent_model: "scheduling", child_resource: "metadata_errors" })
   Parent IDs are auto-resolved from step 1's ingested records — no need to list them.
3. Query children: analysis_query({ mode: "aggregate", group_by: "message" })

Each child record gets a _parent_id field injected for cross-referencing with the parent.

When NOT to use: For quick lookups of specific records by ID or small result sets you need in context immediately, use find_model instead.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(this.getModelNames()).describe('Model name').optional(),
      analysis_id: z
        .string()
        .describe('Unique identifier for this analysis session (e.g., "q1-deal-audit")'),
      filters: z
        .record(z.string(), z.unknown())
        .describe(
          'Filter criteria (call get_filters_guide to see available filters for the model). Used for filtered ingestion.'
        )
        .optional(),
      page: z
        .number()
        .describe('Page number to fetch (default: 1). Ignored when ingest_all is true.')
        .optional(),
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
      user_id: z.string().describe('User ID to impersonate (service accounts only).').optional(),

      // Nested resource ingestion params
      parent_model: this.zodEnum(this.getModelNames())
        .optional()
        .describe(
          'Parent model name for nested resource ingestion. When set, auto-resolves parent IDs ' +
            'from previously ingested records of this model in the same analysis session.'
        ),
      parent_ids: z
        .array(z.string())
        .max(MAX_NESTED_BATCH)
        .optional()
        .describe(
          `Explicit parent IDs (max ${MAX_NESTED_BATCH}). If omitted when parent_model is set, ` +
            'auto-resolves from ingested records.'
        ),
      child_resource: z
        .string()
        .optional()
        .describe(
          "Nested resource name (e.g., 'metadata_errors', 'conflicts'). Required when parent_model is set."
        )
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
        filters,
        page,
        per_page = 50,
        fields,
        ingest_all = false,
        user_id,
        parent_model,
        parent_ids,
        child_resource
      } = args as {
        model?: string
        analysis_id: string
        filters?: Record<string, unknown>
        page?: number
        per_page?: number
        fields?: string[]
        ingest_all?: boolean
        user_id?: string
        parent_model?: string
        parent_ids?: string[]
        child_resource?: string
      }

      const wrappedClient = this.logger
        ? new LoggingApiClient(this.apiClient!, this.logger)
        : this.apiClient!
      const api = wrappedClient as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      >
      const options = user_id ? { userId: user_id } : {}

      // --- Nested resource ingestion mode ---
      if (parent_model) {
        if (!child_resource) {
          return {
            content: [
              {
                type: 'text',
                text: 'child_resource is required when parent_model is set. Provide the nested resource name (e.g., "metadata_errors").'
              }
            ],
            isError: true
          }
        }
        return await this._ingestNestedResources(
          api,
          analysis_id,
          parent_model,
          child_resource,
          parent_ids,
          fields,
          options
        )
      }

      // --- Top-level model ingestion mode ---
      if (!model) {
        return {
          content: [
            {
              type: 'text',
              text: 'Either "model" (for top-level ingestion) or "parent_model" + "child_resource" (for nested ingestion) is required.'
            }
          ],
          isError: true
        }
      }

      this.validateModel(model)
      const modelConfig = this.getModelConfig(model)!
      const ModelClass = this.models[model]!

      // Validate filters if provided
      let normalizedFilters = filters
      if (filters && Object.keys(filters).length > 0) {
        const validation = validateFilterParams(model, filters, this.models)
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `${validation.error}\n\n${validation.suggestion}` }],
            isError: true
          }
        }
        normalizedFilters = validation.filters
      }

      if (this.logger) {
        this.logger.info('Ingesting model data', {
          service: 'mcp-tools',
          tool: 'analysis_ingest',
          model,
          analysisId: analysis_id,
          ingestAll: ingest_all,
          hasFilters: !!normalizedFilters
        })
      }

      if (ingest_all) {
        return await this._ingestAllPages(
          api,
          model,
          ModelClass,
          modelConfig,
          analysis_id,
          normalizedFilters,
          per_page,
          fields,
          options
        )
      } else {
        return await this._ingestPage(
          api,
          model,
          ModelClass,
          modelConfig,
          analysis_id,
          normalizedFilters,
          page ?? 1,
          per_page,
          fields,
          options
        )
      }
    } catch (error) {
      return this.formatError(error as Error)
    }
  }

  /** Fetch and store a single page */
  private async _ingestPage(
    api: Record<string, (...args: unknown[]) => Promise<unknown>>,
    model: string,
    ModelClass: Record<string, unknown>,
    modelConfig: ModelConfig,
    analysisId: string,
    filters: Record<string, unknown> | undefined,
    page: number,
    perPage: number,
    fields: string[] | undefined,
    apiOptions: Record<string, unknown>
  ): Promise<ToolResult> {
    let rawRecords: Record<string, unknown>[]
    let totalPages: number | null

    // Resolve convention for extraction and flattening
    const convention = modelConfig.api?.convention ?? defaultConvention

    // Use SearchClient if model supports query search and filters provided
    const hasFullText = modelConfig.search?.query
    const hasSearchParams = filters && Object.keys(filters).length > 0

    if (hasFullText && hasSearchParams) {
      // Use SearchClient for filtered ingestion
      const searchClient = this._createSearchClient(api as unknown as ApiClient)
      const { records, pagination } = (await searchClient.search(
        ModelClass as Parameters<typeof searchClient.search>[0],
        '',
        {
          page,
          perPage,
          filters
        }
      )) as { records: Record<string, unknown>[]; pagination: { total_pages?: number } }

      rawRecords = records
      totalPages = pagination.total_pages ?? null
    } else {
      // Use plain GET for simple listing (no filters)
      const queryParams = { page, per_page: perPage }
      const data = (await api.get!(modelConfig.endpoint, queryParams, apiOptions)) as Record<
        string,
        unknown
      >

      const normalized = convention.normalizeListResponse(data, { page, perPage })
      rawRecords = normalized.records
      totalPages = normalized.pagination.total_pages ?? null
    }

    // Flatten expanded associations (e.g., title.name -> title_name) before field selection
    const flatRecords = convention.flattenExpandedResources(
      rawRecords,
      modelConfig.associations,
      fields
    )

    // Ensure force-included {assoc}_id fields from flattenExpandedResources survive pickFields
    const effectiveFields =
      fields && flatRecords.length > 0
        ? this._augmentFieldsWithAssocIds(fields, flatRecords[0]!)
        : fields
    const records = effectiveFields
      ? (pickFields(flatRecords, effectiveFields) as Record<string, unknown>[])
      : flatRecords

    // Store records
    const stored = await storeIngestedRecords({
      analysisId,
      model,
      records: records.map((r) => ({ id: r.id as string, data: r }))
    })

    // Store page summary as analysis memory
    await this._storePageSummary(analysisId, model, page, totalPages, records, effectiveFields)

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
    ModelClass: Record<string, unknown>,
    modelConfig: ModelConfig,
    analysisId: string,
    filters: Record<string, unknown> | undefined,
    perPage: number,
    fields: string[] | undefined,
    apiOptions: Record<string, unknown>
  ): Promise<ToolResult> {
    let currentPage = 1
    let totalStored = 0
    let totalPages: number | null = null

    // Resolve convention once for all pages
    const convention = modelConfig.api?.convention ?? defaultConvention

    // Use SearchClient if model supports query search and filters provided
    const hasFullText = modelConfig.search?.query
    const hasSearchParams = filters && Object.keys(filters).length > 0
    const searchClient =
      hasFullText && hasSearchParams ? this._createSearchClient(api as unknown as ApiClient) : null

    while (currentPage <= MAX_INGEST_PAGES) {
      let rawRecords: Record<string, unknown>[]

      if (searchClient) {
        // Use SearchClient for filtered ingestion
        const { records, pagination } = (await searchClient.search(
          ModelClass as Parameters<typeof searchClient.search>[0],
          '',
          {
            page: currentPage,
            perPage,
            filters
          }
        )) as { records: Record<string, unknown>[]; pagination: { total_pages?: number } }

        rawRecords = records
        if (totalPages === null) {
          totalPages = pagination.total_pages ?? null
        }
      } else {
        // Use plain GET for simple listing
        const queryParams = { page: currentPage, per_page: perPage }
        const data = (await api.get!(modelConfig.endpoint, queryParams, apiOptions)) as Record<
          string,
          unknown
        >

        const normalized = convention.normalizeListResponse(data, { page: currentPage, perPage })
        rawRecords = normalized.records
        if (totalPages === null) {
          totalPages = normalized.pagination.total_pages ?? null
        }
      }

      if (rawRecords.length === 0) break

      // Flatten expanded associations (e.g., title.name -> title_name) before field selection
      const flatRecords = convention.flattenExpandedResources(
        rawRecords,
        modelConfig.associations,
        fields
      )

      // Ensure force-included {assoc}_id fields from flattenExpandedResources survive pickFields
      const effectiveFields =
        fields && flatRecords.length > 0
          ? this._augmentFieldsWithAssocIds(fields, flatRecords[0]!)
          : fields
      const records = effectiveFields
        ? (pickFields(flatRecords, effectiveFields) as Record<string, unknown>[])
        : flatRecords

      // Store records
      const stored = await storeIngestedRecords({
        analysisId,
        model,
        records: records.map((r) => ({ id: r.id as string, data: r }))
      })
      totalStored += stored

      // Store page summary
      await this._storePageSummary(
        analysisId,
        model,
        currentPage,
        totalPages,
        records,
        effectiveFields
      )

      // Stop if we got fewer records than requested (last page)
      if (rawRecords.length < perPage) break

      // Stop if we know the total pages and reached it
      if (totalPages !== null && currentPage >= totalPages) break

      currentPage++
    }

    const pagesIngested = currentPage
    const fieldsNote = fields ? ` (${fields.length} fields per record)` : ''
    const capNote =
      pagesIngested >= MAX_INGEST_PAGES ? ` (capped at ${MAX_INGEST_PAGES} pages)` : ''

    return this.formatResponse(
      `Stored ${totalStored} record(s)${fieldsNote} across ${pagesIngested} page(s)${capNote}.` +
        `\nAnalysis: ${analysisId}` +
        `\nModel: ${model}`,
      { meta: { context: { consumed: true } } }
    )
  }

  /** Ingest nested resources for parent records */
  private async _ingestNestedResources(
    api: Record<string, (...args: unknown[]) => Promise<unknown>>,
    analysisId: string,
    parentModel: string,
    childResource: string,
    explicitParentIds: string[] | undefined,
    fields: string[] | undefined,
    apiOptions: Record<string, unknown>
  ): Promise<ToolResult> {
    this.validateModel(parentModel)

    // Validate the nested resource exists on the parent model
    const validation = validateNestedResource(parentModel, childResource, this.models)
    if (!validation.valid) {
      const err = validation as NestedValidationError
      if (this.logger) {
        this.logger.error('Nested resource validation failed', {
          service: 'mcp-tools',
          tool: 'analysis_ingest',
          parentModel,
          childResource,
          error: err.error,
          availableLinks: err.availableLinks
        })
      }
      return {
        content: [{ type: 'text', text: `${err.error}\n${err.suggestion}` }],
        isError: true
      }
    }

    const parentConfig = this.getModelConfig(parentModel)!
    const linkInfo = (validation as NestedValidationSuccess).linkInfo as
      | Record<string, unknown>
      | undefined
    const childPath = (linkInfo?.path as string) || childResource
    const childModelName = (linkInfo?.target_model as string) || childResource

    // Resolve parent IDs: explicit list or auto-resolve from ingested records
    let parentIds: string[]
    if (explicitParentIds && explicitParentIds.length > 0) {
      parentIds = explicitParentIds
    } else {
      parentIds = await getIngestedRecordIds(analysisId, parentModel)
      if (parentIds.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text:
                `No ingested ${parentModel} records found for analysis "${analysisId}". ` +
                `Ingest parent records first: analysis_ingest({ model: "${parentModel}", ..., ingest_all: true })`
            }
          ],
          isError: true
        }
      }
    }

    if (this.logger) {
      this.logger.info('Ingesting nested resources', {
        service: 'mcp-tools',
        tool: 'analysis_ingest',
        analysisId,
        parentModel,
        childResource,
        parentCount: parentIds.length,
        idsSource: explicitParentIds ? 'explicit' : 'auto-resolved'
      })
    }

    // Fetch nested resources for each parent with concurrency cap
    const allRecords: Record<string, unknown>[] = []
    const errors: Array<{ parentId: string; error: string }> = []

    // Resolve convention from child model (preferred) or parent model
    const childConfig = this.models[childModelName]
    const convention =
      childConfig?.api?.convention ?? parentConfig.api?.convention ?? defaultConvention

    const tasks = parentIds.map((parentId) => async () => {
      try {
        const endpoint = `${parentConfig.endpoint}/${parentId}/${childPath}`
        const data = (await api.get!(endpoint, {}, apiOptions)) as Record<string, unknown>
        const rawRecords = convention.extractNestedRecords(
          data,
          childConfig?.attributes as Record<string, unknown> | undefined
        )
        const records = fields
          ? (pickFields(rawRecords, fields) as Record<string, unknown>[])
          : rawRecords

        // Inject _parent_id for cross-referencing
        for (const record of records) {
          record._parent_id = parentId
        }
        allRecords.push(...records)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ parentId, error: message })
        if (this.logger) {
          this.logger.warn('Failed to fetch nested resource for parent', {
            service: 'mcp-tools',
            tool: 'analysis_ingest',
            parentModel,
            parentId,
            childResource,
            error: message
          })
        }
      }
    })

    await this._runParallel(tasks)

    // Store collected records
    let totalStored = 0
    if (allRecords.length > 0) {
      if (this.logger) {
        this.logger.debug('Storing nested records in vector storage', {
          service: 'mcp-tools',
          tool: 'analysis_ingest',
          childModel: childModelName,
          recordCount: allRecords.length,
          sampleRecord: allRecords[0] ?? null,
          fields: allRecords[0] ? Object.keys(allRecords[0]) : []
        })
      }

      totalStored = await storeIngestedRecords({
        analysisId,
        model: childModelName,
        records: allRecords.map((r) => ({
          id: r.id as string,
          data: r
        }))
      })

      // Store page summary for the batch
      await this._storePageSummary(analysisId, childModelName, 1, 1, allRecords, fields)
    }

    // Build result summary with logging of successes and failures
    const succeeded = parentIds.length - errors.length
    const parts = [
      `Stored ${totalStored} nested record(s) from ${succeeded}/${parentIds.length} parent(s).`,
      `Analysis: ${analysisId}`,
      `Parent: ${parentModel}. Child: ${childResource}`
    ]

    if (errors.length > 0) {
      parts.push(
        `\nFailed parents (${errors.length}):`,
        ...errors.map((e) => `  - ${e.parentId}: ${e.error}`)
      )
    }

    if (this.logger) {
      this.logger.info('Nested resource ingestion completed', {
        service: 'mcp-tools',
        tool: 'analysis_ingest',
        analysisId,
        parentModel,
        childResource,
        totalStored,
        succeeded,
        failed: errors.length
      })
    }

    const response = this.formatResponse(parts.join('\n'), {
      meta: { context: { consumed: true } }
    })

    // isError only when ALL failed
    if (succeeded === 0 && parentIds.length > 0) {
      ;(response as unknown as Record<string, unknown>).isError = true
    }

    return response
  }

  /**
   * Augment a fields list with {assoc}_id keys that flattenExpandedResources
   * force-added to the flat record.
   *
   * flattenExpandedResources always includes `{assoc}_id` for cross-referencing,
   * but pickFields would strip them if they're not in the caller's fields list.
   * This bridges the two by detecting force-added IDs and preserving them.
   *
   * Only adds `{assoc}_id` if the caller already requested another field from
   * the same association (e.g., title_name → title_id), avoiding spurious IDs
   * for associations the caller didn't ask about.
   */
  private _augmentFieldsWithAssocIds(
    fields: string[],
    flatSample: Record<string, unknown>
  ): string[] {
    const augmented = [...fields]
    for (const key of Object.keys(flatSample)) {
      if (key.endsWith('_id') && !augmented.includes(key)) {
        const assocPrefix = key.slice(0, -3) // "title_id" -> "title"
        if (augmented.some((f) => f.startsWith(assocPrefix + '_'))) {
          augmented.push(key)
        }
      }
    }
    return augmented
  }

  /** Create a SearchClient from the tool's apiClient and serverContext */
  private _createSearchClient(apiClient?: ApiClient): SearchClient {
    const client = apiClient ?? this.apiClient!
    const searchGroups = ((this.serverContext as Record<string, unknown>)?.searchGroups ??
      {}) as Record<string, unknown>
    return new SearchClient(
      client as unknown as ConstructorParameters<typeof SearchClient>[0],
      { searchGroups } as unknown as ConstructorParameters<typeof SearchClient>[1]
    )
  }

  /**
   * Run async tasks with a concurrency limit.
   *
   * Spawns up to MAX_NESTED_CONCURRENCY workers that pull from a shared task queue.
   */
  private async _runParallel(tasks: Array<() => Promise<void>>): Promise<void> {
    let next = 0

    async function worker(): Promise<void> {
      while (next < tasks.length) {
        const i = next++
        await tasks[i]!()
      }
    }

    await Promise.allSettled(
      Array.from({ length: Math.min(MAX_NESTED_CONCURRENCY, tasks.length) }, () => worker())
    )
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

    // Build numeric stats and date ranges
    const numericStats = this._buildNumericStats(records)
    const dateRanges = this._buildDateRanges(records)

    const statsLines = Object.entries(numericStats)
      .map(
        ([field, s]) =>
          `${field}: min=${s.min}, max=${s.max}, avg=${s.avg}, median=${s.median}, n=${s.count}`
      )
      .join('. ')

    const dateLines = Object.entries(dateRanges)
      .map(([field, r]) => `${field}: ${r.earliest}..${r.latest} (${r.count} values)`)
      .join('. ')

    const fieldsNote = fields ? ` Fields: ${fields.join(', ')}.` : ''
    const summary =
      `Page ${pageLabel} of ${model} records (${records.length} records).${fieldsNote}` +
      (distLines ? ` Distribution: ${distLines}.` : '') +
      (statsLines ? ` Numeric stats: ${statsLines}.` : '') +
      (dateLines ? ` Date ranges: ${dateLines}.` : '')

    await storeAnalysisMemory({
      analysisId,
      finding: summary,
      category: 'page_summary',
      metadata: {
        page,
        model,
        record_count: records.length,
        distributions,
        numericStats,
        dateRanges
      }
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

  /** Compute summary statistics for numeric fields */
  private _buildNumericStats(
    records: Record<string, unknown>[]
  ): Record<string, { min: number; max: number; avg: number; median: number; count: number }> {
    if (records.length === 0) return {}

    const stats: Record<
      string,
      { min: number; max: number; avg: number; median: number; count: number }
    > = {}

    const sample = records[0]!
    const numericFields = Object.entries(sample)
      .filter(([key, val]) => key !== 'id' && typeof val === 'number')
      .map(([key]) => key)

    for (const field of numericFields) {
      const values = records.map((r) => r[field]).filter((v): v is number => typeof v === 'number')

      if (values.length === 0) continue

      values.sort((a, b) => a - b)
      const sum = values.reduce((acc, v) => acc + v, 0)
      const mid = Math.floor(values.length / 2)
      const median = values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!

      stats[field] = {
        min: values[0]!,
        max: values[values.length - 1]!,
        avg: Math.round((sum / values.length) * 100) / 100,
        median,
        count: values.length
      }
    }

    return stats
  }

  /** Compute date ranges for ISO 8601 date string fields */
  private _buildDateRanges(
    records: Record<string, unknown>[]
  ): Record<string, { earliest: string; latest: string; count: number }> {
    if (records.length === 0) return {}

    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/
    const sample = records[0]!
    const dateFields = Object.entries(sample)
      .filter(([key, val]) => key !== 'id' && typeof val === 'string' && ISO_DATE_RE.test(val))
      .map(([key]) => key)

    const ranges: Record<string, { earliest: string; latest: string; count: number }> = {}
    for (const field of dateFields) {
      const values = records
        .map((r) => r[field])
        .filter((v): v is string => typeof v === 'string' && ISO_DATE_RE.test(v))
        .sort()

      if (values.length === 0) continue
      ranges[field] = {
        earliest: values[0]!,
        latest: values[values.length - 1]!,
        count: values.length
      }
    }

    return ranges
  }
}
