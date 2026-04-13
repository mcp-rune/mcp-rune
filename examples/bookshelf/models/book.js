import { BaseModel } from 'mcp-kit/core'

export class Book extends BaseModel {
  static endpoint = 'books'
  static description = 'A book in the library'

  static attributes = {
    title: {
      type: 'string',
      required: true,
      description: 'Book title',
      examples: ['Clean Code', 'Design Patterns', 'The Pragmatic Programmer']
    },
    author: {
      type: 'string',
      required: true,
      description: 'Author name',
      examples: ['Robert C. Martin', 'Kent Beck']
    },
    status: {
      type: 'enum',
      enumValues: ['unread', 'reading', 'completed'],
      default: 'unread',
      description: 'Current reading status'
    },
    rating: {
      type: 'integer',
      description: 'Your rating from 1 to 5',
      validation: { min: 1, max: 5 }
    },
    notes: {
      type: 'text',
      description: 'Personal notes about the book'
    }
  }

  // Alias for prompt derivation framework
  static get attributesConfig() {
    return this.attributes
  }

  get displayValue() {
    return `${this.data.title} by ${this.data.author}`
  }
}
