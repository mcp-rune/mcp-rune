import { getActionsConfig } from '#src/api-extensions/custom-actions.js'
import { getSearchConfig } from '#src/api-extensions/search/index.js'

import type { ToolAnnotations, ToolResult } from '../base-tool.js'
import { BaseTool } from '../base-tool.js'

/**
 * Tool for listing all available API models
 */
export class ListModelsTool extends BaseTool {
  override get name(): string {
    return 'list_models'
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Use this when you need to discover the model schemas (data types) available${scope} — their attributes, filterability, and relationships. This is metadata, not records.

For listing the actual records of a model, use list_model_app (visual table) or search_records / find_records (raw JSON).`
  }

  override get annotations(): ToolAnnotations {
    return {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }

  override get inputSchema(): Record<string, never> {
    return {}
  }

  override async execute(): Promise<ToolResult> {
    if (this.logger) {
      this.logger.info('Listing models', { service: 'mcp-tools', tool: 'list_models' })
    }

    const modelList = Object.entries(this.models).map(([modelName, config]) => {
      const attrs = config.attributes ?? {}
      const enumFields = Object.keys(attrs).filter(
        (k) => (attrs[k] as Record<string, unknown>)?.enumValues
      )
      const searchCfg = getSearchConfig(config)
      const filters = searchCfg?.filters

      const actionsCfg = getActionsConfig(config)?.actions
      const actions = actionsCfg
        ? Object.entries(actionsCfg).map(([name, def]) => ({
            name,
            method: def.method ?? 'POST',
            description: def.description
          }))
        : undefined

      return {
        name: modelName,
        endpoint: config.api.endpoint,
        description: config.description,
        attributes: Object.keys(attrs),
        required_attributes: (config as Record<string, unknown>).required,
        read_only: config.api?.readOnly ?? false,
        parent: config.api?.parent ?? undefined,
        standalone: config.api?.standalone === false ? false : undefined,
        searchable_by: searchCfg?.lookup?.fields,
        enum_fields: enumFields.length > 0 ? enumFields : undefined,
        belongs_to: config.associations?.belongsTo
          ? Object.keys(config.associations.belongsTo)
          : undefined,
        has_many: config.associations?.hasMany
          ? Object.keys(config.associations.hasMany)
          : undefined,
        actions: actions?.length ? actions : undefined,
        filterable_search: filters
          ? {
              available: true,
              filter_count: Object.keys(filters).length,
              hint: 'Call get_filters_guide for filter docs, then use search_records (raw JSON) or search_model_app (interactive)'
            }
          : undefined
      }
    })

    return this.formatResponse(modelList as unknown as Record<string, unknown>)
  }
}
