import { describe, expect, it } from 'vitest'

import { BaseStrategy } from '../../../../../src/mcp/prompts/strategies/base-strategy.js'

describe('lib/mcp/prompts/strategies/base-strategy', () => {
  describe('validateField - kind-aware checks (via the kinds registry)', () => {
    it('integer rejects non-integers', () => {
      const errors = BaseStrategy.validateField(
        'age',
        3.14,
        { type: 'integer', required: false, description: 'Age' },
        {}
      )
      expect(errors).toEqual(['age must be an integer'])
    })

    it('boolean rejects non-booleans', () => {
      const errors = BaseStrategy.validateField(
        'active',
        'true',
        { type: 'boolean', required: false, description: 'Active' },
        {}
      )
      expect(errors).toEqual(['active must be a boolean'])
    })

    it('date rejects malformed input (new coverage)', () => {
      const errors = BaseStrategy.validateField(
        'published_at',
        'tomorrow',
        { type: 'date', required: false, description: 'Published' },
        {}
      )
      expect(errors).toEqual(['published_at must be a valid date'])
    })

    it('datetime rejects malformed input (new coverage)', () => {
      const errors = BaseStrategy.validateField(
        'created',
        'garbage',
        { type: 'datetime', required: false, description: 'Created' },
        {}
      )
      expect(errors).toEqual(['created must be a valid datetime'])
    })

    it('uuid rejects malformed input (new coverage)', () => {
      const errors = BaseStrategy.validateField(
        'id',
        'not-a-uuid',
        { type: 'uuid', required: false, description: 'ID' },
        {}
      )
      expect(errors).toEqual(['id must be a valid UUID'])
    })

    it('email rejects malformed input (new coverage)', () => {
      const errors = BaseStrategy.validateField(
        'contact',
        'not-an-email',
        { type: 'email', required: false, description: 'Contact' },
        {}
      )
      expect(errors).toEqual(['contact must be a valid email address'])
    })

    it('url rejects malformed input (new coverage)', () => {
      const errors = BaseStrategy.validateField(
        'site',
        'not a url',
        { type: 'url', required: false, description: 'Site' },
        {}
      )
      expect(errors).toEqual(['site must be a valid URL'])
    })

    it('json rejects malformed string (new coverage)', () => {
      const errors = BaseStrategy.validateField(
        'config',
        'not json',
        { type: 'json', required: false, description: 'Config' },
        {}
      )
      expect(errors).toEqual(['config must be valid JSON'])
    })

    it('string with format: url validates as URL (case-insensitive format hop)', () => {
      const errors = BaseStrategy.validateField(
        'site',
        'not a url',
        { type: 'string', format: 'URL', required: false, description: 'Site' },
        {}
      )
      expect(errors).toEqual(['site must be a valid URL'])
    })

    it('accepts valid values', () => {
      expect(
        BaseStrategy.validateField(
          'age',
          42,
          { type: 'integer', required: false, description: '' },
          {}
        )
      ).toEqual([])
      expect(
        BaseStrategy.validateField(
          'site',
          'https://example.com',
          { type: 'url', required: false, description: '' },
          {}
        )
      ).toEqual([])
    })

    it('still applies enum, range, length, pattern (orthogonal to kind)', () => {
      const errors = BaseStrategy.validateField(
        'title',
        'no',
        {
          type: 'string',
          required: false,
          description: 'Title',
          validation: { minLength: 5 }
        },
        {}
      )
      expect(errors).toEqual(['title must be at least 5 characters'])
    })

    it('enum rejects out-of-set values', () => {
      const errors = BaseStrategy.validateField(
        'status',
        'wat',
        {
          type: 'string',
          required: false,
          description: 'Status',
          enumValues: ['a', 'b']
        },
        {}
      )
      expect(errors[0]).toContain('Invalid value')
    })
  })
})
