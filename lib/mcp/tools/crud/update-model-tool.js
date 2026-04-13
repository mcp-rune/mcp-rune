import { z } from 'zod'
import { SaveModelBaseTool } from '../save-model-base-tool.js'
import { storeOperation } from '#lib/services/memory-storage.js'

/**
 * Tool for updating existing records
 *
 * Uses Rails convention: wraps attributes in model key { [model]: attributes }
 * Supports user_id impersonation for service accounts
 */
export class UpdateModelTool extends SaveModelBaseTool {
  get name() {
    return 'update_model'
  }

  get baseDescription() {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Update an existing record${scope}. Only include the attributes you want to change.`
  }

  get inputSchema() {
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

  async execute(args) {
    try {
      this.requireApiClient()

      const { model, record_id, attributes, user_id } = args

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

      const modelConfig = this.getModelConfig(model)

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
          impersonating: user_id || null
        })
      }

      // Build payload using server-specific adapter
      const data = await this.apiClient.patch(
        `${modelConfig.endpoint}/${record_id}`,
        this.buildRequestPayload(model, attributes),
        options
      )

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
        sessionId: this.serverContext?.sessionId
      }).catch((err) => {
        if (this.logger) {
          this.logger.warn('Vector storage failed', { service: 'mcp-tools', error: err.message })
        }
      })

      return this.formatResponse({ status: 'updated', model, id: record_id })
    } catch (error) {
      return this.formatError(error)
    }
  }
}
