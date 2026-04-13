import { BasePrompt } from 'mcp-kit/prompts'
import { PromptContentGenerator } from 'mcp-kit/prompts'
import { derivePromptSchema } from 'mcp-kit/prompts'
import { Book } from '../models/book.js'

export class BookPrompt extends BasePrompt {
  static strategy = 'hybrid'

  static fieldGroups = {
    identity: {
      fields: ['title', 'author'],
      context: 'Book Identity',
      required: true,
      description: 'Core information that identifies the book'
    },
    status: {
      fields: ['status', 'rating', 'notes'],
      context: 'Reading Status',
      required: false,
      description: 'Your reading progress and impressions'
    }
  }

  static sections = {
    identity: {
      title: 'Book Identity',
      description: 'Core book information',
      required: true,
      groups: ['identity'],
      content: {
        intro: 'Every book needs a title and author.',
        notes: ['Title and author are required fields']
      }
    },
    status: {
      title: 'Reading Status',
      description: 'Track your reading progress',
      required: false,
      groups: ['status'],
      content: {
        intro: 'Optionally track your reading status and impressions.',
        notes: ['Rating must be between 1 and 5']
      }
    }
  }

  // Derive field definitions FROM model — model is the single source of truth
  static {
    const schema = derivePromptSchema(Book, { fieldGroups: this.fieldGroups })
    this.fieldGroups = schema.fieldGroups
    this.fieldDefinitions = schema.fieldDefinitions
  }

  get promptContent() {
    return PromptContentGenerator.for(BookPrompt, 'book')
      .add('# Book Creation Guide\n\nCreate a new book in your library.')
      .standard()
      .toolUsage()
      .attributeReference()
      .build()
  }
}
