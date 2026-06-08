/**
 * Tests for BasePrompt.
 *
 * Covers the production surface that survived the rendering-helper purge:
 *   - the four static config maps and their defaults
 *   - getDefaults, getSectionForGroup, toFormSchema
 *
 * Rendering (flow diagrams, guidance, sections, summary template, attribute
 * reference, etc.) is exercised through `prompt-content-builder.spec.ts`
 * and the per-generator specs under `generators/`.
 */

import { BasePrompt } from '../../../../src/mcp/prompts/base-prompt.js'

class MockStatefulPrompt extends BasePrompt {
  static formStrategy = 'stateful' as const

  static sections = {
    identification: {
      title: 'Identification',
      description: 'Basic identity information',
      required: true,
      groups: ['name_group', 'type_group']
    },
    configuration: {
      title: 'Configuration',
      description: 'Optional configuration settings',
      required: false,
      groups: ['settings_group']
    },
    additional: {
      title: 'Additional Options',
      description: 'Extra options and metadata',
      required: false,
      groups: ['metadata_group']
    }
  }

  static fieldGroups = {
    name_group: { fields: ['name', 'display_name'], required: true },
    type_group: { fields: ['type', 'subtype'], required: true },
    settings_group: {
      fields: ['enabled', 'priority'],
      required: false,
      conditional: { field: 'type', value: 'advanced' }
    },
    metadata_group: { fields: ['tags', 'notes'], required: false }
  }

  static fieldDefinitions = {
    name: { type: 'string', required: true, description: 'The unique name' },
    display_name: { type: 'string', required: false, description: 'Human-readable display name' },
    type: {
      type: 'enum',
      required: true,
      enumValues: ['basic', 'advanced'],
      description: 'Item type'
    },
    subtype: { type: 'string', required: false, description: 'Item subtype' },
    enabled: {
      type: 'boolean',
      required: false,
      default: true,
      description: 'Whether item is enabled'
    },
    priority: {
      type: 'integer',
      required: false,
      default: 5,
      description: 'Priority level (1-10)'
    },
    tags: { type: 'string', required: false, description: 'Comma-separated tags' },
    notes: { type: 'text', required: false, description: 'Additional notes' }
  }
}

class MockMinimalPrompt extends BasePrompt {
  static formStrategy = 'stateless' as const
}

class MockHybridPrompt extends BasePrompt {
  static formStrategy = 'hybrid' as const
}

