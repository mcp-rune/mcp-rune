import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type { SearchService } from '#src/api-extensions/search/index.js'
import { createSearchService, getSearchConfig } from '#src/api-extensions/search/index.js'
import { extractEdgesFromRecord, type HopFollow } from '#src/core/edge-extraction.js'
import { pickFields } from '#src/core/helpers.js'
import { expandHops } from '#src/core/multi-hop-fetch.js'
import type { SummaryEdge, SummaryInput } from '#src/core/summary-strategies/index.js'
import { defaultSummaryStrategyRegistry } from '#src/core/summary-strategies/index.js'
import { defaultConvention } from '#src/mcp/api-conventions/index.js'
import { buildCollectionPath } from '#src/mcp/services/compound-id.js'
import {
  getEdgesForSources,
  getEmbeddingsForRecords,
  getIngestedRecordCount,
  getIngestedRecordIds,
  storeAnalysisMemory,
  storeIngestedEdges,
  storeIngestedRecords
} from '#src/services/vector-storage.js'

import type { DataLayer, ModelConfig, ToolAnnotations, ToolResult } from '../base-tool.js'
import type { NestedValidationError, NestedValidationSuccess } from '../validators.js'
import { validateFilterParams, validateNestedResource } from '../validators.js'
import { BaseAnalysisTool } from './base-analysis-tool.js'

/** Max pages allowed when ingest_all is true */
const MAX_INGEST_PAGES = 50

/** Max parent IDs per nested ingestion call */
const MAX_NESTED_BATCH = 25

/** Max concurrent nested resource fetches */
const MAX_NESTED_CONCURRENCY = 5

/** Max hop depth allowed for multi-hop graph expansion. */
const MAX_HOP_DEPTH = 3

