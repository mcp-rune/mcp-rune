import { z } from 'zod'
import { BaseTool } from '../base-tool.js'
import type { ToolResult, ToolAnnotations } from '../base-tool.js'
import type { ZodTypeAny } from 'zod'
import { validateSearchParams } from '../validators.js'
import { pickFields } from '#src/core/helpers.js'

/**
 * Tool for finding records by ID or search criteria
 */
export class FindModelTool extends BaseTool {
  override get name(): string {
    return 'find_model'
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Find records${scope} by ID or search criteria. Returns raw JSON data.

Use this tool to:
- Look up a specific record by ID
- Query records with specific search filters
- Get raw record data for further processing`
  }

  override get annotations(): ToolAnnotations {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
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

  override getUsageRules(): string[] {
    return [
      'For large-scale analysis (multiple pages of data), prefer analysis_ingest which stores records for offline querying without polluting context. Use find_model only when you need a specific record by ID or a small set of results to act on immediately (e.g., before updating or deleting).'
    ]
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      this.requireApiClient()

      const { model, record_id, search, page, per_page, user_id, fields } = args as {
        model: string
        record_id?: string
        search?: Record<string, unknown>
        page?: number
        per_page?: number
        user_id?: string
        fields?: string[]
      }

      this.validateModel(model)

      const modelConfig = this.getModelConfig(model)!
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
          impersonating: user_id ?? null
        })
      }

      // Cast to allow server-specific options (e.g., userId impersonation)
      const api = this.apiClient! as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>

      if (record_id) {
        const data = await api.get!(`${modelConfig.endpoint}/${record_id}`, {}, options)
        return this.formatResponse(pickFields(data, fields) as Record<string, unknown>)
      } else {
        // Search/list records
        const currentPage = page ?? 1
        const queryParams = {
          ...search,
          page: currentPage,
          per_page: per_page ?? 20
        }
        const data = (await api.get!(modelConfig.endpoint, queryParams, options)) as Record<string, unknown>

        // Transient context: emit _meta hint for large results so the client
        // can collapse this response after a consumer tool processes it
        const records = Array.isArray(data) ? data : ((data?.data ?? data?.records ?? []) as unknown[])
        const meta =
          (records as unknown[]).length >= 5
            ? {
                context: {
                  lifecycle: 'transient',
                  summary: this._buildTransientSummary(model, records as Record<string, unknown>[], currentPage)
                }
              }
            : undefined

        return this.formatResponse(
          (fields ? pickFields(records, fields) : data) as Record<string, unknown>,
          { meta }
        )
      }
    } catch (error) {
      return this.formatError(error as Error)
    }
  }

  /** Build a compact summary for post-consumption display */
  private _buildTransientSummary(model: string, records: Record<string, unknown>[], page: number): string {
    const ids = records.slice(0, 3).map((r) => r.id)
    const idPreview = ids.join(', ') + (records.length > 3 ? '...' : '')
    return `${records.length} ${model} records (page ${page}, IDs: ${idPreview})`
  }
}
