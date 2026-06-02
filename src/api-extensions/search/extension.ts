/**
 * The `search` ApiExtension's MCP tools and registration factory.
 *
 * Contributes `search_records` (raw-JSON filtered search) and
 * `get_filters_guide` (filter discovery for LLMs). Both rely on:
 *   - `getSearchConfig` / `getSearchableModelNames` from `./capabilities`
 *   - `createSearchService` from `./factory`
 *
 * Per-model search config currently lives at `static search` on `BaseModel`
 * — moving to the `extensions['search']` bag is planned for a follow-up
 * release once we're ready to coordinate the change across consumers.
 */

import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { resolveDerivedFields } from '#src/core/derived-fields.js'
import { pickFields } from '#src/core/helpers.js'
import type { ApiExtension } from '#src/mcp/api-extensions/types.js'
import type { ModelConfig, ToolAnnotations, ToolResult } from '#src/mcp/tools/base-tool.js'
import { BaseTool } from '#src/mcp/tools/base-tool.js'
import type { FilterSchema } from '#src/mcp/tools/validators.js'
import { normalizeFilterValues, validateFilterValues } from '#src/mcp/tools/validators.js'

import { getSearchableModelNames, getSearchConfig } from './capabilities.js'
import { createSearchService } from './factory.js'
import type { PaginationInfo } from './types.js'

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
  /** Discovery-only: reads model metadata, no API call needed. */
  static override requiresAuth = false

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

For an interactive MCP App where the user can browse, filter, and select records visually, use find_model_app instead.
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
      const dataLayer = this.requireDataLayer()

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
      const searchClient = createSearchService(
        dataLayer,
        this.serverContext as Record<string, unknown>
      )
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
