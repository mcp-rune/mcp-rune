/**
 * Search extension — opt-in MCP tools for searchable models.
 *
 * Contributes the `search_records` and `get_filters_guide` MCP tools that
 * expose a model's `static search` config (filters + lookup) to LLMs. The
 * extension is the user-facing surface of the existing in-core search
 * infrastructure (`SearchService`, `SearchAdapter`, `SearchConfig`), which
 * stays in `@mcp-rune/mcp-rune/search` because it's also consumed by
 * non-search features — `analysis-ingest-tool` uses `SearchService` for
 * filtered ingestion, `validators.ts` reads `model.search.filters` to
 * validate filter args on tools like `find_records`, and `list_models`
 * surfaces `search.filters` / `search.lookup.fields` in its output to help
 * LLMs discover capability. Forcing those cross-cutting reads through this
 * extension would mean refactoring features that aren't about search.
 *
 * What this extension *does* deliver: pure REST servers no longer have
 * `search_records` and `get_filters_guide` cluttering their tool namespace
 * — both tools are absent unless `searchExtension()` is registered.
 *
 * Conventional registration key: `search`. Usage:
 *
 * ```ts
 * import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
 * import { searchExtension } from '@mcp-rune/mcp-rune/api-extensions/search'
 *
 * new ToolRegistry({
 *   toolClasses: DATA_TOOL_CLASSES,
 *   models: MODEL_CLASSES,
 *   createApiClient,
 *   apiExtensions: {
 *     search: searchExtension()
 *   }
 * })
 * ```
 *
 * Model `static search` config is unchanged; deeper extraction (moving the
 * config into `extensions['search']` and moving `SearchService` itself out
 * of core) is intentionally deferred — see CHANGELOG for the rationale.
 */

import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { resolveDerivedFields } from '#src/core/derived-fields.js'
import { pickFields } from '#src/core/helpers.js'
import type { ApiExtension } from '#src/mcp/api-extensions/types.js'
import { SearchService } from '#src/mcp/search/search-service.js'
import type { PaginationInfo, SearchConfig } from '#src/mcp/search/types.js'
import type {
  ModelConfig,
  ModelsRegistry,
  ToolAnnotations,
  ToolResult
} from '#src/mcp/tools/base-tool.js'
import { BaseTool } from '#src/mcp/tools/base-tool.js'
import type { ToolCategory } from '#src/mcp/tools/categories.js'
import { TOOL_CATEGORIES } from '#src/mcp/tools/categories.js'
import type { FilterSchema } from '#src/mcp/tools/validators.js'
import { normalizeFilterValues, validateFilterValues } from '#src/mcp/tools/validators.js'

// ============================================================================
// Public API: typed reader
// ============================================================================

/**
 * Read a model's search configuration. Returns `undefined` when the model
 * doesn't declare `static search`, so callers can tolerate the absence
 * without conditionals.
 *
 * Symmetrical with `getActionsConfig()` from the `custom-actions` extension —
 * exposed so extension authors and downstream code have a single, typed
 * read site even though (for now) the underlying field is `model.search`.
 */
export function getSearchConfig(model: ModelConfig): SearchConfig | undefined {
  return (model.search ?? undefined) as SearchConfig | undefined
}

/** Names of models that declare at least one search filter. */
export function getSearchableModelNames(models: ModelsRegistry): string[] {
  return Object.entries(models)
    .filter(([, m]) => {
      const filters = getSearchConfig(m)?.filters
      return filters && Object.keys(filters).length > 0
    })
    .map(([name]) => name)
}

// ============================================================================
// MCP tool — `get_filters_guide`
// ============================================================================

interface FilterConfig {
  label?: string
  type: string
  description?: string
  enumValues?: string[]
  relatedModel?: string
  [key: string]: unknown
}

/**
 * Discovery tool for search filters.
 *
 * Returns a structured guide listing available filters, their types,
 * enum values, and examples. The LLM calls this before `search_records`
 * to learn how to construct filter arguments.
 */
export class GetFiltersGuideTool extends BaseTool {
  static override get category(): ToolCategory {
    return TOOL_CATEGORIES.STRATEGY
  }

  override get name(): string {
    return 'get_filters_guide'
  }

