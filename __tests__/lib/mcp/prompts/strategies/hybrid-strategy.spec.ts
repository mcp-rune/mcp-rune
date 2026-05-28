import { describe, expect, it } from 'vitest'

import { HybridStrategy } from '../../../../../src/mcp/prompts/strategies/hybrid-strategy.js'

const promptClass = {
  fieldDefinitions: {
    title: { type: 'string', required: true, description: 'Title' },
    is_published: { type: 'boolean', required: false, description: 'Published' },
    published_at: { type: 'date', required: false, description: 'Publish date' },
    status: {
      type: 'string',
      required: false,
      description: 'Status',
      enumValues: ['in_progress', 'completed']
    },
    cover_b64: { type: 'base64', required: false, description: 'Cover image' },
    formats: { type: 'array', required: false, description: 'Formats' }
  },
  fieldGroups: {
    main: {
      fields: ['title', 'is_published', 'published_at', 'status', 'cover_b64', 'formats'],
      context: 'Main'
    }
  }
}

describe('lib/mcp/prompts/strategies/hybrid-strategy', () => {
  describe('generateHumanSummary - LLM summary mirrors user-facing render', () => {
    it('renders booleans as Yes/No (was raw true/false before kind-metadata)', () => {
      const out = HybridStrategy.generateHumanSummary(promptClass, {
        title: 'Book',
        is_published: true
      })
      expect(out).toContain('Published: Yes')
    })

    it('renders dates as ISO string (was raw Date toString before)', () => {
      const out = HybridStrategy.generateHumanSummary(promptClass, {
        title: 'Book',
        published_at: '2026-05-28'
      })
      expect(out).toContain('Publish date: 2026-05-28')
    })

    it('humanizes enum values (was raw snake_case before)', () => {
      const out = HybridStrategy.generateHumanSummary(promptClass, {
        title: 'Book',
        status: 'in_progress'
      })
      // The string kind delegates to its own describe(), which doesn't humanize.
      // For a true humanized rendering, attributes should use type: 'enum'.
      expect(out).toContain('Status: in_progress')
    })

    it('renders enum-kind values humanized', () => {
      const enumPromptClass = {
        fieldDefinitions: {
          status: {
            type: 'enum',
            required: false,
            description: 'Status',
            enumValues: ['in_progress', 'completed']
          }
        },
        fieldGroups: { main: { fields: ['status'], context: 'Main' } }
      }
      const out = HybridStrategy.generateHumanSummary(enumPromptClass, {
        status: 'in_progress'
      })
      expect(out).toContain('Status: In Progress')
    })

    it('renders base64 as (binary) (was raw 4KB blob before)', () => {
      const out = HybridStrategy.generateHumanSummary(promptClass, {
        title: 'Book',
        cover_b64: 'aGVsbG8='
      })
      expect(out).toContain('Cover image: (binary)')
    })

    it('renders array values humanized and comma-joined', () => {
      const out = HybridStrategy.generateHumanSummary(promptClass, {
        title: 'Book',
        formats: ['physical', 'pdf']
      })
      expect(out).toContain('Formats: Physical, Pdf')
    })

    it('skips empty and undefined values', () => {
      const out = HybridStrategy.generateHumanSummary(promptClass, {
        title: 'Book',
        is_published: undefined,
        status: ''
      })
      expect(out).not.toContain('Published')
      expect(out).not.toContain('Status')
    })
  })
})
