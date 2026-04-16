import { z } from 'zod'
import { BaseTool } from '../base-tool.js'
import type { ToolResult, ToolAnnotations } from '../base-tool.js'
import type { ZodTypeAny } from 'zod'
import type { NestedValidationError } from '../validators.js'
import { validateNestedResource } from '../validators.js'
import { sanitizeResponseData, pickFields } from '#src/core/helpers.js'

/**
 * Tool for getting nested resources (related records)
 */
export class GetNestedResourcesTool extends BaseTool {
  override get name(): string {
    return 'get_nested_resources'
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Get nested resources for a parent record${scope}.

Examples:
- Get books for an activity: parent_model="activity", child_resource="books"
- Get categories for a theme: parent_model="theme", child_resource="categories"
- Get tags for a book: parent_model="book", child_resource="tags"`
  }

  override get annotations(): ToolAnnotations {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      parent_model: this.zodEnum(this.getModelNames()).describe('Parent model name'),
      parent_id: z.string().describe('Parent record ID'),
      child_resource: z
        .string()
        .describe("Child resource name (e.g., 'books', 'categories', 'tags')"),
      page: z.number().describe('Page number for pagination').optional(),
      per_page: z.number().describe('Number of results per page').optional(),
      expand: z
        .string()
        .describe(
          'Comma-separated list of associations to expand. Only works with expandable links as defined in model metadata.'
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

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      this.requireApiClient()

      const { parent_model, parent_id, child_resource, page, per_page, expand, fields } = args as {
        parent_model: string
        parent_id: string
        child_resource: string
        page?: number
        per_page?: number
        expand?: string
        fields?: string[]
      }

      this.validateModel(parent_model)

      // Validate nested resource using association metadata
      const validation = validateNestedResource(parent_model, child_resource, this.models)

      if (!validation.valid) {
        const err = validation as NestedValidationError
        if (this.logger) {
          this.logger.error('Nested resource validation failed', {
            service: 'mcp-tools',
            tool: this.name,
            parentModel: parent_model,
            parentId: parent_id,
            childResource: child_resource,
            error: err.error,
            availableLinks: err.availableLinks,
            suggestion: err.suggestion
          })
        }
        return {
          content: [{ type: 'text', text: `${err.error}\n${err.suggestion}` }],
          isError: true
        }
      }

      const parentConfig = this.models[parent_model]!
      // Use custom path if defined in link info, otherwise use child_resource directly
      const linkInfo = validation.linkInfo as Record<string, unknown> | undefined
      const childPath = (linkInfo?.path as string) || child_resource
      const endpoint = `${parentConfig.endpoint}/${parent_id}/${childPath}`

      const params: Record<string, unknown> = {}
      if (page) params.page = page
      if (per_page) params.per_page = per_page

      // Apply expand parameter: explicit or auto-expand from target model metadata
      if (expand) {
        params.expand = expand
      } else {
        const targetModel = linkInfo?.target_model as string | undefined
        if (targetModel && this.models[targetModel]) {
          const targetModelConfig = this.models[targetModel]!
          const assoc = targetModelConfig.associations

          if (assoc) {
            const autoExpandLinks: string[] = []

            if (assoc.belongsTo) {
              Object.entries(assoc.belongsTo).forEach(([linkName, linkConfig]) => {
                if ((linkConfig as unknown as Record<string, unknown>).auto_expand) {
                  autoExpandLinks.push(linkName)
                }
              })
            }

            if (assoc.hasMany) {
              Object.entries(assoc.hasMany).forEach(([linkName, linkConfig]) => {
                if ((linkConfig as unknown as Record<string, unknown>).auto_expand) {
                  autoExpandLinks.push(linkName)
                }
              })
            }

            if (autoExpandLinks.length > 0) {
              params.expand = autoExpandLinks.join(',')
              if (this.logger) {
                this.logger.debug('Auto-expanding associations from model metadata', {
                  service: 'mcp-tools',
                  tool: this.name,
                  targetModel,
                  autoExpand: params.expand as string
                })
              }
            }
          }
        }
      }

      const response = await this.apiClient!.get(endpoint, params)

      const filtered = pickFields(response, fields)
      return {
        content: [{ type: 'text', text: sanitizeResponseData(filtered) }]
      }
    } catch (error) {
      return this.formatError(error as Error)
    }
  }
}
