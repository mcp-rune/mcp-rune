import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type { ToolResult } from '../base-tool.js'
import { BaseTool } from '../base-tool.js'

/**
 * Tool for deleting records.
 *
 * Delegates CRUD to ModelService. Owns MCP concerns:
 * input schema, response formatting, vector storage.
 */
export class DeleteModelTool extends BaseTool {
  override get name(): string {
    return 'delete_model'
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` from the ${this.serverContext.name} API` : ''
    return (
      `Delete a single record${scope} by ID. This may cascade to related resources depending on the model. ` +
      'For multiple records, use bulk_action_models instead — never call this tool more than once per turn.'
    )
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(this.getWritableModelNames()).describe('Model name'),
      record_id: z.string().describe('Record ID to delete'),
      user_id: z
        .string()
        .describe(
          'User ID to impersonate (service accounts only). When provided, deletes resources belonging to the specified user.'
        )
        .optional(),
      plan_id: z
        .string()
        .describe('Plan ID from preview_mutation_plan for batch tracking in Changeset')
        .optional()
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const service = this.requireDataLayer()

      const { model, record_id, user_id } = args as {
        model: string
        record_id?: string
        user_id?: string
      }

      this.validateModel(model)

      if (!record_id) {
        return {
          content: [{ type: 'text', text: 'record_id is required for delete' }],
          isError: true
        }
      }

      const options = user_id ? { userId: user_id } : undefined
      await service.delete(model, record_id, options)

      this.storeToolMemory({
        toolName: 'delete_model',
        toolArgs: { model, id: record_id },
        userId: user_id
      })

      return this.formatResponse({ success: true, deleted: { model, record_id } })
    } catch (error) {
      return this.formatError(error as Error)
    }
  }
}