interface IngestPipelineOptions {
  embedRecords: boolean
  embedFields?: string[]
  hopDepth: number
  hopFollow: HopFollow
  hopModels?: string[]
}

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
export class AnalysisIngestTool extends BaseAnalysisTool {
  /** Opts back into auth — fetches records from the upstream API, unlike its no-auth siblings. */
  static override requiresAuth = true

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

Use this tool instead of find_records when you need to analyze a large dataset (more than one page of results). Records are stored for querying via analysis_query — only a status summary is returned to context.

Top-level ingestion:
1. Call analysis_ingest with model + filters + ingest_all: true to fetch and store all records
2. Use analysis_query to reason about the data (aggregations, filters, semantic search)

Nested resource ingestion (for child resources like metadata_errors, conflicts):
1. Ingest parent records first: analysis_ingest({ model: "scheduling", filters: {...}, ingest_all: true })
2. Ingest children: analysis_ingest({ parent_model: "scheduling", child_resource: "metadata_errors" })
   Parent IDs are auto-resolved from step 1's ingested records — no need to list them.
3. Query children: analysis_query({ mode: "aggregate", group_by: "message" })

Each child record gets a _parent_id field injected for cross-referencing with the parent.

When NOT to use: For quick lookups of specific records by ID or small result sets you need in context immediately, use find_records instead.`
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
      resume: z
        .boolean()
        .optional()
        .describe(
          'Resume a previous ingestion. When used with ingest_all, skips already-stored pages and continues from where it left off.'
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
        ),

      summary_strategy: this.zodEnum(this._availableStrategyNames())
        .optional()
        .describe(this._summaryStrategyParamDescription()),
      summary_strategies: z
        .array(this.zodEnum(this._availableStrategyNames()))
        .optional()
        .describe(
          'Run multiple summary strategies per page; each produces a separate page_summary:<strategy> memory. ' +
            'Mutually exclusive with `summary_strategy`. Order is preserved. Strategies whose `appliesTo` ' +
            'returns false for a given page are silently skipped.'
        ),

      embed_records: z
        .boolean()
        .optional()
        .describe(
          'Embed each ingested record (384-dim MiniLM) so cluster stratification and semantic-cluster ' +
            'summaries work without a back-fill round-trip. Default: true. Set false for large datasets ' +
            'where ingest latency matters; back-fill happens lazily when needed.'
        ),
      embed_fields: z
        .array(z.string())
        .optional()
        .describe(
          'Restrict embedding text to these fields. Omit to use all string-valued attributes (excluding id/*_id).'
        ),
      hop_depth: z
        .number()
        .int()
        .min(0)
        .max(MAX_HOP_DEPTH)
        .optional()
        .describe(
          `Follow declared associations this many hops deep, ingesting related records into the same analysis session. ` +
            `Default 0 (extract edges only from root records, no follow-up fetches). Max ${MAX_HOP_DEPTH}.`
        ),
      hop_follow: z
        .enum(['declared', 'declared+fk', 'none'])
        .optional()
        .describe(
          'What counts as an edge to follow. "declared" (default): only belongsTo/hasMany declared on the model. ' +
            '"declared+fk": also follow undeclared *_id fields. "none": no edges, even at depth 0.'
        ),
      hop_models: z
        .array(z.string())
        .optional()
        .describe(
          'Whitelist of destination models to traverse into. Omit to follow all declared associations.'
        )
    }
  }

  override getUsageRules(): string[] {
    return []
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const dataLayer = this.requireDataLayer()

      const {
        model,
        analysis_id,
        filters,
        page,
        per_page = 50,
        fields,
        ingest_all = false,
        resume = false,
        user_id,
        parent_model,
        parent_ids,
        child_resource,
        summary_strategy,
        summary_strategies,
        embed_records = true,
        embed_fields,
        hop_depth = 0,
        hop_follow = 'declared',
        hop_models
      } = args as {
        model?: string
        analysis_id: string
        filters?: Record<string, unknown>
        page?: number
        per_page?: number
        fields?: string[]
        ingest_all?: boolean
        resume?: boolean
        user_id?: string
        parent_model?: string
        parent_ids?: string[]
        child_resource?: string
        summary_strategy?: string
        summary_strategies?: string[]
        embed_records?: boolean
        embed_fields?: string[]
        hop_depth?: number
        hop_follow?: HopFollow
        hop_models?: string[]
      }

      const pipeline: IngestPipelineOptions = {
        embedRecords: embed_records,
        embedFields: embed_fields,
        hopDepth: hop_depth,
        hopFollow: hop_follow,
        hopModels: hop_models
      }

      let strategies: string[]
      try {
        strategies = this._resolveStrategies({ summary_strategy, summary_strategies })
      } catch (err) {
        return {
          content: [{ type: 'text', text: (err as Error).message }],
          isError: true
        }
      }

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
          dataLayer,
          analysis_id,
          parent_model,
          child_resource,
          parent_ids,
          fields,
          options,
          strategies
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
          dataLayer,
          model,
          ModelClass,
          modelConfig,
          analysis_id,
          normalizedFilters,
          per_page,
          fields,
          options,
          resume,
          strategies,
          pipeline
        )
      } else {
        return await this._ingestPage(
          dataLayer,
          model,
          ModelClass,
          modelConfig,
          analysis_id,
          normalizedFilters,
          page ?? 1,
          per_page,
          fields,
          options,
          strategies,
          pipeline
        )
      }
    } catch (error) {
      return this.formatError(error as Error)
    }
  }

  /** Fetch and store a single page */
  private async _ingestPage(
    dataLayer: DataLayer,
    model: string,
    ModelClass: ModelConfig,
    modelConfig: ModelConfig,
    analysisId: string,
    filters: Record<string, unknown> | undefined,
    page: number,
    perPage: number,
    fields: string[] | undefined,
    apiOptions: Record<string, unknown>,
    strategies: ReadonlyArray<string>,
    pipeline: IngestPipelineOptions
  ): Promise<ToolResult> {
    let rawRecords: Record<string, unknown>[]
    let totalPages: number | null

    // Resolve convention for extraction and flattening
    const convention = modelConfig.api?.convention ?? defaultConvention

    // Use SearchService if model supports query search and filters provided
    const hasFullText = getSearchConfig(modelConfig)?.query
    const hasSearchParams = filters && Object.keys(filters).length > 0

    if (hasFullText && hasSearchParams) {
      // Use SearchService for filtered ingestion
      const searchClient = this._createSearchService(dataLayer)
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
      const data = (await dataLayer.dispatch(
        'GET',
        modelConfig.api.endpoint,
        undefined,
        queryParams,
        apiOptions
      )) as Record<string, unknown>

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

    // Store records (+ embeddings if enabled) and persist edges
    const stored = await this._storeRecordsAndEdges(
      analysisId,
      model,
      modelConfig,
      records,
      pipeline
    )

    // Expand graph via declared associations (when hop_depth > 0)
    const hopStats = await this._expandAndPersistHops(
      dataLayer,
      analysisId,
      model,
      records,
      pipeline
    )

    // Store page summary as analysis memory (one per strategy)
    await this._runStrategies(strategies, {
      analysisId,
      model,
      page,
      totalPages,
      records,
      fields: effectiveFields
    })

    const fieldsNote = fields ? ` (${fields.length} fields per record)` : ''
    return this.formatResponse(
      `Stored ${stored} record(s)${fieldsNote} (page ${page}/${totalPages ?? '?'}).` +
        `\nAnalysis: ${analysisId}` +
        `\nModel: ${model}` +
        this._formatHopSummary(hopStats),
      { meta: { context: { consumed: true } } }
    )
  }

  /** Auto-paginate and ingest all pages */
  private async _ingestAllPages(
    dataLayer: DataLayer,
    model: string,
    ModelClass: ModelConfig,
    modelConfig: ModelConfig,
    analysisId: string,
    filters: Record<string, unknown> | undefined,
    perPage: number,
    fields: string[] | undefined,
    apiOptions: Record<string, unknown>,
    resume = false,
    strategies: ReadonlyArray<string> = ['distribution'],
    pipeline: IngestPipelineOptions = {
      embedRecords: true,
      hopDepth: 0,
      hopFollow: 'declared'
    }
  ): Promise<ToolResult> {
    let currentPage = 1
    let totalStored = 0
    let totalPages: number | null = null
    let resumedFrom: number | null = null
    const hopTotals: Map<string, number> = new Map()

    // Resume: skip already-stored pages
    if (resume) {
      const existingCount = await getIngestedRecordCount(analysisId, model)
      if (existingCount > 0) {
        currentPage = Math.floor(existingCount / perPage) + 1
        totalStored = existingCount
        resumedFrom = currentPage
      }
    }

    // Resolve convention once for all pages
    const convention = modelConfig.api?.convention ?? defaultConvention

    // Use SearchService if model supports query search and filters provided
    const hasFullText = getSearchConfig(modelConfig)?.query
    const hasSearchParams = filters && Object.keys(filters).length > 0
    const searchClient =
      hasFullText && hasSearchParams ? this._createSearchService(dataLayer) : null

    while (currentPage <= MAX_INGEST_PAGES) {
      let rawRecords: Record<string, unknown>[]

      if (searchClient) {
        // Use SearchService for filtered ingestion
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
        const data = (await dataLayer.dispatch(
          'GET',
          modelConfig.api.endpoint,
          undefined,
          queryParams,
          apiOptions
        )) as Record<string, unknown>

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

      // Store records (+ embeddings if enabled) and persist edges
      const stored = await this._storeRecordsAndEdges(
        analysisId,
        model,
        modelConfig,
        records,
        pipeline
      )
      totalStored += stored

      // Expand graph via declared associations (when hop_depth > 0)
      const hopStats = await this._expandAndPersistHops(
        dataLayer,
        analysisId,
        model,
        records,
        pipeline
      )
      for (const [m, n] of Object.entries(hopStats)) {
        hopTotals.set(m, (hopTotals.get(m) ?? 0) + n)
      }

      // Store page summary (one memory per strategy)
      await this._runStrategies(strategies, {
        analysisId,
        model,
        page: currentPage,
        totalPages,
        records,
        fields: effectiveFields
      })

      // Report progress
      await this.sendProgress({
        progress: currentPage,
        total: totalPages ?? undefined,
        message: `Ingested page ${currentPage}${totalPages ? '/' + totalPages : ''} (${totalStored} records)`
      })

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
    const resumeNote = resumedFrom !== null ? `\nResumed from page ${resumedFrom}.` : ''

    const hopTotalsObj: Record<string, number> = {}
    for (const [m, n] of hopTotals) hopTotalsObj[m] = n

    return this.formatResponse(
      `Stored ${totalStored} record(s)${fieldsNote} across ${pagesIngested} page(s)${capNote}.` +
        resumeNote +
        `\nAnalysis: ${analysisId}` +
        `\nModel: ${model}` +
        this._formatHopSummary(hopTotalsObj),
      { meta: { context: { consumed: true } } }
    )
  }

  /** Ingest nested resources for parent records */
  private async _ingestNestedResources(
    dataLayer: DataLayer,
    analysisId: string,
    parentModel: string,
    childResource: string,
    explicitParentIds: string[] | undefined,
    fields: string[] | undefined,
    apiOptions: Record<string, unknown>,
    strategies: ReadonlyArray<string> = ['distribution']
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
        const endpoint = buildCollectionPath(parentConfig.api.endpoint, parentId, childPath)
        const data = (await dataLayer.dispatch(
          'GET',
          endpoint,
          undefined,
          {},
          apiOptions
        )) as Record<string, unknown>
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

    await this._runParallel(tasks, (completed, total) => {
      void this.sendProgress({
        progress: completed,
        total,
        message: `Fetched nested resources for ${completed}/${total} parents`
      })
    })

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

      // Store page summary for the batch (one memory per strategy)
      await this._runStrategies(strategies, {
        analysisId,
        model: childModelName,
        page: 1,
        totalPages: 1,
        records: allRecords,
        fields
      })
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

  /** Create a SearchService from the given (or bound) DataLayer and serverContext */
  private _createSearchService(dataLayer?: DataLayer): SearchService {
    return createSearchService(
      dataLayer ?? this.requireDataLayer(),
      this.serverContext as Record<string, unknown>
    )
  }

  /**
   * Run async tasks with a concurrency limit.
   *
   * Spawns up to MAX_NESTED_CONCURRENCY workers that pull from a shared task queue.
   * Optional onProgress callback fires after each task completes.
   */
  private async _runParallel(
    tasks: Array<() => Promise<void>>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<void> {
    let next = 0
    let completed = 0
    const total = tasks.length

    async function worker(): Promise<void> {
      while (next < total) {
        const i = next++
        await tasks[i]!()
        completed++
        if (onProgress) onProgress(completed, total)
      }
    }

    await Promise.allSettled(
      Array.from({ length: Math.min(MAX_NESTED_CONCURRENCY, tasks.length) }, () => worker())
    )
  }

  /** Names of all strategies registered with this tool (used for the LLM-facing enum). */
  private _availableStrategyNames(): string[] {
    return (this.summaryStrategies ?? defaultSummaryStrategyRegistry()).names()
  }

  /** Build the schema-level description shown to the LLM for the strategy enum. */
  private _summaryStrategyParamDescription(): string {
    const registry = this.summaryStrategies ?? defaultSummaryStrategyRegistry()
    const head =
      'Summary strategy generating the per-page analysis memory. Default: "distribution". Available:'
    const lines = registry.all().map((s) => `- ${s.name}: ${s.description}`)
    return `${head}\n${lines.join('\n')}`
  }

  /**
   * Resolve which strategy names to run for this invocation. Returns
   * ['distribution'] when neither param is set. Throws if both are set.
   */
  private _resolveStrategies(args: {
    summary_strategy?: string
    summary_strategies?: string[]
  }): string[] {
    if (args.summary_strategy && args.summary_strategies) {
      throw new Error('Provide either `summary_strategy` or `summary_strategies`, not both.')
    }
    if (args.summary_strategies && args.summary_strategies.length > 0) {
      return args.summary_strategies
    }
    if (args.summary_strategy) return [args.summary_strategy]
    return ['distribution']
  }

  /**
   * Store a page of records (optionally embedded) and persist the edges
   * extracted from them. Returns the number of records actually stored.
   */
  private async _storeRecordsAndEdges(
    analysisId: string,
    model: string,
    modelConfig: ModelConfig,
    records: ReadonlyArray<Record<string, unknown>>,
    pipeline: IngestPipelineOptions
  ): Promise<number> {
    const stored = await storeIngestedRecords({
      analysisId,
      model,
      records: records.map((r) => ({ id: r.id as string, data: r })),
      embed: pipeline.embedRecords
        ? pipeline.embedFields
          ? { fields: pipeline.embedFields }
          : true
        : undefined
    })

    if (pipeline.hopFollow !== 'none') {
      const edges = records.flatMap((r) =>
        extractEdgesFromRecord(r, modelConfig.associations, model, {
          hopFollow: pipeline.hopFollow
        })
      )
      if (edges.length > 0) {
        await storeIngestedEdges({ analysisId, edges, hopDepth: 0 })
      }
    }

    return stored
  }

  /**
   * BFS-expand declared associations from the just-stored page of records,
   * persisting records and edges at each hop. Returns counts per destination
   * model so the caller can summarize.
   */
  private async _expandAndPersistHops(
    dataLayer: DataLayer,
    analysisId: string,
    rootModel: string,
    rootRecords: ReadonlyArray<Record<string, unknown>>,
    pipeline: IngestPipelineOptions
  ): Promise<Record<string, number>> {
    const stats: Record<string, number> = {}
    if (pipeline.hopDepth <= 0) return stats
    if (pipeline.hopFollow === 'none') return stats

    const modelConfigs: Record<string, ModelConfig> = {}
    for (const name of Object.keys(this.models)) {
      const cfg = this.getModelConfig(name)
      if (cfg) modelConfigs[name] = cfg
    }

    const generator = expandHops(dataLayer, this.models, modelConfigs, rootModel, rootRecords, {
      maxDepth: pipeline.hopDepth,
      hopFollow: pipeline.hopFollow,
      modelWhitelist: pipeline.hopModels
    })

    for await (const batch of generator) {
      const dstConfig = modelConfigs[batch.model]
      if (!dstConfig) continue

      await this._storeRecordsAndEdges(analysisId, batch.model, dstConfig, batch.records, pipeline)
      stats[batch.model] = (stats[batch.model] ?? 0) + batch.records.length
    }

    return stats
  }

  /** Render a one-line summary of hop expansion for the tool response. */
  private _formatHopSummary(hopStats: Record<string, number>): string {
    const entries = Object.entries(hopStats)
    if (entries.length === 0) return ''
    const parts = entries.map(([model, count]) => `${count} ${model}`)
    return `\nHopped: ${parts.join(', ')}`
  }

  /**
   * Run the named strategies against a page of records. Each strategy
   * produces one analysis_memories row with category page_summary:<strategy>;
   * strategies whose `appliesTo` returns false are silently skipped.
   *
   * Strategies that declare `requires: [...]` get auxiliary slices
   * (edges, embeddings) lazy-loaded once per page before invocation.
   */
  private async _runStrategies(
    strategyNames: ReadonlyArray<string>,
    input: SummaryInput
  ): Promise<void> {
    const registry = this.summaryStrategies ?? defaultSummaryStrategyRegistry()

    const needs = this._collectRequirements(strategyNames, registry)
    let enriched: SummaryInput = input
    if (needs.edges) {
      enriched = { ...enriched, edges: await this._loadEdgesForPage(enriched) }
    }
    if (needs.embeddings) {
      enriched = { ...enriched, embeddings: await this._loadEmbeddingsForPage(enriched) }
    }
    if (needs.domainRegistry && this.domainRegistry) {
      enriched = {
        ...enriched,
        domainRegistry: this.domainRegistry as SummaryInput['domainRegistry']
      }
    }

    for (const name of strategyNames) {
      const strategy = registry.get(name)
      if (!strategy) {
        throw new Error(`Unknown summary strategy: "${name}"`)
      }
      if (strategy.appliesTo && !strategy.appliesTo(enriched)) continue
      const output = await strategy.generate(enriched)
      await storeAnalysisMemory({
        analysisId: enriched.analysisId,
        finding: output.finding,
        category: output.category ?? `page_summary:${strategy.name}`,
        metadata: { ...output.metadata, strategy: strategy.name }
      })
    }
  }

  /** Union of `requires` arrays across the strategies the caller asked for. */
  private _collectRequirements(
    strategyNames: ReadonlyArray<string>,
    registry: ReturnType<typeof defaultSummaryStrategyRegistry>
  ): { edges: boolean; embeddings: boolean; domainRegistry: boolean } {
    let edges = false
    let embeddings = false
    let domainRegistry = false
    for (const name of strategyNames) {
      const strategy = registry.get(name)
      const requires = strategy?.requires ?? []
      for (const r of requires) {
        if (r === 'edges') edges = true
        else if (r === 'embeddings') embeddings = true
        else if (r === 'domainRegistry') domainRegistry = true
      }
    }
    return { edges, embeddings, domainRegistry }
  }

  /** Bulk-load outgoing edges for the records on this page. */
  private async _loadEdgesForPage(input: SummaryInput): Promise<ReadonlyArray<SummaryEdge>> {
    const srcIds: string[] = []
    for (const r of input.records) {
      if (r.id != null) srcIds.push(String(r.id))
    }
    if (srcIds.length === 0) return []
    const rows = await getEdgesForSources(input.analysisId, input.model, srcIds)
    return rows.map((r) => ({
      src_id: r.src_id,
      dst_model: r.dst_model,
      dst_id: r.dst_id,
      edge_type: r.edge_type
    }))
  }

  /** Bulk-load record embeddings for this page (record_id → Float32Array). */
  private async _loadEmbeddingsForPage(
    input: SummaryInput
  ): Promise<ReadonlyMap<string, Float32Array>> {
    const ids: string[] = []
    for (const r of input.records) {
      if (r.id != null) ids.push(String(r.id))
    }
    if (ids.length === 0) return new Map()
    return getEmbeddingsForRecords(input.analysisId, input.model, ids)
  }
}
