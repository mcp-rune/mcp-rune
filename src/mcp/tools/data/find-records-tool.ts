import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { pickFields } from '#src/core/helpers.js'

import type { ToolAnnotations, ToolResult } from '../base-tool.js'
import { BaseTool } from '../base-tool.js'
import { validateFilterParams } from '../validators.js'

/**
 * Tool for finding records by ID or search criteria.
 *
 * Delegates reads to ModelService. Owns MCP concerns:
 * filter validation, field picking, transient context, response formatting.
 *
 * Supports compound IDs (e.g., 'titles/42/assets/7') for nested resources,
 * and parent_path (e.g., 'titles/42/assets') for listing nested collections.
 */
export class FindRecordsTool extends BaseTool {
  override get name(): string {
    return 'find_records'
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Use this when you need raw JSON for one or a few records${scope} to act on programmatically (e.g., before update or delete). Returns full record fields.

For an interactive MCP App where the user can view record details visually, use show_model_app instead.
For large-scale analysis across many pages, use analysis_ingest.

Capabilities:
- Look up a specific record by ID
- Query records with specific filters
- List nested resources using parent_path (e.g., parent_path="titles/42/assets")`
  }

  override get annotations(): ToolAnnotations {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(this.getModelNames()).describe('Model name'),
      record_id: z
        .string()
        .describe(
          "Record ID to find a specific record. Supports compound IDs for nested resources (e.g., 'titles/42/assets/7')."
        )
        .optional(),
      parent_path: z
        .string()
        .describe(
          "Parent path for listing nested collections: '{parent_endpoint}/{parent_id}/{model_endpoint}' " +
            "(e.g., 'titles/42/assets'). Required when model has standalone: false. " +
            'Use list_models to discover parent relationships and endpoint names.'
        )
        .optional(),
      filters: z
        .record(z.string(), z.unknown())
        .describe(
          'Filter parameters specific to the model (call get_filters_guide to see available filters).'
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
      'For large-scale analysis (multiple pages of data), prefer analysis_ingest which stores records for offline querying without polluting context. Use find_records only when you need a specific record by ID or a small set of results to act on immediately (e.g., before updating or deleting).'
    ]
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const service = this.requireDataLayer()

      const { model, record_id, parent_path, filters, page, per_page, user_id, fields } = args as {
        model: string
        record_id?: string
        parent_path?: string
        filters?: Record<string, unknown>
        page?: number
        per_page?: number
        user_id?: string
        fields?: string[]
      }

      this.validateModel(model)
      const options = user_id ? { userId: user_id } : undefined

      // Validate filter params against model's filterable fields
      if (filters) {
        const validation = validateFilterParams(model, filters, this.models)
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
          tool: 'find_records',
          model,
          hasId: !!record_id,
          hasParentPath: !!parent_path,
          impersonating: user_id ?? null
        })
      }

      if (record_id) {
        const data = await service.find(model, record_id, options)
        return this.formatResponse(pickFields(data, fields) as Record<string, unknown>)
      } else {
        const currentPage = page ?? 1
        const data = await service.list(
          model,
          filters,
          { page: currentPage, perPage: per_page ?? 20 },
          { ...options, parentPath: parent_path }
        )

        // Transient context: emit _meta hint for large results
        const records = Array.isArray(data)
          ? data
          : ((data?.data ?? data?.records ?? []) as unknown[])
        const meta =
          (records as unknown[]).length >= 5
            ? {
                context: {
                  lifecycle: 'transient',
                  summary: this._buildTransientSummary(
                    model,
                    records as Record<string, unknown>[],
                    currentPage
                  )
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
  private _buildTransientSummary(
    model: string,
    records: Record<string, unknown>[],
    page: number
  ): string {
    const ids = records.slice(0, 3).map((r) => r.id)
    const idPreview = ids.join(', ') + (records.length > 3 ? '...' : '')
    return `${records.length} ${model} records (page ${page}, IDs: ${idPreview})`
  }
}
