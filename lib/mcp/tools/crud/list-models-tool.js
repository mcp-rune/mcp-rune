import { BaseTool } from '../base-tool.js'

/**
 * Tool for listing all available API models
 */
export class ListModelsTool extends BaseTool {
  get name() {
    return 'list_models'
  }

  get baseDescription() {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `List all available models/resources${scope} with their attributes and descriptions.`
  }

  get inputSchema() {
    return {}
  }

  async execute() {
    if (this.logger) {
      this.logger.info('Listing models', { service: 'mcp-tools', tool: 'list_models' })
    }

    const modelList = Object.entries(this.models).map(([modelName, config]) => {
      const attrs = config.attributes || {}
      const enumFields = Object.keys(attrs).filter((k) => attrs[k].enumValues)
      const filters = config.search?.filters

      return {
        name: modelName,
        endpoint: config.endpoint,
        description: config.description,
        attributes: Object.keys(attrs),
        required_attributes: config.required,
        read_only: config.api?.readOnly || false,
        searchable_by: config.search?.autocompleteFields,
        enum_fields: enumFields.length > 0 ? enumFields : undefined,
        belongs_to: config.associations?.belongsTo
          ? Object.keys(config.associations.belongsTo)
          : undefined,
        has_many: config.associations?.hasMany
          ? Object.keys(config.associations.hasMany)
          : undefined,
        filterable_search: filters
          ? {
              available: true,
              filter_count: Object.keys(filters).length,
              hint: 'Call get_filters_guide for filter docs, then use search_records'
            }
          : undefined
      }
    })

    return this.formatResponse(modelList)
  }
}