  override get annotations(): ToolAnnotations {
    return {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }

  override get baseDescription(): string {
    return 'Get available search filters for a model. Call before search_records to learn which filters are available and how to use them.'
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(getSearchableModelNames(this.models)).describe(
        'Model name to get filters for'
      )
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { model } = args as { model: string }

    this.validateModel(model)

    const ModelClass = this.models[model]!
    const filters = getSearchConfig(ModelClass)?.filters as Record<string, FilterConfig> | undefined

    if (!filters) {
      const searchable = getSearchableModelNames(this.models)
      return {
        content: [
          {
            type: 'text',
            text: `Model "${model}" does not support search.\n\nSearchable models: ${searchable.join(', ') || 'none'}`
          }
        ],
        isError: true
      }
    }

    const parts: string[] = [`# Search Filters for ${model}\n`]
    parts.push('Use these filters with `search_records` to query records.\n')

    parts.push('| Filter | Type | Description |')
    parts.push('|--------|------|-------------|')

    for (const [name, config] of Object.entries(filters)) {
      const label = config.label || name
      parts.push(`| \`${name}\` | ${config.type} | ${label}: ${config.description || ''} |`)
    }

    parts.push('')

    for (const [name, config] of Object.entries(filters)) {
      parts.push(`## \`${name}\` (${config.type})`)
      parts.push(config.description || '')

      if (config.type === 'enum' && config.enumValues) {
        parts.push(`\nValid values: ${config.enumValues.map((v) => `\`${v}\``).join(', ')}`)
      }
      if (config.type === 'relation' && config.relatedModel) {
        parts.push(
          `\nRelated model: \`${config.relatedModel}\` — use \`find_records\` to look up IDs`
        )
      }
      if (config.type === 'date_range') {
        parts.push(
          '\nFormat: `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` — either field is optional'
        )
      }
      if (config.type === 'integer_range') {
        parts.push('\nFormat: `{ "from": <number>, "to": <number> }` — either field is optional')
      }
      parts.push('')
    }

    parts.push('## Example Usage\n')
    parts.push('```')
    parts.push(`search_records({`)
    parts.push(`  model: "${model}",`)
    parts.push(`  filters: {`)

    const exampleFilters = Object.entries(filters).slice(0, 2)
    for (const [name, config] of exampleFilters) {
      if (config.type === 'text') {
        parts.push(`    ${name}: "search term",`)
      } else if (config.type === 'enum' && config.enumValues) {
        parts.push(`    ${name}: "${config.enumValues[0]}",`)
      } else if (config.type === 'relation') {
        parts.push(`    ${name}: "123",`)
      } else if (config.type === 'date_range') {
        parts.push(`    ${name}: { from: "2024-01-01" },`)
      } else if (config.type === 'integer_range') {
        parts.push(`    ${name}: { from: 30, to: 120 },`)
      }
    }

    parts.push(`  },`)
    parts.push(`  page: 1,`)
    parts.push(`  per_page: 50`)
    parts.push(`})`)
    parts.push('```')

    return this.formatResponse(parts.join('\n'))
  }
}

// ============================================================================
// MCP tool — `search_records`
// ============================================================================

/**
 * Stateless search tool.
 *
 * Validates filter args against the model's filter declaration, then
 * delegates to `SearchService` for query execution.
 */
