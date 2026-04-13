import { BaseTool } from '../base-tool.js'

/**
 * Discovery tool for ES search filters
 *
 * Returns a structured guide listing available filters, their types,
 * enum values, and examples. The LLM calls this before search_records
 * to learn how to construct filter arguments.
 */
export class GetFiltersGuideTool extends BaseTool {
  static get category() {
    return 'strategy'
  }

  get name() {
    return 'get_filters_guide'
  }

  get baseDescription() {
    return 'Get available search filters for a model. Call before search_records to learn which filters are available and how to use them.'
  }

  get inputSchema() {
    const searchableModels = this._getSearchableModelNames()
    return {
      model: this.zodEnum(searchableModels).describe('Model name to get filters for')
    }
  }

  async execute(args) {
    const { model } = args

    this.validateModel(model)

    const ModelClass = this.models[model]
    const filters = ModelClass.search?.filters

    if (!filters) {
      const searchable = this._getSearchableModelNames()
      return {
        content: [
          {
            type: 'text',
            text: `Model "${model}" does not support search.\n\nSearchable models: ${searchable.join(', ') || 'none'}`
          }
        ],
        isError: true
      }
    }

    const parts = [`# Search Filters for ${model}\n`]
    parts.push('Use these filters with `search_records` to query records.\n')

    // Filter reference table
    parts.push('| Filter | Type | Description |')
    parts.push('|--------|------|-------------|')

    for (const [name, config] of Object.entries(filters)) {
      const label = config.label || name
      parts.push(`| \`${name}\` | ${config.type} | ${label}: ${config.description || ''} |`)
    }

    parts.push('')

    // Detailed filter documentation
    for (const [name, config] of Object.entries(filters)) {
      parts.push(`## \`${name}\` (${config.type})`)
      parts.push(config.description || '')

      if (config.type === 'enum' && config.enumValues) {
        parts.push(`\nValid values: ${config.enumValues.map((v) => `\`${v}\``).join(', ')}`)
      }
      if (config.type === 'relation' && config.relatedModel) {
        parts.push(
          `\nRelated model: \`${config.relatedModel}\` — use \`find_model\` to look up IDs`
        )
      }
      if (config.type === 'date_range') {
        parts.push(
          '\nFormat: `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` — either field is optional'
        )
      }
      if (config.type === 'integer_range') {
        parts.push('\nFormat: `{ "from": <number>, "to": <number> }` — either field is optional')
      }
      parts.push('')
    }

    // Usage example
    parts.push('## Example Usage\n')
    parts.push('```')
    parts.push(`search_records({`)
    parts.push(`  model: "${model}",`)
    parts.push(`  filters: {`)

    const exampleFilters = Object.entries(filters).slice(0, 2)
    for (const [name, config] of exampleFilters) {
      if (config.type === 'text') {
        parts.push(`    ${name}: "search term",`)
      } else if (config.type === 'enum' && config.enumValues) {
        parts.push(`    ${name}: "${config.enumValues[0]}",`)
      } else if (config.type === 'relation') {
        parts.push(`    ${name}: "123",`)
      } else if (config.type === 'date_range') {
        parts.push(`    ${name}: { from: "2024-01-01" },`)
      } else if (config.type === 'integer_range') {
        parts.push(`    ${name}: { from: 30, to: 120 },`)
      }
    }

    parts.push(`  },`)
    parts.push(`  page: 1,`)
    parts.push(`  per_page: 50`)
    parts.push(`})`)
    parts.push('```')

    return this.formatResponse(parts.join('\n'))
  }

  /**
   * Get model names that have static filters defined
   * @returns {string[]}
   * @private
   */
  _getSearchableModelNames() {
    return Object.entries(this.models)
      .filter(
        ([, ModelClass]) =>
          ModelClass.search?.filters && Object.keys(ModelClass.search.filters).length > 0
      )
      .map(([name]) => name)
  }
}
