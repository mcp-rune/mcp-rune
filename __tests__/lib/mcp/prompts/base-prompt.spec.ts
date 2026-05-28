/**
 * Tests for BasePrompt (lib version)
 *
 * Tests the shared infrastructure:
 * - Sections architecture (first-class citizens)
 * - Field grouping architecture
 * - Auto-generation helpers
 * - Summary generation
 * - Stateful guidance instructions
 */

import { BasePrompt } from '../../../../src/mcp/prompts/base-prompt.js'

// Mock prompt class with full sections architecture
class MockStatefulPrompt extends BasePrompt {
  static strategy = 'stateful'

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
    name_group: {
      fields: ['name', 'display_name'],
      required: true
    },
    type_group: {
      fields: ['type', 'subtype'],
      required: true
    },
    settings_group: {
      fields: ['enabled', 'priority'],
      required: false,
      conditional: { field: 'type', value: 'advanced' }
    },
    metadata_group: {
      fields: ['tags', 'notes'],
      required: false
    }
  }

  static fieldDefinitions = {
    name: {
      name: 'name',
      type: 'string',
      required: true,
      description: 'The unique name'
    },
    display_name: {
      name: 'display_name',
      type: 'string',
      required: false,
      description: 'Human-readable display name'
    },
    type: {
      name: 'type',
      type: 'enum',
      required: true,
      enumValues: ['basic', 'advanced'],
      description: 'Item type'
    },
    subtype: {
      name: 'subtype',
      type: 'string',
      required: false,
      description: 'Item subtype'
    },
    enabled: {
      name: 'enabled',
      type: 'boolean',
      required: false,
      default: true,
      description: 'Whether item is enabled'
    },
    priority: {
      name: 'priority',
      type: 'integer',
      required: false,
      default: 5,
      description: 'Priority level (1-10)'
    },
    tags: {
      name: 'tags',
      type: 'string',
      required: false,
      description: 'Comma-separated tags'
    },
    notes: {
      name: 'notes',
      type: 'text',
      required: false,
      description: 'Additional notes'
    }
  }
}

// Mock prompt class without sections (for backward compatibility)
class MockLegacyPrompt extends BasePrompt {
  static strategy = 'hybrid'

  static fieldGroups = {
    basic_info: {
      context: 'Basic Information',
      fields: ['title', 'description'],
      required: true,
      description: 'Title and description'
    },
    options: {
      context: 'Options',
      fields: ['active', 'visible'],
      required: false,
      description: 'Visibility options'
    }
  }

  static fieldDefinitions = {
    title: {
      name: 'title',
      type: 'string',
      required: true,
      description: 'The title'
    },
    description: {
      name: 'description',
      type: 'text',
      required: false,
      description: 'A description'
    },
    active: {
      name: 'active',
      type: 'boolean',
      required: false,
      default: true,
      description: 'Whether active'
    },
    visible: {
      name: 'visible',
      type: 'boolean',
      required: false,
      default: true,
      description: 'Whether visible'
    }
  }
}

// Minimal mock for testing empty configurations
class MockMinimalPrompt extends BasePrompt {
  static strategy = 'stateless'
}

