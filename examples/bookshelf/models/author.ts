import { BaseModel } from '@mcp-rune/mcp-rune/core'
import type { AttributeDefinition } from '@mcp-rune/mcp-rune/core'

export class Author extends BaseModel {
  static override description = 'An author of books'
  static override api = { endpoint: 'authors' }

  static override attributes: Record<string, AttributeDefinition> = {
    name: {
      type: 'string',
      required: true,
      description: 'Author full name',
      examples: ['Robert C. Martin', 'Martin Fowler']
    },
    nationality: {
      type: 'string',
      description: 'Country of citizenship',
      examples: ['American', 'British']
    },
    birth_year: {
      type: 'integer',
      description: 'Year of birth'
    }
  }

  static get attributesConfig(): Record<string, AttributeDefinition> {
    return this.attributes
  }

  override get displayValue(): string {
    return String(this.data.name)
  }
}
