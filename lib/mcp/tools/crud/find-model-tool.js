import { z } from 'zod'
import { BaseTool } from '../base-tool.js'
import { validateSearchParams } from '../validators.js'
import { pickFields } from '#lib/core/helpers.js'

/**
 * Tool for finding records by ID or search criteria
 */
export class FindModelTool extends BaseTool {
  get name() {
    return 'find_model'
  }

  get baseDescription() {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Find records${scope} by ID or search criteria. Returns raw JSON data.

Use this tool to:
- Look up a specific record by ID
- Query records with specific search filters
- Get raw record data for further processing`
  }

  get inputSchema() {
    return {
      model: this.zodEnum(this.getModelNames()).describe('Model name'),
      record_id: z.string().describe('Record ID to find a specific record').optional(),
      search: z
        .record(z.string(), z.unknown())
        .describe(
          'Search parameters specific to the model. Use list_models to see which fields are searchable.'
        )
        .optional(),
      page: z.number().describe('Page number for pagination (default: 1)').optional(),
      per_page: z.number().describe('Number of results per page (default: 20)').optional(),
      user_id: z
        .string()
        .describe(
          'User ID to impersonate (service accounts only). When provided, returns resources belonging to the specified user instead of the authenticated user.'
        )
        .optional(),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to include in response (e.g., ["id", "name", "status"]). Omit for all fields.'
        )
    }
  }

  getUsageRules() {
    return []
  }

  async execute(args) {
    try {
      this.requireApiClient()

      const { model, record_id, search, page, per_page, user_id, fields } = args

      this.validateModel(model)

      const modelConfig = this.getModelConfig(model)
      const options = user_id ? { userId: user_id } : {}

      // Validate search params against model's searchable fields
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
        this.logger.info('Finding model', {
          service: 'mcp-tools',
          tool: 'find_model',
          model,
          hasId: !!record_id,
          impersonating: user_id || null
        })
      }

      if (record_id) {
        const data = await this.apiClient.get(`${modelConfig.endpoint}/${record_id}`, {}, options)
        return this.formatResponse(pickFields(data, fields))
      } else {
        // Search/list records
        const currentPage = page || 1
        const queryParams = {
          ...search,
          page: currentPage,
          per_page: per_page || 20
        }
        const data = await this.apiClient.get(modelConfig.endpoint, queryParams, options)

        // Transient context: emit _meta hint for large results so the client
        // can collapse this response after a consumer tool processes it
        const records = Array.isArray(data) ? data : data?.data || data?.records || []
        const meta =
          records.length >= 5
            ? {
                context: {
                  lifecycle: 'transient',
                  summary: this._buildTransientSummary(model, records, currentPage)
                }
              }
            : undefined

        return this.formatResponse(fields ? pickFields(records, fields) : data, { meta })
      }
    } catch (error) {
      return this.formatError(error)
    }
  }

  /**
   * Build a compact summary for post-consumption display
   * @param {string} model - Model name
   * @param {Array} records - Records in the response
   * @param {number} page - Current page number
   * @returns {string}
   */
  _buildTransientSummary(model, records, page) {
    const ids = records.slice(0, 3).map((r) => r.id)
    const idPreview = ids.join(', ') + (records.length > 3 ? '…' : '')
    return `${records.length} ${model} records (page ${page}, IDs: ${idPreview})`
  }
}
