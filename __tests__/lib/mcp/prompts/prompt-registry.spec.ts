/**
 * Tests for BasePromptRegistry — the framework-shipped concrete PromptRegistry.
 *
 * Covers:
 * - register / lookup by name
 * - register / lookup by model
 * - getDefinitions surfaces description + required
 * - getPrompt instantiates the registered class
 * - collision detection: duplicate name fails fast with both contributor keys
 * - collision detection: duplicate model fails fast with the conflicting prompt name
 */

import { describe, expect, it } from 'vitest'

import { BasePrompt } from '../../../../src/mcp/prompts/base-prompt.js'
import { BasePromptRegistry } from '../../../../src/mcp/prompts/prompt-registry.js'

class BookPrompt extends BasePrompt {
  override get promptContent(): never[] {
    return []
  }
}

class MoviePrompt extends BasePrompt {
  override get promptContent(): never[] {
    return []
  }
}

describe('BasePromptRegistry', () => {
  describe('register / lookup by name', () => {
    it('registers a prompt and looks it up', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt)

      expect(registry.getPromptClass('book')).toBe(BookPrompt)
      expect(registry.getAllPromptNames()).toEqual(['book'])
    })

    it('returns null for unknown names', () => {
      const registry = new BasePromptRegistry()
      expect(registry.getPromptClass('unknown')).toBeNull()
    })
  })

  describe('register / lookup by model', () => {
    it('binds a prompt to a model and looks it up by model', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt, { model: 'book' })

      expect(registry.getPromptNameByModel('book')).toBe('book')
      expect(registry.getPromptClassByModel('book')).toBe(BookPrompt)
    })

    it('returns null when no prompt is bound to a model', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt)
      expect(registry.getPromptNameByModel('book')).toBeNull()
      expect(registry.getPromptClassByModel('book')).toBeNull()
    })
  })

  describe('getDefinitions', () => {
    it('returns name only when description and required are omitted', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt)
      expect(registry.getDefinitions()).toEqual([{ name: 'book' }])
    })

    it('surfaces description and required when provided', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt, {
        description: 'Create a book',
        required: true
      })
      expect(registry.getDefinitions()).toEqual([
        { name: 'book', description: 'Create a book', required: true }
      ])
    })
  })

  describe('getPrompt', () => {
    it('instantiates the registered prompt class', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt, { description: 'Create a book' })

      const result = registry.getPrompt('book')
      expect(result.description).toBe('Create a book')
      expect(result.messages).toEqual([])
    })

    it('throws for unknown prompt names', () => {
      const registry = new BasePromptRegistry()
      expect(() => registry.getPrompt('missing')).toThrow(/Prompt "missing" not found/)
    })
  })

  describe('collision detection', () => {
    it('throws when the same name is registered twice with built-in owners', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt)
      expect(() => registry.register('book', MoviePrompt)).toThrow(
        /Prompt "book" attempted by "<built-in>" is already registered by "<built-in>"/
      )
    })

    it('error message includes both contributor keys', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt, { ownerKey: 'core' })
      expect(() => registry.register('book', MoviePrompt, { ownerKey: 'stripe-ext' })).toThrow(
        /Prompt "book" attempted by "stripe-ext" is already registered by "core"/
      )
    })

    it('throws when two prompts try to bind to the same model', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt, { model: 'book' })
      expect(() =>
        registry.register('book-v2', MoviePrompt, { model: 'book', ownerKey: 'ext' })
      ).toThrow(/Model "book" already has prompt "book"; cannot also bind to "book-v2"/)
    })
  })

  describe('ownerOf', () => {
    it('exposes the contributor key for diagnostic logging', () => {
      const registry = new BasePromptRegistry()
      registry.register('book', BookPrompt, { ownerKey: 'core' })
      expect(registry.ownerOf('book')).toBe('core')
      expect(registry.ownerOf('unknown')).toBeUndefined()
    })
  })
})
