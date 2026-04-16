import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { pickFields } from '#src/core/helpers.js'
import { resolveDerivedFields } from '#src/mcp/apps/derived-fields.js'
import { SearchClient } from '#src/mcp/search/search-client.js'
import { normalizeFilterValues, validateFilterValues } from '#src/mcp/tools/validators.js'

import type { ModelConfig, ToolAnnotations, ToolResult } from '../base-tool.js'
import { BaseTool } from '../base-tool.js'
import type { FilterSchema } from '../validators.js'

interface PaginationInfo {
  page: number
  total_pages: number
  [key: string]: unknown
}

/**
 * Stateless search tool
 *
 * Validates filter args against the model's filter declaration,
 * then delegates to SearchClient for query execution.
 */
export class SearchRecordsTool extends BaseTool {
  override get name(): string {
    return 'search_records'
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Search records${scope} using filters. Returns raw JSON results. Call get_filters_guide first to learn available filters.`
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
    const searchableModels = this._getSearchableModelNames()
    return {
      model: this.zodEnum(searchableModels).describe('Model name to search'),
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

      const modelFilters = ModelClass.search?.filters as Record<string, FilterSchema> | undefined
      if (!modelFilters) {
        const searchable = this._getSearchableModelNames()
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

      // Normalize comma-separated enum strings into arrays, then validate
      const filters = normalizeFilterValues(rawFilters, modelFilters)!

      // Validate provided filters against model's filter declaration
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
      const searchClient = this._createSearchClient()
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

      // Return in list-view compatible shape
      const result = {
        schema: this._buildSchema(ModelClass),
        records: filteredRecords,
        pagination
      }

      // Transient context: emit _meta hint for large results
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

  /** Build a compact summary for post-consumption display */
  private _buildTransientSummary(
    model: string,
    records: Record<string, unknown>[],
    pagination: PaginationInfo
  ): string {
    const ids = records.slice(0, 3).map((r) => r.id)
    const idPreview = ids.join(', ') + (records.length > 3 ? '...' : '')
    return `${records.length} ${model} records (page ${pagination.page}/${pagination.total_pages}, IDs: ${idPreview})`
  }

  /** Create a SearchClient from the tool's apiClient and serverContext */
  private _createSearchClient(): SearchClient {
    const searchGroups = ((this.serverContext as Record<string, unknown>)?.searchGroups ??
      {}) as Record<string, unknown>
    return new SearchClient(
      this.apiClient! as unknown as ConstructorParameters<typeof SearchClient>[0],
      { searchGroups } as unknown as ConstructorParameters<typeof SearchClient>[1]
    )
  }

  /**
   * Validate provided filters against the model's filter schema.
   *
   * Checks both filter keys (must exist in schema) and enum values
   * (must match declared enumValues).
   */
  private _validateFilters(
    model: string,
    filters: Record<string, unknown>,
    filterSchema: Record<string, FilterSchema>
  ): string | null {
    // Phase 1: reject unknown filter keys
    const unknownFilters = Object.keys(filters).filter((f) => !filterSchema[f])
    if (unknownFilters.length > 0) {
      const available = Object.keys(filterSchema).join(', ')
      return `Unknown filter(s) for ${model}: ${unknownFilters.join(', ')}\n\nAvailable filters: ${available}\n\nCall get_filters_guide("${model}") to see filter documentation.`
    }

    // Phase 2: validate enum filter values
    return validateFilterValues(model, filters, filterSchema)
  }

  /** Build schema from model config for list-view compatibility */
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
      model: ModelClass.endpoint?.replace(/s$/, '') ?? '',
      columns
    }
  }

  /** Get model names that have static filters defined */
  private _getSearchableModelNames(): string[] {
    return Object.entries(this.models)
      .filter(
        ([, ModelClass]) =>
          ModelClass.search?.filters && Object.keys(ModelClass.search.filters).length > 0
      )
      .map(([name]) => name)
  }
}
