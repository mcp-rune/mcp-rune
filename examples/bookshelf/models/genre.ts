import { BaseModel } from '@mcp-rune/mcp-rune/core'
import type { AttributeDefinition } from '@mcp-rune/mcp-rune/core'

export class Genre extends BaseModel {
  static override description = 'A book genre (e.g. software, architecture, testing)'
  static override api = { endpoint: 'genres' }

  static override attributes: Record<string, AttributeDefinition> = {
    name: {
      type: 'string',
      required: true,
      description: 'Genre name',
      examples: ['Software', 'Architecture', 'Testing']
    },
    slug: {
      type: 'string',
      required: true,
      description: 'URL-safe slug',
      examples: ['software', 'architecture']
    },
    description: {
      type: 'text',
      description: 'What this genre covers'
    }
  }

  static get attributesConfig(): Record<string, AttributeDefinition> {
    return this.attributes
  }

  override get displayValue(): string {
    return String(this.data.name)
  }
}