describe('BasePrompt', () => {
  describe('Static Properties', () => {
    test('has default strategy of stateless', () => {
      expect(BasePrompt.strategy).toBe('stateless')
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

  describe('generateFlowDiagram', () => {
    test('generates flow diagram with required/optional indicators', () => {
      const sections = [
        { name: 'Setup', required: true, fields: 'name, type' },
        { name: 'Config', required: false, fields: 'enabled' }
      ]
      const diagram = BasePrompt.generateFlowDiagram(sections)

      expect(diagram).toContain('● required')
      expect(diagram).toContain('○ optional')
      expect(diagram).toContain('● 1. Setup - name, type')
      expect(diagram).toContain('○ 2. Config - enabled')
    })

    test('handles sections without fields', () => {
      const sections = [{ name: 'Summary', required: true }]
      const diagram = BasePrompt.generateFlowDiagram(sections)

      expect(diagram).toContain('● 1. Summary')
      expect(diagram).not.toContain(' - ')
    })
  })

  describe('generateAttributeTable', () => {
    test('generates markdown table for attributes', () => {
      const attrs = [
        { attr: 'name', type: 'string', req: true, desc: 'The name' },
        { attr: 'count', type: 'integer', req: false, desc: 'Item count' }
      ]
      const table = BasePrompt.generateAttributeTable(attrs)

      expect(table).toContain('| Attr | Type | Req | Description |')
      expect(table).toContain('| `name` | string | Yes | The name |')
      expect(table).toContain('| `count` | integer | No | Item count |')
    })
  })

  describe('generateToolExample', () => {
    test('generates tool example without parent resource', () => {
      const example = BasePrompt.generateToolExample('item', null, { name: 'test' })

      expect(example).toContain('create_model(model: "item"')
      expect(example).not.toContain('parent_path')
      expect(example).toContain('"name": "test"')
    })

    test('generates tool example with parent resource', () => {
      const example = BasePrompt.generateToolExample('item', '/parent/123', { name: 'test' })

      expect(example).toContain('parent_path: "/parent/123"')
    })
  })

  describe('generateBulkGuidance', () => {
    test('generates bulk guidance without child model', () => {
      const guidance = BasePrompt.generateBulkGuidance('item', 'parent')

      expect(guidance).toContain('## Bulk Creation')
      expect(guidance).toContain('Multiple items')
      expect(guidance).toContain('Find parent parent once')
      expect(guidance).not.toContain('Hierarchy')
    })

    test('generates bulk guidance with child model', () => {
      const guidance = BasePrompt.generateBulkGuidance('item', 'parent', 'child')

      expect(guidance).toContain('**Hierarchy:** parent → item → child')
    })
  })

  describe('generateValidationReminder', () => {
    test('generates validation reminder with sections', () => {
      const reminder = BasePrompt.generateValidationReminder('item', ['basic', 'advanced'])

      expect(reminder).toContain('validate_form(model: "item"')
      expect(reminder).toContain('Sections: basic, advanced')
    })
  })

  describe('generateOptionsTable', () => {
    test('generates options table', () => {
      const options = [
        { value: 'A', desc: 'Option A' },
        { value: 'B', desc: 'Option B' }
      ]
      const table = BasePrompt.generateOptionsTable('Type', options)

      expect(table).toContain('| Type | Description |')
      expect(table).toContain('| A | Option A |')
      expect(table).toContain('| B | Option B |')
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
      const defaults = MockMinimalPrompt.getDefaults()

      expect(defaults).toEqual({})
    })
  })

  describe('getGroupFields', () => {
    test('returns field definitions for a group', () => {
      const fields = MockStatefulPrompt.getGroupFields('name_group')

      expect(fields).toHaveLength(2)
      expect(fields[0].name).toBe('name')
      expect(fields[1].name).toBe('display_name')
    })

    test('returns empty array for unknown group', () => {
      const fields = MockStatefulPrompt.getGroupFields('unknown_group')

      expect(fields).toEqual([])
    })
  })
})

describe('Sections Architecture', () => {
  describe('getSectionFields', () => {
    test('returns all fields for a section across groups', () => {
      const fields = MockStatefulPrompt.getSectionFields('identification')

      expect(fields).toHaveLength(4)
      const fieldNames = fields.map((f) => f.name)
      expect(fieldNames).toContain('name')
      expect(fieldNames).toContain('display_name')
      expect(fieldNames).toContain('type')
      expect(fieldNames).toContain('subtype')
    })

    test('returns empty array for unknown section', () => {
      const fields = MockStatefulPrompt.getSectionFields('unknown')

      expect(fields).toEqual([])
    })
  })

  describe('getSectionFieldNames', () => {
    test('returns field names for a section', () => {
      const fieldNames = MockStatefulPrompt.getSectionFieldNames('identification')

      expect(fieldNames).toContain('name')
      expect(fieldNames).toContain('display_name')
      expect(fieldNames).toContain('type')
      expect(fieldNames).toContain('subtype')
    })

    test('returns empty array for unknown section', () => {
      const fieldNames = MockStatefulPrompt.getSectionFieldNames('unknown')

      expect(fieldNames).toEqual([])
    })
  })

  describe('getSectionForGroup', () => {
    test('returns section for a group (reverse lookup)', () => {
      const section = MockStatefulPrompt.getSectionForGroup('name_group')

      expect(section).toBeDefined()
      expect(section.name).toBe('identification')
      expect(section.title).toBe('Identification')
      expect(section.groups).toContain('name_group')
      expect(section.groups).toContain('type_group')
    })

    test('returns null for unknown group', () => {
      const section = MockStatefulPrompt.getSectionForGroup('unknown_group')

      expect(section).toBeNull()
    })
  })

  describe('getSectionNumber', () => {
    test('returns 1-based section number', () => {
      expect(MockStatefulPrompt.getSectionNumber('identification')).toBe(1)
      expect(MockStatefulPrompt.getSectionNumber('configuration')).toBe(2)
      expect(MockStatefulPrompt.getSectionNumber('additional')).toBe(3)
    })

    test('returns 0 for unknown section', () => {
      expect(MockStatefulPrompt.getSectionNumber('unknown')).toBe(0)
    })
  })

  describe('Section configuration validation', () => {
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

describe('Summary Generation', () => {
  describe('generateHumanReadableSummary', () => {
    test('uses sections for summary when available', () => {
      const summary = MockStatefulPrompt.generateHumanReadableSummary({
        name: 'test-item',
        type: 'basic'
      })

      expect(summary).toContain('**Identification:**')
      expect(summary).toContain('test-item')
      // enum values now humanize via kind-metadata describe() — was raw JSON before
      expect(summary).toContain('Basic')
    })

    test('falls back to fieldGroups when no sections', () => {
      const summary = MockLegacyPrompt.generateHumanReadableSummary({
        title: 'Test Title',
        active: true
      })

      expect(summary).toContain('**Basic Information:**')
      expect(summary).toContain('Test Title')
    })

    test('excludes empty values', () => {
      const summary = MockStatefulPrompt.generateHumanReadableSummary({
        name: 'test',
        display_name: ''
      })

      expect(summary).toContain('test')
      expect(summary).not.toContain('display_name')
    })

    test('renders enum values humanized (LLM-facing summary matches user-facing screen)', () => {
      const summary = MockStatefulPrompt.generateHumanReadableSummary({
        name: 'x',
        type: 'advanced_config'
      })
      expect(summary).toContain('Advanced Config')
    })
  })

  describe('generateTechnicalSummary', () => {
    test('generates JSON with model and attributes', () => {
      const summary = MockStatefulPrompt.generateTechnicalSummary(
        { name: 'test', type: 'basic' },
        { model: 'item' }
      )

      const parsed = JSON.parse(summary)
      expect(parsed.model).toBe('item')
      expect(parsed.attributes.name).toBe('test')
      expect(parsed.attributes.type).toBe('basic')
    })

    test('excludes null and empty values', () => {
      const summary = MockStatefulPrompt.generateTechnicalSummary({
        name: 'test',
        type: null,
        subtype: ''
      })

      const parsed = JSON.parse(summary)
      expect(parsed.attributes.name).toBe('test')
      expect(parsed.attributes.type).toBeUndefined()
      expect(parsed.attributes.subtype).toBeUndefined()
    })
  })
})

describe('Auto-Generation Helpers', () => {
  describe('generateFieldGroupsList', () => {
    test('generates list from sections when available', () => {
      const list = MockStatefulPrompt.generateFieldGroupsList()

      expect(list).toContain('1. **Identification**')
      expect(list).toContain('2. **Configuration**')
      expect(list).toContain('required')
      expect(list).toContain('optional')
    })

    test('generates list from fieldGroups when no sections', () => {
      const list = MockLegacyPrompt.generateFieldGroupsList()

      expect(list).toContain('1. **Basic Information**')
      expect(list).toContain('2. **Options**')
    })

    test('returns empty string for minimal prompt', () => {
      const list = MockMinimalPrompt.generateFieldGroupsList()

      expect(list).toBe('')
    })
  })

  describe('generateFlowDiagramFromConfig', () => {
    test('generates diagram from sections', () => {
      const diagram = MockStatefulPrompt.generateFlowDiagramFromConfig()

      expect(diagram).toContain('IDENTIFICATION')
      expect(diagram).toContain('CONFIGURATION')
      expect(diagram).toContain('SUMMARY')
      expect(diagram).toContain('● required')
      expect(diagram).toContain('○ optional')
    })

    test('includes fields in diagram', () => {
      const diagram = MockStatefulPrompt.generateFlowDiagramFromConfig()

      expect(diagram).toContain('name, display_name, type, subtype')
    })

    test('can exclude summary step', () => {
      const diagram = MockStatefulPrompt.generateFlowDiagramFromConfig({
        includeSummary: false
      })

      expect(diagram).not.toContain('SUMMARY')
    })

    test('falls back to fieldGroups when no sections', () => {
      const diagram = MockLegacyPrompt.generateFlowDiagramFromConfig()

      expect(diagram).toContain('BASIC INFORMATION')
      expect(diagram).toContain('OPTIONS')
    })
  })

  describe('getStrategyIntro', () => {
    test('returns correct intro for stateless', () => {
      expect(MockMinimalPrompt.getStrategyIntro()).toBe('Guide for creating')
    })

    test('returns correct intro for hybrid', () => {
      expect(MockLegacyPrompt.getStrategyIntro()).toBe('Interactive guide for creating')
    })

    test('returns correct intro for stateful', () => {
      expect(MockStatefulPrompt.getStrategyIntro()).toBe(
        'REQUIRED interactive guided prompt for creating'
      )
    })

    test('returns default intro for unknown strategy', () => {
      class UnknownStrategyPrompt extends BasePrompt {
        static strategy = 'unknown_strategy'
      }
      expect(UnknownStrategyPrompt.getStrategyIntro()).toBe('Guide for creating')
    })
  })

  describe('generateSectionDocumentation', () => {
    test('generates documentation for a section', () => {
      const doc = MockStatefulPrompt.generateSectionDocumentation('name_group', 1, 'item')

      expect(doc).toContain('## SECTION 1: Identification')
      expect(doc).toContain('(REQUIRED)')
      expect(doc).toContain('| name | Yes |')
      expect(doc).toContain('| display_name | No |')
      expect(doc).toContain('validate_form(model: "item"')
    })

    test('uses section title from getSectionForGroup', () => {
      const doc = MockStatefulPrompt.generateSectionDocumentation('settings_group', 2, 'item')

      expect(doc).toContain('## SECTION 2: Configuration')
      expect(doc).toContain('(Optional)')
    })

    test('uses default ask prompt', () => {
      const doc = MockStatefulPrompt.generateSectionDocumentation('name_group', 1, 'item')

      expect(doc).toContain('Please provide the Identification information')
    })

    test('returns empty string for unknown group', () => {
      const doc = MockStatefulPrompt.generateSectionDocumentation('unknown', 1, 'item')

      expect(doc).toBe('')
    })

    test('includes additional content when provided', () => {
      const doc = MockStatefulPrompt.generateSectionDocumentation('name_group', 1, 'item', {
        additionalContent: '**Note:** Extra information here'
      })

      expect(doc).toContain('**Note:** Extra information here')
    })
  })
})

describe('Stateful Guidance Instructions', () => {
  describe('generateStatefulGuidanceInstructions', () => {
    test('generates guidance for stateful prompts', () => {
      const guidance = MockStatefulPrompt.generateStatefulGuidanceInstructions('item')

      expect(guidance).toContain('## FIRST: Mode Selection')
      expect(guidance).toContain('Guided')
      expect(guidance).toContain('Quick')
      expect(guidance).toContain('STOP and WAIT')
    })

    test('instructs LLM to present section roadmap instead of embedding workflow summary', () => {
      const guidance = MockStatefulPrompt.generateStatefulGuidanceInstructions('item')

      expect(guidance).toContain('section roadmap from the **Flow** diagram')
      expect(guidance).not.toContain('Workflow Sections')
    })

    test('does not contain Section Reference block', () => {
      const guidance = MockStatefulPrompt.generateStatefulGuidanceInstructions('item')

      expect(guidance).not.toContain('Section Reference:')
    })

    test('includes field group names for validation', () => {
      const guidance = MockStatefulPrompt.generateStatefulGuidanceInstructions('item')

      expect(guidance).toContain('`name_group`')
      expect(guidance).toContain('`type_group`')
      expect(guidance).toContain('`settings_group`')
    })

    test('includes turn-taking enforcement', () => {
      const guidance = MockStatefulPrompt.generateStatefulGuidanceInstructions('item')

      expect(guidance).toContain('ONE MESSAGE AT A TIME')
      expect(guidance).toContain('FORBIDDEN BEHAVIOR')
      expect(guidance).toContain('CORRECT BEHAVIOR')
    })

    test('includes per-section validation requirements', () => {
      const guidance = MockStatefulPrompt.generateStatefulGuidanceInstructions('item')

      expect(guidance).toContain('MANDATORY VALIDATION REQUIREMENT')
      expect(guidance).toContain('validate_form')
      // Full-form validation (ready_to_submit) lives in .summary(), not .guidance()
      expect(guidance).not.toContain('ready_to_submit')
    })

    test('returns empty string for non-stateful prompts', () => {
      const guidance = MockLegacyPrompt.generateStatefulGuidanceInstructions('item')

      expect(guidance).toBe('')
    })
  })

  describe('Backward compatibility with fieldGroups', () => {
    test('guidance includes fieldGroup names for validation', () => {
      // Create a stateful prompt without sections
      class StatefulWithoutSections extends BasePrompt {
        static strategy = 'stateful'
        static fieldGroups = {
          info: {
            context: 'Information',
            fields: ['name'],
            required: true
          }
        }
        static fieldDefinitions = {
          name: { name: 'name', type: 'string', required: true, description: 'Name' }
        }
      }

      const guidance = StatefulWithoutSections.generateStatefulGuidanceInstructions('test')

      expect(guidance).toContain('`info`')
      expect(guidance).toContain('Mode Selection')
    })
  })
})

describe('Edge Cases', () => {
  test('handles empty form state in summaries', () => {
    const humanSummary = MockStatefulPrompt.generateHumanReadableSummary({})
    const techSummary = MockStatefulPrompt.generateTechnicalSummary({})

    expect(humanSummary).toBe('')
    expect(JSON.parse(techSummary).attributes).toEqual({})
  })

  test('handles missing fieldDefinitions gracefully', () => {
    class PromptWithMissingDefs extends BasePrompt {
      static sections = {
        test: {
          title: 'Test',
          description: 'Test section',
          required: true,
          groups: ['test_group']
        }
      }
      static fieldGroups = {
        test_group: {
          fields: ['missing_field'],
          required: true
        }
      }
      // No fieldDefinitions defined
    }

    const fields = PromptWithMissingDefs.getSectionFields('test')
    expect(fields).toHaveLength(1)
    expect(fields[0].name).toBe('missing_field')
  })

  test('handles section with empty groups array', () => {
    class PromptWithEmptyGroups extends BasePrompt {
      static sections = {
        empty: {
          title: 'Empty Section',
          description: 'No groups',
          required: false,
          groups: []
        }
      }
    }

    const fields = PromptWithEmptyGroups.getSectionFields('empty')
    expect(fields).toEqual([])
  })

  test('generateSectionDocumentation falls back to group.context when no section', () => {
    class PromptWithContextOnly extends BasePrompt {
      static strategy = 'stateful'
      // No sections defined
      static fieldGroups = {
        my_group: {
          context: 'My Context Title',
          fields: ['field1'],
          required: true
        }
      }
      static fieldDefinitions = {
        field1: { name: 'field1', type: 'string', required: true, description: 'Field 1' }
      }
    }

    const doc = PromptWithContextOnly.generateSectionDocumentation('my_group', 1, 'test')
    expect(doc).toContain('## SECTION 1: My Context Title')
  })

  test('generateSectionDocumentation falls back to groupName when no section or context', () => {
    class PromptWithNoContext extends BasePrompt {
      static strategy = 'stateful'
      // No sections defined
      static fieldGroups = {
        raw_group_name: {
          // No context property
          fields: ['field1'],
          required: false
        }
      }
      static fieldDefinitions = {
        field1: { name: 'field1', type: 'string', required: false, description: 'Field 1' }
      }
    }

    const doc = PromptWithNoContext.generateSectionDocumentation('raw_group_name', 1, 'test')
    expect(doc).toContain('## SECTION 1: raw_group_name')
    expect(doc).toContain('(Optional)')
  })

  test('generateSectionDocumentation handles missing field definition', () => {
    class PromptWithMissingFieldDef extends BasePrompt {
      static strategy = 'stateful'
      static fieldGroups = {
        test_group: {
          context: 'Test',
          fields: ['undefined_field'],
          required: true
        }
      }
      // No fieldDefinitions for undefined_field
    }

    const doc = PromptWithMissingFieldDef.generateSectionDocumentation('test_group', 1, 'test')
    expect(doc).toContain('| undefined_field | No | - |')
  })

  test('generateSectionDocumentation handles field without description', () => {
    class PromptWithNoDesc extends BasePrompt {
      static strategy = 'stateful'
      static fieldGroups = {
        test_group: {
          context: 'Test',
          fields: ['field1'],
          required: true
        }
      }
      static fieldDefinitions = {
        field1: { name: 'field1', type: 'string', required: true }
        // No description
      }
    }

    const doc = PromptWithNoDesc.generateSectionDocumentation('test_group', 1, 'test')
    expect(doc).toContain('| field1 | Yes | - |')
  })

  test('generateSectionDocumentation uses default ask prompt', () => {
    class PromptWithDefaults extends BasePrompt {
      static strategy = 'stateful'
      static fieldGroups = {
        test_group: {
          context: 'Test Context',
          fields: ['field1'],
          required: true
        }
      }
      static fieldDefinitions = {
        field1: { name: 'field1', type: 'string', required: true, description: 'Field 1' }
      }
    }

    const doc = PromptWithDefaults.generateSectionDocumentation('test_group', 1, 'test')
    expect(doc).toContain('Please provide the Test Context information')
  })

  test('generateSectionDocumentation uses section.askPrompt when defined', () => {
    class PromptWithSectionAskPrompt extends BasePrompt {
      static strategy = 'stateful'
      static sections = {
        my_section: {
          title: 'My Section',
          description: 'A section with custom ask prompt',
          required: true,
          groups: ['my_group'],
          askPrompt: 'What content do you want to schedule?'
        }
      }
      static fieldGroups = {
        my_group: {
          fields: ['field1'],
          required: true
        }
      }
      static fieldDefinitions = {
        field1: { name: 'field1', type: 'string', required: true, description: 'Field 1' }
      }
    }

    const doc = PromptWithSectionAskPrompt.generateSectionDocumentation('my_group', 1, 'test')
    expect(doc).toContain('What content do you want to schedule?')
    expect(doc).not.toContain('Please provide the My Section information')
  })

  test('generateSectionDocumentation uses group.askPrompt when no section askPrompt', () => {
    class PromptWithGroupAskPrompt extends BasePrompt {
      static strategy = 'stateful'
      static sections = {
        my_section: {
          title: 'My Section',
          description: 'A section without askPrompt',
          required: true,
          groups: ['my_group']
          // No askPrompt here
        }
      }
      static fieldGroups = {
        my_group: {
          fields: ['field1'],
          required: true,
          askPrompt: 'Custom group-level question?'
        }
      }
      static fieldDefinitions = {
        field1: { name: 'field1', type: 'string', required: true, description: 'Field 1' }
      }
    }

    const doc = PromptWithGroupAskPrompt.generateSectionDocumentation('my_group', 1, 'test')
    expect(doc).toContain('Custom group-level question?')
    expect(doc).not.toContain('Please provide the My Section information')
  })

  test('generateSectionDocumentation options.askPrompt takes highest priority', () => {
    class PromptWithAllAskPrompts extends BasePrompt {
      static strategy = 'stateful'
      static sections = {
        my_section: {
          title: 'My Section',
          description: 'A section',
          required: true,
          groups: ['my_group'],
          askPrompt: 'Section-level question?'
        }
      }
      static fieldGroups = {
        my_group: {
          fields: ['field1'],
          required: true,
          askPrompt: 'Group-level question?'
        }
      }
      static fieldDefinitions = {
        field1: { name: 'field1', type: 'string', required: true, description: 'Field 1' }
      }
    }

    const doc = PromptWithAllAskPrompts.generateSectionDocumentation('my_group', 1, 'test', {
      askPrompt: 'Override question from options?'
    })
    expect(doc).toContain('Override question from options?')
    expect(doc).not.toContain('Section-level question?')
    expect(doc).not.toContain('Group-level question?')
  })

  test('generateStatefulGuidanceInstructions includes fieldGroup key in validation reference', () => {
    class StatefulNoContext extends BasePrompt {
      static strategy = 'stateful'
      static fieldGroups = {
        raw_group: {
          // No context property
          fields: ['name'],
          required: true
        }
      }
      static fieldDefinitions = {
        name: { name: 'name', type: 'string', required: true, description: 'Name' }
      }
    }

    const guidance = StatefulNoContext.generateStatefulGuidanceInstructions('test')
    expect(guidance).toContain('`raw_group`')
  })
})

describe('generateEnumTable', () => {
  test('generates enum table with descriptions and default', () => {
    class EnumPrompt extends BasePrompt {
      static fieldDefinitions = {
        status: {
          type: 'enum',
          enumValues: ['active', 'inactive', 'archived'],
          enumDescriptions: {
            active: 'Currently active',
            inactive: 'Not in use',
            archived: 'Stored for reference'
          },
          default: 'active'
        }
      }
    }
    const table = EnumPrompt.generateEnumTable('status')
    expect(table).toContain('| Value | Description |')
    expect(table).toContain('`"active"`')
    expect(table).toContain('Currently active')
    expect(table).toContain('**(default)**')
    expect(table).toContain('`"inactive"`')
  })

  test('returns empty string for non-enum field', () => {
    class NonEnumPrompt extends BasePrompt {
      static fieldDefinitions = {
        name: { type: 'string' }
      }
    }
    expect(NonEnumPrompt.generateEnumTable('name')).toBe('')
  })

  test('returns empty string for unknown field', () => {
    class EmptyPrompt extends BasePrompt {
      static fieldDefinitions = {}
    }
    expect(EmptyPrompt.generateEnumTable('unknown')).toBe('')
  })
})

describe('generateAttributeReferenceFromConfig', () => {
  test('generates attribute reference table', () => {
    class RefPrompt extends BasePrompt {
      static fieldDefinitions = {
        name: { type: 'string', required: true },
        status: {
          type: 'enum',
          required: false,
          enumValues: ['active', 'inactive'],
          default: 'active'
        },
        date: { type: 'date', required: false, format: 'YYYY-MM-DD' },
        code: { type: 'string', required: false, examples: ['ABC', 'DEF', 'GHI'] },
        hidden: { type: 'string', prompt_visible: false },
        maybe: { type: 'string', required: false, conditional: true }
      }
    }
    const table = RefPrompt.generateAttributeReferenceFromConfig()
    expect(table).toContain('## ATTRIBUTE REFERENCE')
    expect(table).toContain('| `name` | string | Yes |')
    expect(table).toContain('**"active"**')
    expect(table).toContain('YYYY-MM-DD')
    expect(table).toContain('ABC, DEF')
    expect(table).not.toContain('GHI') // examples limited to 2
    expect(table).not.toContain('hidden')
    expect(table).toContain('Conditional')
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
            customFn: () => true // should be stripped
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
      static sections = { basic: { title: 'Basic', groups: ['basic'] } }
    }

    const schema = FormPrompt.toFormSchema()
    expect(schema.name).toBe('FormPrompt')
    expect(schema.strategy).toBe('stateless')
    expect(schema.fieldDefinitions.name.label).toBe('Full Name')
    expect(schema.fieldDefinitions.name.examples).toEqual(['Alice'])
    expect(schema.fieldDefinitions.name.format).toBe('text')
    expect(schema.fieldDefinitions.name.default).toBe('untitled')
    expect(schema.fieldDefinitions.name.completion.endpoint).toBe('/names')
    expect(schema.fieldDefinitions.name.validation.minLength).toBe(1)
    expect(schema.fieldDefinitions.name.validation.pattern).toBe('^[A-Z]')
    expect(schema.fieldDefinitions.name.validation.customFn).toBeUndefined()
    expect(schema.fieldDefinitions.status.enumValues).toEqual(['active', 'inactive'])
    expect(schema.fieldGroups).toBeDefined()
    expect(schema.sections).toBeDefined()
    expect(schema.defaults).toBeDefined()
  })

  test('handles empty fieldDefinitions', () => {
    const schema = BasePrompt.toFormSchema()
    expect(schema.fieldDefinitions).toEqual({})
  })

  test('handles validation with only functions (strips entirely)', () => {
    class FnOnlyPrompt extends BasePrompt {
      static fieldDefinitions = {
        x: { type: 'string', required: false, description: 'X', validation: { check: () => true } }
      }
    }
    const schema = FnOnlyPrompt.toFormSchema()
    expect(schema.fieldDefinitions.x.validation).toBeUndefined()
  })
})

describe('generateSummaryTemplate', () => {
  test('generates summary template with model name', () => {
    const template = BasePrompt.generateSummaryTemplate('rule')
    expect(template).toContain('## SUMMARY AND CONFIRMATION')
    expect(template).toContain('Human-Readable Summary')
    expect(template).toContain('Technical Summary')
    expect(template).toContain('validate_form')
    expect(template).toContain('ready_to_submit: true')
    expect(template).toContain('**Create**')
    expect(template).toContain('**Modify**')
    expect(template).toContain('**Start over**')
  })
})

describe('_renderExtractionExamples', () => {
  test('renders extraction examples as markdown table', () => {
    const examples = [
      {
        input: 'Play run, all transmissions',
        output: { transmission_type: 'play_run', reference_tx_nth: 'all' }
      },
      { input: 'First 3 airings', output: { reference_tx_nth: '3' } }
    ]
    const table = BasePrompt._renderExtractionExamples(examples)
    expect(table).toContain('**Common Patterns:**')
    expect(table).toContain('| Input | Extracted |')
    expect(table).toContain('"Play run, all transmissions"')
    expect(table).toContain('transmission_type: "play_run"')
    expect(table).toContain('"First 3 airings"')
  })
})

describe('generateSectionDocumentation with extractionExamples', () => {
  test('includes extraction examples in section doc', () => {
    class ExtractionPrompt extends BasePrompt {
      static strategy = 'stateful'
      static fieldGroups = {
        tx_config: {
          fields: ['tx_type'],
          context: 'Transmission Config',
          required: true,
          extractionExamples: [{ input: 'Play run', output: { tx_type: 'play_run' } }]
        }
      }
      static fieldDefinitions = {
        tx_type: {
          name: 'tx_type',
          type: 'string',
          required: true,
          description: 'Transmission type'
        }
      }
    }
    const doc = ExtractionPrompt.generateSectionDocumentation('tx_config', 1, 'rule')
    expect(doc).toContain('Common Patterns')
    expect(doc).toContain('"Play run"')
  })
})

describe('generateSectionDocumentation with content.intro and content.notes', () => {
  test('includes section content intro and notes', () => {
    class ContentPrompt extends BasePrompt {
      static strategy = 'stateful'
      static sections = {
        my_section: {
          title: 'My Section',
          description: 'A section',
          required: true,
          groups: ['my_group'],
          content: {
            intro: 'This section covers important stuff.',
            notes: ['Note one', 'Note two']
          }
        }
      }
      static fieldGroups = {
        my_group: {
          fields: ['field1'],
          required: true
        }
      }
      static fieldDefinitions = {
        field1: { name: 'field1', type: 'string', required: true, description: 'Field 1' }
      }
    }
    const doc = ContentPrompt.generateSectionDocumentation('my_group', 1, 'test')
    expect(doc).toContain('This section covers important stuff.')
    expect(doc).toContain('Note one')
    expect(doc).toContain('Note two')
  })
})

describe('generateSectionDocumentation with enumDescriptions', () => {
  test('includes enum table in section doc', () => {
    class EnumSectionPrompt extends BasePrompt {
      static strategy = 'stateful'
      static fieldGroups = {
        status_group: {
          fields: ['status'],
          context: 'Status',
          required: true,
          enumDescriptions: {
            status: true
          }
        }
      }
      static fieldDefinitions = {
        status: {
          name: 'status',
          type: 'enum',
          required: true,
          description: 'Current status',
          enumValues: ['active', 'inactive'],
          enumDescriptions: { active: 'In use', inactive: 'Not in use' },
          default: 'active'
        }
      }
    }
    const doc = EnumSectionPrompt.generateSectionDocumentation('status_group', 1, 'test')
    expect(doc).toContain('`"active"`')
    expect(doc).toContain('In use')
    expect(doc).toContain('**(default)**')
  })
})
