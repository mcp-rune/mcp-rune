import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { UnknownActionError } from '#src/mcp/services/endpoint-resolver.js'

import type { ToolAnnotations, ToolResult } from '../base-tool.js'
import { BaseTool } from '../base-tool.js'

/**
 * Tool for executing custom actions on models.
 *
 * Custom actions are model-specific operations beyond standard CRUD,
 * declared on the model's `api.actions` config. Each action specifies
 * an HTTP method and URL path template with Rails-style named parameters.
 *
 * Delegates to ModelService.action(). Owns MCP concerns:
 * input schema, response formatting, action discovery.
 */
export class ModelActionTool extends BaseTool {
  override get name(): string {
    return 'model_action'
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
    const actionSummary = this._buildActionSummary()
    return (
      `Execute a custom action on a model${scope}. ` +
      `Actions are model-specific operations beyond standard CRUD.` +
      actionSummary
    )
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(this._getModelsWithActions()).describe(
        'Model name with available actions'
      ),
      action: z.string().describe('Action name as declared on the model'),
      record_id: z
        .string()
        .describe(
          'Record ID (required for record-level actions). Supports compound IDs for nested resources.'
        )
        .optional(),
      attributes: z
        .record(z.string(), z.unknown())
        .describe('Action payload attributes (for POST/PUT/PATCH actions)')
        .optional(),
      path_params: z
        .record(z.string(), z.string())
        .describe("Named path parameters for URL template substitution (e.g., { chapter_id: '5' })")
        .optional(),
      params: z
        .record(z.string(), z.unknown())
        .describe('Query parameters (for GET actions)')
        .optional(),
      user_id: z.string().describe('User ID to impersonate (service accounts only).').optional()
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const service = this.requireModelService()

      const { model, action, record_id, attributes, path_params, params, user_id } = args as {
        model: string
        action: string
        record_id?: string
        attributes?: Record<string, unknown>
        path_params?: Record<string, string>
        params?: Record<string, unknown>
        user_id?: string
      }

      this.validateModel(model)

      const data = await service.action(model, action, {
        recordId: record_id,
        pathParams: path_params,
        attributes,
        params,
        requestOptions: user_id ? { userId: user_id } : undefined
      })

      return this.formatResponse({ status: 'success', model, action, data })
    } catch (error) {
      if (error instanceof UnknownActionError) {
        return {
          content: [{ type: 'text', text: error.message }],
          isError: true
        }
      }
      return this.formatError(error as Error)
    }
  }

  /** List models that have actions declared. */
  private _getModelsWithActions(): string[] {
    return Object.keys(this.models).filter((name) => {
      const actions = this.models[name]!.api?.actions
      return actions && Object.keys(actions).length > 0
    })
  }

  /** Build a summary of available actions for the tool description. */
  private _buildActionSummary(): string {
    const lines: string[] = []
    for (const [model, config] of Object.entries(this.models)) {
      const actions = config.api?.actions
      if (!actions) continue
      const entries = Object.entries(actions)
      if (entries.length > 0) {
        const actionDescriptions = entries
          .map(([name, def]) => {
            const method = def.method ?? 'POST'
            const desc = def.description ? ` — ${def.description}` : ''
            return `  ${name} (${method})${desc}`
          })
          .join('\n')
        lines.push(`${model}:\n${actionDescriptions}`)
      }
    }
    return lines.length > 0 ? `\n\nAvailable actions:\n${lines.join('\n')}` : ''
  }
}
