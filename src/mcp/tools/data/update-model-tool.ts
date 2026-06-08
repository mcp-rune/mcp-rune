import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { SaveModelBaseTool } from '../save-model-base-tool.js'
import type { ToolAnnotations, ToolResult } from '../tool-result.js'

/**
 * Tool for updating existing records.
 *
 * Delegates CRUD to ModelService. Owns MCP concerns:
 * input schema, response formatting, vector storage, usage rules.
 */
export class UpdateModelTool extends SaveModelBaseTool {
  override get name(): string {
    return 'update_model'
  }

  override get annotations(): ToolAnnotations {
    return {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return (
      `Update a single existing record${scope}. Only include the attributes you want to change. ` +
      'For multiple records, use bulk_action_models instead — never call this tool more than once per turn.'
    )
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(this.getWritableModelNames()).describe(
        'Model name. For complex models: call get_prompt_guide first for valid attribute values.'
      ),
      record_id: z.string().describe('Record ID to update'),
      attributes: z
        .record(z.string(), z.unknown())
        .describe('Attributes to update as key-value pairs'),
      user_id: z
        .string()
        .describe(
          'User ID to impersonate (service accounts only). When provided, updates resources belonging to the specified user.'
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

      const { model, record_id, attributes, user_id } = args as {
        model: string
        record_id?: string
        attributes: Record<string, unknown>
        user_id?: string
      }

      this.validateModel(model)

      if (!record_id) {
        return {
          content: [{ type: 'text', text: 'record_id is required for update' }],
          isError: true
        }
      }

      const options = user_id ? { userId: user_id } : undefined
      const data = await service.update(model, record_id, attributes, options)

      this.storeToolMemory({
        toolName: 'update_model',
        toolArgs: { model, id: record_id, attributes },
        toolOutput: data,
        userId: user_id
      })

      return this.formatResponse({ status: 'updated', model, id: record_id })
    } catch (error) {
      return this.formatError(error as Error)
    }
  }
}
