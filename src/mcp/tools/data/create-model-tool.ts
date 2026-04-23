import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { MissingRequiredFieldsError } from '#src/mcp/services/model-service.js'
import { storeOperation } from '#src/services/vector-storage.js'

import type { ToolAnnotations, ToolResult } from '../base-tool.js'
import { SaveModelBaseTool } from '../save-model-base-tool.js'

/**
 * Tool for creating new records.
 *
 * Delegates CRUD to ModelService. Owns MCP concerns:
 * input schema, response formatting, vector storage, usage rules.
 *
 * Supports parent_path for creating nested resources
 * (e.g., parent_path="titles/42/assets").
 */
export class CreateModelTool extends SaveModelBaseTool {
  override get name(): string {
    return 'create_model'
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
    return `Create a new record${scope}. Provide the required attributes for the model.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(this.getWritableModelNames()).describe(
        'Model name to create. For complex models: call get_prompt_guide first to get valid attribute values.'
      ),
      attributes: z.record(z.string(), z.unknown()).describe('Model attributes as key-value pairs'),
      parent_path: z
        .string()
        .describe(
          "Parent path for nested model creation (e.g., 'titles/42/assets'). " +
            'Required for nested-only models.'
        )
        .optional(),
      user_id: z
        .string()
        .describe(
          'User ID to impersonate (service accounts only). When provided, creates resources belonging to the specified user.'
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
      const service = this.requireModelService()

      const { model, attributes, parent_path, user_id } = args as {
        model: string
        attributes: Record<string, unknown>
        parent_path?: string
        user_id?: string
      }

      this.validateModel(model)
      const options = { userId: user_id, parentPath: parent_path }

      const data = await service.create(model, attributes, options)

      // Fire-and-forget: store operation embedding for retrospective analysis
      storeOperation({
        toolName: 'create_model',
        toolArgs: { model, attributes },
        toolOutput: data,
        userId: user_id,
        sessionId: (this.serverContext as Record<string, unknown>)?.sessionId as string | undefined
      }).catch((err: Error) => {
        if (this.logger) {
          this.logger.warn('Vector storage failed', { service: 'mcp-tools', error: err.message })
        }
      })

      return this.formatResponse({ status: 'created', model, id: data.id })
    } catch (error) {
      if (error instanceof MissingRequiredFieldsError) {
        return {
          content: [{ type: 'text', text: error.message }],
          isError: true
        }
      }
      return this.formatError(error as Error)
    }
  }
}