export class SearchRecordsTool extends BaseTool {
  override get name(): string {
    return 'search_records'
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Use this when you need raw JSON for records${scope} matching text/filter criteria to process programmatically. Returns paginated results.

For an interactive MCP App where the user can browse, filter, and select records visually, use search_records_app instead.
For large-scale analysis across many pages, use analysis_ingest.

Call get_filters_guide first to learn available filters for the target model.`
  }

  override get annotations(): ToolAnnotations {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }

  override getUsageRules(): string[] {
    return [
      'IMPORTANT: Before using this tool, call get_filters_guide to learn which filters are available for the model you want to search.'
    ]
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(getSearchableModelNames(this.models)).describe('Model name to search'),
      filters: z
        .record(z.string(), z.unknown())
        .describe('Search filters (call get_filters_guide to see available filters)'),
      page: z.number().optional().describe('Page number (default: 1)'),
      per_page: z.number().optional().describe('Results per page (max: 200, default: 50)'),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to include in response (e.g., ["id", "name", "status"]). Omit for all fields.'
        )
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      this.requireApiClient()

      const {
        model,
        filters: rawFilters = {},
        page = 1,
        per_page = 50,
        fields
      } = args as {
        model: string
        filters?: Record<string, unknown>
        page?: number
        per_page?: number
        fields?: string[]
      }

      this.validateModel(model)

      const ModelClass = this.models[model]!

      const modelFilters = getSearchConfig(ModelClass)?.filters as
        | Record<string, FilterSchema>
        | undefined
      if (!modelFilters) {
        const searchable = getSearchableModelNames(this.models)
        return {
          content: [
            {
              type: 'text',
              text: `Model "${model}" does not support search.\n\nSearchable models: ${searchable.join(', ') || 'none'}`
            }
          ],
          isError: true
        }
      }

      const filters = normalizeFilterValues(rawFilters, modelFilters)!

      const validationError = this._validateFilters(model, filters, modelFilters)
      if (validationError) {
        return {
          content: [{ type: 'text', text: validationError }],
          isError: true
        }
      }

      if (this.logger) {
        this.logger.info('Searching records', {
          service: 'mcp-tools',
          tool: 'search_records',
          model,
          filterCount: Object.keys(filters).length,
          page
        })
      }

      const clampedPerPage = Math.min(per_page, 200)
      const searchClient = this._createSearchService()
      const { records, pagination } = (await searchClient.search(
        ModelClass as unknown as Parameters<typeof searchClient.search>[0],
        '',
        {
          page,
          perPage: clampedPerPage,
          filters
        }
      )) as unknown as { records: Record<string, unknown>[]; pagination: PaginationInfo }

      resolveDerivedFields(
        records,
        ModelClass as unknown as Parameters<typeof resolveDerivedFields>[1]
      )
      const filteredRecords = pickFields(records, fields)

      const result = {
        schema: this._buildSchema(ModelClass),
        records: filteredRecords,
        pagination
      }

      const meta =
        records.length >= 5
          ? {
              context: {
                lifecycle: 'transient',
                summary: this._buildTransientSummary(model, records, pagination)
              }
            }
          : undefined

      return this.formatResponse(result as unknown as Record<string, unknown>, { meta })
    } catch (error) {
      return this.formatError(error as Error)
    }
  }

  private _buildTransientSummary(
    model: string,
    records: Record<string, unknown>[],
    pagination: PaginationInfo
  ): string {
    const ids = records.slice(0, 3).map((r) => r.id)
    const idPreview = ids.join(', ') + (records.length > 3 ? '...' : '')
    return `${records.length} ${model} records (page ${pagination.page}/${pagination.total_pages}, IDs: ${idPreview})`
  }

  private _createSearchService(): SearchService {
    const ctx = this.serverContext as Record<string, unknown>
    const searchGroups = (ctx?.searchGroups ?? {}) as Record<string, unknown>
    const defaultAdapter = ctx?.defaultAdapter as
      | NonNullable<ConstructorParameters<typeof SearchService>[1]>['defaultAdapter']
      | undefined
    return new SearchService(this.apiClient!, {
      searchGroups,
      defaultAdapter
    } as ConstructorParameters<typeof SearchService>[1])
  }

  private _validateFilters(
    model: string,
    filters: Record<string, unknown>,
    filterSchema: Record<string, FilterSchema>
  ): string | null {
    const unknownFilters = Object.keys(filters).filter((f) => !filterSchema[f])
    if (unknownFilters.length > 0) {
      const available = Object.keys(filterSchema).join(', ')
      return `Unknown filter(s) for ${model}: ${unknownFilters.join(', ')}\n\nAvailable filters: ${available}\n\nCall get_filters_guide("${model}") to see filter documentation.`
    }

    return validateFilterValues(model, filters, filterSchema)
  }

  private _buildSchema(ModelClass: ModelConfig): Record<string, unknown> {
    const attrs = (ModelClass.attributes ?? {}) as Record<string, Record<string, unknown>>
    const columns = Object.entries(attrs)
      .filter(([, config]) => config.prompt_visible !== false)
      .slice(0, 10)
      .map(([name, config]) => ({
        key: name,
        label: (config.label as string) || name,
        type: (config.type as string) || 'string'
      }))

    return {
      model: ModelClass.api?.endpoint?.replace(/s$/, '') ?? '',
      columns
    }
  }
}

// ============================================================================
// Extension factory
// ============================================================================

/**
 * The opt-in `search` API extension. Register on `ToolRegistry` to expose
 * `search_records` and `get_filters_guide` MCP tools for models that
 * declare `static search` config.
 *
 * Conventional registration key: `search`.
 */
export function searchExtension(): ApiExtension {
  return {
    register(ctx) {
      ctx.registerTool('search_records', SearchRecordsTool)
      ctx.registerTool('get_filters_guide', GetFiltersGuideTool)
    }
  }
}
