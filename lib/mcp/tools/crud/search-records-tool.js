import { z } from 'zod'
import { BaseTool } from '../base-tool.js'
import { SearchClient } from '#lib/mcp/search/search-client.js'
import { validateFilterValues, normalizeFilterValues } from '#lib/mcp/tools/validators.js'
import { pickFields } from '#lib/core/helpers.js'
import { resolveDerivedFields } from '#lib/mcp/apps/derived-fields.js'

/**
 * Stateless search tool
 *
 * Validates filter args against the model's `static filters` declaration,
 * then delegates to SearchClient for query execution. Returns results in
 * the same shape as list_records_view for list-view app compatibility.
 */
export class SearchRecordsTool extends BaseTool {
  get name() {
    return 'search_records'
  }

  get baseDescription() {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Search records${scope} using filters. Returns raw JSON results. Call get_filters_guide first to learn available filters.`
  }

  getUsageRules() {
    return [
      'IMPORTANT: Before using this tool, call get_filters_guide to learn which filters are available for the model you want to search.'
    ]
  }

  get inputSchema() {
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

  async execute(args) {
    try {
      this.requireApiClient()

      const { model, filters: rawFilters = {}, page = 1, per_page = 50, fields } = args

      this.validateModel(model)

      const ModelClass = this.models[model]

      const modelFilters = ModelClass.search?.filters
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
      const filters = normalizeFilterValues(rawFilters, modelFilters)

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
      const { records, pagination } = await searchClient.search(ModelClass, null, {
        page,
        perPage: clampedPerPage,
        filters
      })

      resolveDerivedFields(records, ModelClass)
      const filteredRecords = pickFields(records, fields)

      // Return in list-view compatible shape
      const result = {
        schema: this._buildSchema(ModelClass),
        records: filteredRecords,
        pagination
      }

      // Transient context: emit _meta hint for large results so the client
      // can collapse this response after a consumer tool (e.g., store_analysis_memory) processes it
      const meta =
        records.length >= 5
          ? {
              context: {
                lifecycle: 'transient',
                summary: this._buildTransientSummary(model, records, pagination)
              }
            }
          : undefined

      return this.formatResponse(result, { meta })
    } catch (error) {
      return this.formatError(error)
    }
  }

  /**
   * Build a compact summary for post-consumption display
   * @param {string} model - Model name
   * @param {Array} records - Records in the response
   * @param {Object} pagination - Pagination metadata
   * @returns {string}
   */
  _buildTransientSummary(model, records, pagination) {
    const ids = records.slice(0, 3).map((r) => r.id)
    const idPreview = ids.join(', ') + (records.length > 3 ? '…' : '')
    return `${records.length} ${model} records (page ${pagination.page}/${pagination.total_pages}, IDs: ${idPreview})`
  }

  /**
   * Create a SearchClient from the tool's apiClient and serverContext
   * @returns {SearchClient}
   * @private
   */
  _createSearchClient() {
    const searchGroups = this.serverContext?.searchGroups || {}
    return new SearchClient(this.apiClient, { searchGroups })
  }

  /**
   * Validate provided filters against the model's filter schema.
   *
   * Checks both filter keys (must exist in schema) and enum values
   * (must match declared enumValues).
   *
   * @param {string} model - Model name
   * @param {Object} filters - Provided filters
   * @param {Object} filterSchema - Model's filter declarations
   * @returns {string|null} Error message or null if valid
   * @private
   */
  _validateFilters(model, filters, filterSchema) {
    // Phase 1: reject unknown filter keys
    const unknownFilters = Object.keys(filters).filter((f) => !filterSchema[f])
    if (unknownFilters.length > 0) {
      const available = Object.keys(filterSchema).join(', ')
      return `Unknown filter(s) for ${model}: ${unknownFilters.join(', ')}\n\nAvailable filters: ${available}\n\nCall get_filters_guide("${model}") to see filter documentation.`
    }

    // Phase 2: validate enum filter values
    return validateFilterValues(model, filters, filterSchema)
  }

  /**
   * Build schema from model class for list-view compatibility
   * @param {Object} ModelClass - Model class
   * @returns {Object} Schema object
   * @private
   */
  _buildSchema(ModelClass) {
    const columns = Object.entries(ModelClass.attributes)
      .filter(([, config]) => config.prompt_visible !== false)
      .slice(0, 10) // Reasonable column limit for list view
      .map(([name, config]) => ({
        key: name,
        label: config.label || name,
        type: config.type || 'string'
      }))

    return {
      model: ModelClass.endpoint?.replace(/s$/, '') || '',
      columns
    }
  }

  /**
   * Get model names that have static filters defined
   * @returns {string[]}
   * @private
   */
  _getSearchableModelNames() {
    return Object.entries(this.models)
      .filter(
        ([, ModelClass]) =>
          ModelClass.search?.filters && Object.keys(ModelClass.search.filters).length > 0
      )
      .map(([name]) => name)
  }
}
