import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { storeOperation } from '#src/services/vector-storage.js'

import type { ToolAnnotations, ToolResult } from '../base-tool.js'
import { SaveModelBaseTool } from '../save-model-base-tool.js'

/**
 * Tool for updating existing records
 *
 * Uses convention-based payload wrapping.
 * Supports user_id impersonation for service accounts.
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
    return `Update an existing record${scope}. Only include the attributes you want to change.`
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
      this.requireApiClient()

      const { model, record_id, attributes, user_id } = args as {
        model: string
        record_id?: string
        attributes: Record<string, unknown>
        user_id?: string
      }

      this.validateModel(model)

      if (!record_id) {
        return {
          content: [
            {
              type: 'text',
              text: 'record_id is required for update'
            }
          ],
          isError: true
        }
      }

      const modelConfig = this.getModelConfig(model)!

      if (modelConfig.api?.readOnly) {
        throw new Error(
          `The '${model}' model is read-only and cannot be updated. ` +
            `${modelConfig.description ? modelConfig.description + ' ' : ''}` +
            'Use find_model to look up existing records.'
        )
      }

      const options = user_id ? { userId: user_id } : {}

      if (this.logger) {
        this.logger.info('Updating model', {
          service: 'mcp-tools',
          tool: 'update_model',
          model,
          record_id,
          impersonating: user_id ?? null
        })
      }

      // Build payload using convention adapter
      // Cast to allow server-specific options (e.g., userId impersonation)
      const api = this.apiClient! as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      >
      const data = (await api.patch!(
        `${modelConfig.endpoint}/${record_id}`,
        this.buildRequestPayload(model, attributes),
        options
      )) as Record<string, unknown>

      if (this.logger) {
        this.logger.info('Model updated successfully', {
          service: 'mcp-tools',
          tool: 'update_model',
          model,
          record_id
        })
      }

      // Fire-and-forget: store operation embedding for retrospective analysis
      storeOperation({
        toolName: 'update_model',
        toolArgs: { model, id: record_id, attributes },
        toolOutput: data,
        userId: user_id,
        sessionId: (this.serverContext as Record<string, unknown>)?.sessionId as string | undefined
      }).catch((err: Error) => {
        if (this.logger) {
          this.logger.warn('Vector storage failed', { service: 'mcp-tools', error: err.message })
        }
      })

      return this.formatResponse({ status: 'updated', model, id: record_id })
    } catch (error) {
      return this.formatError(error as Error)
    }
  }
}
