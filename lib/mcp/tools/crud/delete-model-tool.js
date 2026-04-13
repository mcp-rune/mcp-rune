import { z } from 'zod'
import { BaseTool } from '../base-tool.js'
import { storeOperation } from '#lib/services/memory-storage.js'

/**
 * Tool for deleting records
 *
 * Supports user_id impersonation for service accounts
 */
export class DeleteModelTool extends BaseTool {
  get name() {
    return 'delete_model'
  }

  get baseDescription() {
    const scope = this.serverContext.name ? ` from the ${this.serverContext.name} API` : ''
    return `Delete a record${scope} by ID. This may cascade to related resources depending on the model.`
  }

  get inputSchema() {
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

  async execute(args) {
    try {
      this.requireApiClient()

      const { model, record_id, user_id } = args

      this.validateModel(model)

      if (!record_id) {
        return {
          content: [
            {
              type: 'text',
              text: 'record_id is required for delete'
            }
          ],
          isError: true
        }
      }

      const modelConfig = this.getModelConfig(model)

      if (modelConfig.api?.readOnly) {
        throw new Error(
          `The '${model}' model is read-only and cannot be deleted. ` +
            `${modelConfig.description ? modelConfig.description + ' ' : ''}` +
            'Use find_model to look up existing records.'
        )
      }

      const options = user_id ? { userId: user_id } : {}

      if (this.logger) {
        this.logger.info('Deleting model', {
          service: 'mcp-tools',
          tool: 'delete_model',
          model,
          record_id,
          impersonating: user_id || null
        })
      }

      await this.apiClient.delete(`${modelConfig.endpoint}/${record_id}`, options)

      // Fire-and-forget: store operation embedding for retrospective analysis
      storeOperation({
        toolName: 'delete_model',
        toolArgs: { model, id: record_id },
        userId: user_id,
        sessionId: this.serverContext?.sessionId
      }).catch((err) => {
        if (this.logger) {
          this.logger.warn('Vector storage failed', { service: 'mcp-tools', error: err.message })
        }
      })

      return this.formatResponse({ success: true, deleted: { model, record_id } })
    } catch (error) {
      return this.formatError(error)
    }
  }
}