describe('BasePrompt', () => {
  describe('Static Properties', () => {
    test('has default formStrategy of stateless', () => {
      expect(BasePrompt.formStrategy).toBe('stateless')
    })

    test('has empty sections by default', () => {
      expect(BasePrompt.sections).toEqual({})
    })

    test('has empty fieldGroups by default', () => {
      expect(BasePrompt.fieldGroups).toEqual({})
    })

    test('has empty fieldDefinitions by default', () => {
      expect(BasePrompt.fieldDefinitions).toEqual({})
    })
  })

  describe('getDefaults', () => {
    test('returns defaults from fieldDefinitions', () => {
      const defaults = MockStatefulPrompt.getDefaults()

      expect(defaults.enabled).toBe(true)
      expect(defaults.priority).toBe(5)
    })

    test('excludes fields without defaults', () => {
      const defaults = MockStatefulPrompt.getDefaults()

      expect(defaults.name).toBeUndefined()
      expect(defaults.type).toBeUndefined()
    })

    test('returns empty object for minimal prompt', () => {
      expect(MockMinimalPrompt.getDefaults()).toEqual({})
    })
  })

  describe('getStrategyIntro', () => {
    test('returns stateless intro', () => {
      expect(MockMinimalPrompt.getStrategyIntro()).toBe('Guide for creating')
    })

    test('returns hybrid intro', () => {
      expect(MockHybridPrompt.getStrategyIntro()).toBe('Interactive guide for creating')
    })

    test('returns stateful intro', () => {
      expect(MockStatefulPrompt.getStrategyIntro()).toBe(
        'REQUIRED interactive guided prompt for creating'
      )
    })

    test('falls back to stateless intro for unknown strategy', () => {
      class UnknownStrategyPrompt extends BasePrompt {
        static formStrategy = 'unknown_strategy' as unknown as 'stateless'
      }
      expect(UnknownStrategyPrompt.getStrategyIntro()).toBe('Guide for creating')
    })
  })

  describe('getSectionForGroup', () => {
    test('returns section for a group (reverse lookup)', () => {
      const section = MockStatefulPrompt.getSectionForGroup('name_group')

      expect(section).not.toBeNull()
      expect(section!.name).toBe('identification')
      expect(section!.title).toBe('Identification')
      expect(section!.groups).toContain('name_group')
      expect(section!.groups).toContain('type_group')
    })

    test('returns null for unknown group', () => {
      expect(MockStatefulPrompt.getSectionForGroup('unknown_group')).toBeNull()
    })
  })

  describe('toFormSchema', () => {
    test('serializes field definitions with RegExp and functions', () => {
      class FormPrompt extends BasePrompt {
        static fieldDefinitions = {
          name: {
            type: 'string',
            required: true,
            description: 'Name',
            label: 'Full Name',
            examples: ['Alice'],
            format: 'text',
            default: 'untitled',
            completion: { endpoint: '/names' },
            validation: {
              minLength: 1,
              pattern: /^[A-Z]/,
              customFn: () => true
            }
          },
          status: {
            type: 'enum',
            required: false,
            description: 'Status',
            enumValues: ['active', 'inactive']
          }
        }
        static fieldGroups = { basic: { fields: ['name'] } }
        static sections = {
          basic: { title: 'Basic', description: '', required: true, groups: ['basic'] }
        }
      }

      const schema = FormPrompt.toFormSchema()
      expect(schema.name).toBe('FormPrompt')
      expect(schema.formStrategy).toBe('stateless')
      expect(schema.fieldDefinitions.name!.label).toBe('Full Name')
      expect(schema.fieldDefinitions.name!.examples).toEqual(['Alice'])
      expect(schema.fieldDefinitions.name!.format).toBe('text')
      expect(schema.fieldDefinitions.name!.default).toBe('untitled')
      expect((schema.fieldDefinitions.name!.completion as { endpoint: string }).endpoint).toBe(
        '/names'
      )
      expect(schema.fieldDefinitions.name!.validation!.minLength).toBe(1)
      expect(schema.fieldDefinitions.name!.validation!.pattern).toBe('^[A-Z]')
      expect(schema.fieldDefinitions.name!.validation!.customFn).toBeUndefined()
      expect(schema.fieldDefinitions.status!.enumValues).toEqual(['active', 'inactive'])
      expect(schema.fieldGroups).toBeDefined()
      expect(schema.sections).toBeDefined()
      expect(schema.defaults).toBeDefined()
    })

    test('handles empty fieldDefinitions', () => {
      const schema = BasePrompt.toFormSchema()
      expect(schema.fieldDefinitions).toEqual({})
    })

    test('strips validation entirely when only function-typed entries remain', () => {
      class FnOnlyPrompt extends BasePrompt {
        static fieldDefinitions = {
          x: {
            type: 'string',
            required: false,
            description: 'X',
            validation: { check: () => true }
          }
        }
      }
      const schema = FnOnlyPrompt.toFormSchema()
      expect(schema.fieldDefinitions.x!.validation).toBeUndefined()
    })
  })

  describe('Section configuration shape', () => {
    test('each section has required properties', () => {
      for (const [, section] of Object.entries(MockStatefulPrompt.sections)) {
        expect(section.title).toBeDefined()
        expect(typeof section.title).toBe('string')
        expect(section.description).toBeDefined()
        expect(typeof section.description).toBe('string')
        expect(typeof section.required).toBe('boolean')
        expect(Array.isArray(section.groups)).toBe(true)
        expect(section.groups.length).toBeGreaterThan(0)
      }
    })

    test('all groups in sections exist in fieldGroups', () => {
      const fieldGroupNames = Object.keys(MockStatefulPrompt.fieldGroups)
      for (const [, section] of Object.entries(MockStatefulPrompt.sections)) {
        for (const groupName of section.groups) {
          expect(fieldGroupNames).toContain(groupName)
        }
      }
    })
  })
})
