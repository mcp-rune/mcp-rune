import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { storeOperation } from '#src/services/vector-storage.js'

import type { ToolAnnotations, ToolResult } from '../base-tool.js'
import { SaveModelBaseTool } from '../save-model-base-tool.js'

/**
 * Tool for creating new records
 *
 * Uses convention-based payload wrapping.
 * Supports user_id impersonation for service accounts.
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
      this.requireApiClient()

      const { model, attributes, user_id } = args as {
        model: string
        attributes: Record<string, unknown>
        user_id?: string
      }

      this.validateModel(model)

      const modelConfig = this.getModelConfig(model)!

      if (modelConfig.api?.readOnly) {
        throw new Error(
          `The '${model}' model is read-only and cannot be created. ` +
            `${modelConfig.description ? modelConfig.description + ' ' : ''}` +
            'Use find_model to look up existing records.'
        )
      }

      const options = user_id ? { userId: user_id } : {}

      // Resolve nested path template when model has nested routing
      let endpoint = modelConfig.endpoint
      const nested = modelConfig.api?.nested
      if (nested?.nestedOnly) {
        const parentId = attributes[nested.parentKey!] as string | undefined
        if (parentId) {
          endpoint = nested.pathTemplate!.replace(`:${nested.parentKey}`, parentId)
        } else {
          throw new Error(
            `'${model}' requires parent. Provide '${nested.parentKey}' in attributes.`
          )
        }
      } else if (nested?.pathTemplate) {
        const parentId = attributes[nested.parentKey!] as string | undefined
        if (parentId) {
          endpoint = nested.pathTemplate.replace(`:${nested.parentKey}`, parentId)
        }
      }

      // Validate required fields
      const missingFields = (
        ((modelConfig as Record<string, unknown>).required as string[]) ?? []
      ).filter((field: string) => !attributes || attributes[field] === undefined)

      if (missingFields.length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Missing required fields: ${missingFields.join(', ')}`
            }
          ],
          isError: true
        }
      }

      if (this.logger) {
        this.logger.info('Creating model', {
          service: 'mcp-tools',
          tool: 'create_model',
          model,
          impersonating: user_id ?? null
        })
      }

      // Build payload using convention adapter
      const data = await this.apiClient!.post(
        endpoint,
        this.buildRequestPayload(model, attributes),
        options
      )

      if (this.logger) {
        this.logger.info('Model created successfully', {
          service: 'mcp-tools',
          tool: 'create_model',
          model,
          id: data.id
        })
      }

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
      return this.formatError(error as Error)
    }
  }
}
