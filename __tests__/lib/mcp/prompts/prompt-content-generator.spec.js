/**
 * Tests for PromptContentGenerator pipeline methods.
 *
 * Focuses on the standard() method which encapsulates the canonical
 * middle of the pipeline: flowDiagram → guidance → beforeSections → allSections → summary
 */

import { describe, it, expect } from 'vitest'
import { PromptContentGenerator } from '../../../../lib/mcp/prompts/prompt-content-generator.js'

// Minimal mock prompt class with required static methods
class MockPrompt {
  static strategy = 'stateful'

  static sections = {
    identity: {
      title: 'Identity',
      description: 'Basic info',
      required: true,
      groups: ['identity']
    },
    details: {
      title: 'Details',
      description: 'Extra details',
      required: false,
      groups: ['details']
    }
  }

  static fieldGroups = {
    identity: {
      fields: ['name'],
      required: true
    },
    details: {
      fields: ['description'],
      required: false
    }
  }

  static fieldDefinitions = {
    name: { type: 'string', required: true, description: 'Name' },
    description: { type: 'string', required: false, description: 'Description' }
  }

  static getFlowDiagram() {
    return '**Flow:** ● 1. IDENTITY → ● 2. DETAILS → ● SUMMARY'
  }

  static generateStatefulGuidanceInstructions(modelName) {
    return `## Guidance for ${modelName}`
  }

  static generateSectionDocumentation(groupName, sectionNum) {
    return `## SECTION ${sectionNum}: ${groupName}`
  }

  static generateSummaryTemplate(modelName) {
    return `## SUMMARY AND CONFIRMATION for ${modelName}`
  }

  static generateAttributeReferenceFromConfig() {
    return '## ATTRIBUTE REFERENCE'
  }

  static generateEnumTable() {
    return ''
  }
}

describe('PromptContentGenerator', () => {
  describe('standard()', () => {
    it('calls flowDiagram, guidance, allSections, summary in order', () => {
      const result = PromptContentGenerator.for(MockPrompt, 'test')
        .add('# Intro')
        .standard()
        .attributeReference()
        .build()

      // Verify all content types are present in order
      expect(result).toContain('# Intro')
      expect(result).toContain('**Flow:**')
      expect(result).toContain('Mode Selection')
      expect(result).toContain('SECTION')
      expect(result).toContain('SUMMARY AND CONFIRMATION')
      expect(result).toContain('ATTRIBUTE REFERENCE')

      // Verify ordering
      const flowIdx = result.indexOf('**Flow:**')
      const guidanceIdx = result.indexOf('Mode Selection')
      const sectionIdx = result.indexOf('SECTION 1:')
      const summaryIdx = result.indexOf('SUMMARY AND CONFIRMATION')
      const attrRefIdx = result.indexOf('ATTRIBUTE REFERENCE')
      expect(flowIdx).toBeGreaterThan(0)
      expect(guidanceIdx).toBeGreaterThan(flowIdx)
      expect(sectionIdx).toBeGreaterThan(guidanceIdx)
      expect(summaryIdx).toBeGreaterThan(sectionIdx)
      expect(attrRefIdx).toBeGreaterThan(summaryIdx)
    })

    it('inserts beforeSections before allSections', () => {
      const result = PromptContentGenerator.for(MockPrompt, 'test')
        .add('# Intro')
        .standard({
          beforeSections: ['## Custom Section\n\nCustom content']
        })
        .build()

      // Custom section should appear after guidance but before auto-generated sections
      const guidanceIdx = result.indexOf('Mode Selection')
      const customIdx = result.indexOf('Custom Section')
      const sectionIdx = result.indexOf('SECTION 1:')

      expect(customIdx).toBeGreaterThan(guidanceIdx)
      expect(sectionIdx).toBeGreaterThan(customIdx)
    })

    it('passes skip to allSections', () => {
      const result = PromptContentGenerator.for(MockPrompt, 'test')
        .standard({ skip: ['details'] })
        .build()

      // Identity section should be present
      expect(result).toContain('SECTION 1: Identity')
      // Details section should be skipped
      expect(result).not.toContain('SECTION 2: Details')
    })

    it('returns this for chaining', () => {
      const generator = PromptContentGenerator.for(MockPrompt, 'test')
      const result = generator.standard()
      expect(result).toBe(generator)
    })

    it('works with empty options', () => {
      const result = PromptContentGenerator.for(MockPrompt, 'test').standard({}).build()

      expect(result).toContain('**Flow:**')
      expect(result).toContain('SUMMARY AND CONFIRMATION')
    })

    it('handles multiple beforeSections', () => {
      const result = PromptContentGenerator.for(MockPrompt, 'test')
        .standard({
          beforeSections: ['## First Custom', '## Second Custom']
        })
        .build()

      expect(result).toContain('First Custom')
      expect(result).toContain('Second Custom')

      const firstIdx = result.indexOf('First Custom')
      const secondIdx = result.indexOf('Second Custom')
      expect(secondIdx).toBeGreaterThan(firstIdx)
    })

    it('skips null/empty beforeSections gracefully', () => {
      const result = PromptContentGenerator.for(MockPrompt, 'test')
        .standard({
          beforeSections: [null, '', 'Valid Section']
        })
        .build()

      expect(result).toContain('Valid Section')
      expect(result).toContain('**Flow:**')
    })
  })

  describe('multi-group sections (per-group sub-sections)', () => {
    // Mock prompt with a multi-group section where groups have context + content
    class MockMultiGroupPrompt {
      static strategy = 'stateful'

      static sections = {
        identity: {
          title: 'Identity',
          description: 'Basic info',
          required: true,
          groups: ['identity']
        },
        combined: {
          title: 'Combined Section',
          description: 'Section with multiple groups',
          required: true,
          groups: ['group_a', 'group_b'],
          askPrompt: 'Please provide combined info.',
          content: {
            intro: 'This section has two groups.',
            notes: ['Section-level note one', 'Section-level note two']
          }
        }
      }

      static fieldGroups = {
        identity: {
          fields: ['name'],
          required: true
        },
        group_a: {
          fields: ['field_a1', 'field_a2'],
          context: 'Group Alpha',
          content: {
            intro: 'Alpha group intro text.',
            notes: ['Alpha note one']
          },
          required: true
        },
        group_b: {
          fields: ['field_b1'],
          context: 'Group Beta',
          content: {
            intro: 'Beta group intro text.',
            notes: ['Beta note one', 'Beta note two']
          },
          required: false
        }
      }

      static fieldDefinitions = {
        name: { type: 'string', required: true, description: 'Name' },
        field_a1: { type: 'string', required: true, description: 'Alpha field 1' },
        field_a2: { type: 'integer', required: false, description: 'Alpha field 2' },
        field_b1: { type: 'string', required: false, description: 'Beta field 1' }
      }

      static getFlowDiagram() {
        return '**Flow:** ● 1. IDENTITY → ● 2. COMBINED → ● SUMMARY'
      }
      static generateStatefulGuidanceInstructions(_m) {
        return `## Guidance for ${_m}`
      }
      static generateSectionDocumentation(g, n) {
        return `## SECTION ${n}: ${g}`
      }
      static generateSummaryTemplate(_m) {
        return `## SUMMARY AND CONFIRMATION for ${_m}`
      }
      static generateAttributeReferenceFromConfig() {
        return '## ATTRIBUTE REFERENCE'
      }
      static generateEnumTable() {
        return ''
      }
    }

    it('renders ### sub-headings for each group', () => {
      const result = PromptContentGenerator.for(MockMultiGroupPrompt, 'test').standard().build()

      expect(result).toContain('### Group Alpha')
      expect(result).toContain('### Group Beta')
    })

    it('renders section-level intro before group sub-sections', () => {
      const result = PromptContentGenerator.for(MockMultiGroupPrompt, 'test').standard().build()

      const sectionIntroIdx = result.indexOf('This section has two groups.')
      const groupAlphaIdx = result.indexOf('### Group Alpha')
      expect(sectionIntroIdx).toBeLessThan(groupAlphaIdx)
    })

    it('renders section-level notes after all groups', () => {
      const result = PromptContentGenerator.for(MockMultiGroupPrompt, 'test').standard().build()

      const groupBetaIdx = result.indexOf('### Group Beta')
      const sectionNotesIdx = result.indexOf('Section-level note one')
      expect(sectionNotesIdx).toBeGreaterThan(groupBetaIdx)
    })

    it('renders per-group intro within each sub-section', () => {
      const result = PromptContentGenerator.for(MockMultiGroupPrompt, 'test').standard().build()

      // Alpha intro should be between ### Group Alpha and ### Group Beta
      const alphaHeadingIdx = result.indexOf('### Group Alpha')
      const alphaIntroIdx = result.indexOf('Alpha group intro text.')
      const betaHeadingIdx = result.indexOf('### Group Beta')
      expect(alphaIntroIdx).toBeGreaterThan(alphaHeadingIdx)
      expect(alphaIntroIdx).toBeLessThan(betaHeadingIdx)

      // Beta intro should be after ### Group Beta
      const betaIntroIdx = result.indexOf('Beta group intro text.')
      expect(betaIntroIdx).toBeGreaterThan(betaHeadingIdx)
    })

    it('renders per-group notes within each sub-section', () => {
      const result = PromptContentGenerator.for(MockMultiGroupPrompt, 'test').standard().build()

      expect(result).toContain('Alpha note one')
      expect(result).toContain('Beta note one')
      expect(result).toContain('Beta note two')
    })

    it('renders separate field tables per group', () => {
      const result = PromptContentGenerator.for(MockMultiGroupPrompt, 'test').standard().build()

      // Group Alpha table should contain field_a1, field_a2 but not field_b1
      const alphaIdx = result.indexOf('### Group Alpha')
      const betaIdx = result.indexOf('### Group Beta')
      const alphaPart = result.substring(alphaIdx, betaIdx)
      expect(alphaPart).toContain('field_a1')
      expect(alphaPart).toContain('field_a2')
      expect(alphaPart).not.toContain('field_b1')

      // Group Beta table should contain field_b1 but not field_a1
      const betaPart = result.substring(betaIdx)
      expect(betaPart).toContain('field_b1')
      expect(betaPart).not.toContain('field_a1')
    })

    it('falls back to title-cased name when context is absent', () => {
      class MockNoContextPrompt {
        static strategy = 'stateful'
        static sections = {
          multi: {
            title: 'Multi',
            description: 'Test',
            required: false,
            groups: ['snake_case_group', 'another_group']
          }
        }
        static fieldGroups = {
          snake_case_group: { fields: ['f1'], required: false },
          another_group: { fields: ['f2'], required: false }
        }
        static fieldDefinitions = {
          f1: { type: 'string', required: false, description: 'Field 1' },
          f2: { type: 'string', required: false, description: 'Field 2' }
        }
        static getFlowDiagram() {
          return '**Flow:** ○ 1. MULTI → ● SUMMARY'
        }
        static generateStatefulGuidanceInstructions() {
          return ''
        }
        static generateSectionDocumentation() {
          return ''
        }
        static generateSummaryTemplate(m) {
          return `## SUMMARY for ${m}`
        }
        static generateAttributeReferenceFromConfig() {
          return ''
        }
        static generateEnumTable() {
          return ''
        }
      }

      const result = PromptContentGenerator.for(MockNoContextPrompt, 'test').allSections().build()

      expect(result).toContain('### Snake Case Group')
      expect(result).toContain('### Another Group')
    })

    it('renders enum tables for groups with enumDescriptions in multi-group section', () => {
      class MockEnumGroupPrompt {
        static strategy = 'stateful'
        static sections = {
          combined: {
            title: 'Combined',
            description: 'Combined section',
            required: true,
            groups: ['status_group', 'other_group']
          }
        }
        static fieldGroups = {
          status_group: {
            fields: ['status'],
            context: 'Status',
            required: true
          },
          other_group: {
            fields: ['name'],
            context: 'Other',
            required: false
          }
        }
        static fieldDefinitions = {
          status: {
            type: 'enum',
            required: true,
            description: 'Current status',
            enumValues: ['active', 'inactive'],
            enumDescriptions: { active: 'In use', inactive: 'Not in use' },
            default: 'active'
          },
          name: { type: 'string', required: false, description: 'Name' }
        }
        static getFlowDiagram() {
          return ''
        }
        static generateStatefulGuidanceInstructions() {
          return ''
        }
        static generateSectionDocumentation() {
          return ''
        }
        static generateSummaryTemplate() {
          return ''
        }
        static generateAttributeReferenceFromConfig() {
          return ''
        }
        static generateEnumTable(fieldName) {
          const field = this.fieldDefinitions[fieldName]
          if (!field?.enumValues) return ''
          const rows = field.enumValues.map((v) => {
            const desc = field.enumDescriptions?.[v] || ''
            const isDefault = field.default === v ? ' **(default)**' : ''
            return `| \`"${v}"\` | ${desc}${isDefault} |`
          })
          return `| Value | Description |\n|-------|-------------|\n${rows.join('\n')}`
        }
      }

      const result = PromptContentGenerator.for(MockEnumGroupPrompt, 'test').allSections().build()

      expect(result).toContain('`status` values:')
      expect(result).toContain('`"active"`')
      expect(result).toContain('In use')
    })

    it('renders extraction examples in multi-group section', () => {
      class MockExtractionPrompt {
        static strategy = 'stateful'
        static sections = {
          tx: {
            title: 'Transmission',
            description: 'TX',
            required: true,
            groups: ['tx_config', 'tx_filters']
          }
        }
        static fieldGroups = {
          tx_config: {
            fields: ['tx_type'],
            context: 'Transmission Config',
            required: true,
            extractionExamples: [{ input: 'Play run', output: { tx_type: 'play_run' } }]
          },
          tx_filters: {
            fields: ['tx_from'],
            context: 'Transmission Filters',
            required: false
          }
        }
        static fieldDefinitions = {
          tx_type: { type: 'string', required: true, description: 'Transmission type' },
          tx_from: { type: 'string', required: false, description: 'From' }
        }
        static getFlowDiagram() {
          return ''
        }
        static generateStatefulGuidanceInstructions() {
          return ''
        }
        static generateSectionDocumentation() {
          return ''
        }
        static generateSummaryTemplate() {
          return ''
        }
        static generateAttributeReferenceFromConfig() {
          return ''
        }
        static generateEnumTable() {
          return ''
        }
        static _renderExtractionExamples(examples) {
          const rows = examples.map(({ input, output }) => {
            const extracted = Object.entries(output)
              .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
              .join(', ')
            return `| "${input}" | ${extracted} |`
          })
          return (
            `**Common Patterns:**\n\n| Input | Extracted |\n|-------|-----------|` +
            `\n${rows.join('\n')}`
          )
        }
      }

      const result = PromptContentGenerator.for(MockExtractionPrompt, 'test').allSections().build()

      expect(result).toContain('Common Patterns')
      expect(result).toContain('"Play run"')
    })

    it('section() method adds single section documentation', () => {
      const result = PromptContentGenerator.for(MockMultiGroupPrompt, 'test')
        .section('identity', 1)
        .build()

      expect(result).toContain('SECTION 1: Identity')
    })

    it('section() method skips when generateSectionDocumentation returns empty', () => {
      class MockEmptySectionPrompt {
        static strategy = 'stateful'
        static sections = {}
        static fieldGroups = {}
        static fieldDefinitions = {}
        static generateSectionDocumentation() {
          return ''
        }
      }

      const result = PromptContentGenerator.for(MockEmptySectionPrompt, 'test')
        .section('nonexistent', 1)
        .build()

      expect(result).toBe('')
    })

    it('allSections supports customSections generator', () => {
      class MockCustomSectionsPrompt {
        static strategy = 'stateful'
        static sections = {
          identity: {
            title: 'Identity',
            description: 'Basic info',
            required: true,
            groups: ['identity']
          },
          custom: {
            title: 'Custom',
            description: 'Custom section',
            required: false,
            groups: ['custom_group']
          }
        }
        static fieldGroups = {
          identity: { fields: ['name'], required: true },
          custom_group: { fields: ['extra'], required: false }
        }
        static fieldDefinitions = {
          name: { type: 'string', required: true, description: 'Name' },
          extra: { type: 'string', required: false, description: 'Extra' }
        }
        static getFlowDiagram() {
          return ''
        }
        static generateStatefulGuidanceInstructions() {
          return ''
        }
        static generateSectionDocumentation(g, n) {
          return `## SECTION ${n}: ${g}`
        }
        static generateSummaryTemplate() {
          return ''
        }
        static generateAttributeReferenceFromConfig() {
          return ''
        }
        static generateEnumTable() {
          return ''
        }
      }

      const result = PromptContentGenerator.for(MockCustomSectionsPrompt, 'test')
        .allSections({
          customSections: {
            custom: (sectionNum) => `## CUSTOM SECTION ${sectionNum}: overridden`
          }
        })
        .build()

      expect(result).toContain('SECTION 1: Identity')
      expect(result).toContain('CUSTOM SECTION 2: overridden')
      expect(result).not.toContain('SECTION 2: Custom')
    })

    it('renders groups without content as just a field table', () => {
      class MockBareGroupPrompt {
        static strategy = 'stateful'
        static sections = {
          multi: {
            title: 'Multi',
            description: 'Test',
            required: false,
            groups: ['bare_group', 'rich_group']
          }
        }
        static fieldGroups = {
          bare_group: { fields: ['f1'], required: false },
          rich_group: {
            fields: ['f2'],
            context: 'Rich',
            content: { intro: 'Rich intro.', notes: ['Rich note.'] },
            required: false
          }
        }
        static fieldDefinitions = {
          f1: { type: 'string', required: false, description: 'Field 1' },
          f2: { type: 'string', required: false, description: 'Field 2' }
        }
        static getFlowDiagram() {
          return ''
        }
        static generateStatefulGuidanceInstructions() {
          return ''
        }
        static generateSectionDocumentation() {
          return ''
        }
        static generateSummaryTemplate() {
          return ''
        }
        static generateAttributeReferenceFromConfig() {
          return ''
        }
        static generateEnumTable() {
          return ''
        }
      }

      const result = PromptContentGenerator.for(MockBareGroupPrompt, 'test').allSections().build()

      // Bare group gets title-cased heading and field table, no intro/notes
      expect(result).toContain('### Bare Group')
      expect(result).toContain('f1')
      // Rich group has intro and notes
      expect(result).toContain('### Rich')
      expect(result).toContain('Rich intro.')
      expect(result).toContain('Rich note.')
    })
  })

  describe('appsEnabled threading', () => {
    it('defaults appsEnabled to false', () => {
      const gen = PromptContentGenerator.for(MockPrompt, 'test')
      expect(gen.appsEnabled).toBe(false)
    })

    it('accepts appsEnabled via constructor options', () => {
      const gen = new PromptContentGenerator(MockPrompt, 'test', { appsEnabled: true })
      expect(gen.appsEnabled).toBe(true)
    })

    it('accepts appsEnabled via factory method', () => {
      const gen = PromptContentGenerator.for(MockPrompt, 'test', { appsEnabled: true })
      expect(gen.appsEnabled).toBe(true)
    })

    it('treats non-boolean appsEnabled as false', () => {
      const gen = PromptContentGenerator.for(MockPrompt, 'test', { appsEnabled: 'yes' })
      expect(gen.appsEnabled).toBe(false)
    })
  })

  describe('transformer auto-detection in pipeline', () => {
    // Mock prompt with associationTransformers and a single-group section
    class MockTransformerPrompt {
      static strategy = 'stateful'

      static associationTransformers = {
        licensor: {
          type: 'select',
          source: { model: 'licensor' },
          targetField: 'licensor_id',
          valueField: 'id',
          labelField: 'name'
        }
      }

      static sections = {
        licensor_section: {
          title: 'Licensor',
          description: 'Select a licensor',
          required: true,
          groups: ['licensor_group']
        },
        other_section: {
          title: 'Other',
          description: 'Other info',
          required: false,
          groups: ['other_group'],
          content: { intro: 'This intro stays because no transformer covers it.' }
        }
      }

      static fieldGroups = {
        licensor_group: {
          fields: ['licensor_id'],
          context: 'Licensor Selection',
          content: { intro: 'This hardcoded intro should be replaced.' },
          required: true
        },
        other_group: {
          fields: ['name'],
          content: { intro: 'This intro stays because no transformer covers it.' },
          required: false
        }
      }

      static fieldDefinitions = {
        licensor_id: { type: 'string', required: true, description: 'Licensor ID' },
        name: { type: 'string', required: false, description: 'Name' }
      }

      static getFlowDiagram() {
        return ''
      }
      static generateStatefulGuidanceInstructions() {
        return ''
      }

      // Real-ish generateSectionDocumentation that respects introOverride
      static generateSectionDocumentation(groupName, sectionNum, modelName, options = {}) {
        const group = this.fieldGroups[groupName]
        if (!group) return ''
        const intro = options.introOverride || group?.content?.intro || ''
        return `## SECTION ${sectionNum}: ${groupName}\n\n${intro}`
      }

      static generateSummaryTemplate(m) {
        return `## SUMMARY for ${m}`
      }
      static generateAttributeReferenceFromConfig() {
        return ''
      }
      static generateEnumTable() {
        return ''
      }
    }

    it('replaces content.intro with transformer instructions for covered single-group sections', () => {
      const result = PromptContentGenerator.for(MockTransformerPrompt, 'test', {
        appsEnabled: false
      })
        .allSections()
        .build()

      // Transformer-covered section should NOT have the hardcoded intro
      expect(result).not.toContain('This hardcoded intro should be replaced.')
      // Should have auto-generated find_model instructions from select transformer
      expect(result).toContain('find_model(model: "licensor"')
      expect(result).toContain('get_field_suggestions')
    })

    it('preserves content.intro for sections without transformers', () => {
      const result = PromptContentGenerator.for(MockTransformerPrompt, 'test', {
        appsEnabled: false
      })
        .allSections()
        .build()

      // Non-transformer section keeps its original intro
      expect(result).toContain('This intro stays because no transformer covers it.')
    })

    it('generates app-aware instructions when appsEnabled is true', () => {
      const result = PromptContentGenerator.for(MockTransformerPrompt, 'test', {
        appsEnabled: true
      })
        .allSections()
        .build()

      // Select transformer with appsEnabled should mention dropdown
      expect(result).toContain('dropdown')
      expect(result).toContain('find_model(model: "licensor"')
    })

    it('generates non-app instructions when appsEnabled is false', () => {
      const result = PromptContentGenerator.for(MockTransformerPrompt, 'test', {
        appsEnabled: false
      })
        .allSections()
        .build()

      expect(result).not.toContain('dropdown')
      expect(result).toContain('Finding a Licensor')
    })
  })

  describe('transformer auto-detection in multi-group sections', () => {
    class MockMultiGroupTransformerPrompt {
      static strategy = 'stateful'

      static associationTransformers = {
        content_selection: {
          type: 'autocomplete',
          source: { group: 'catalogue' },
          targetFields: ['parent_type', 'parent_id'],
          transform: {
            parent_type: { from: 'entityType' },
            parent_id: { from: 'id' }
          }
        }
      }

      static sections = {
        content: {
          title: 'Content Selection',
          description: 'Select content',
          required: true,
          groups: ['content_fields', 'config_fields'],
          content: {
            preamble: 'Domain-specific preamble text here.',
            intro: 'Old hardcoded instructions that should be replaced.',
            notes: ['A section-level note.']
          }
        }
      }

      static fieldGroups = {
        content_fields: {
          fields: ['parent_type', 'parent_id'],
          context: 'Content',
          required: true
        },
        config_fields: {
          fields: ['priority'],
          context: 'Config',
          required: false
        }
      }

      static fieldDefinitions = {
        parent_type: { type: 'string', required: true, description: 'Parent type' },
        parent_id: { type: 'string', required: true, description: 'Parent ID' },
        priority: { type: 'integer', required: false, description: 'Priority' }
      }

      static getFlowDiagram() {
        return ''
      }
      static generateStatefulGuidanceInstructions() {
        return ''
      }
      static generateSectionDocumentation() {
        return ''
      }
      static generateSummaryTemplate() {
        return ''
      }
      static generateAttributeReferenceFromConfig() {
        return ''
      }
      static generateEnumTable() {
        return ''
      }
    }

    it('replaces content.intro with transformer instructions in multi-group section', () => {
      const result = PromptContentGenerator.for(MockMultiGroupTransformerPrompt, 'test', {
        appsEnabled: false
      })
        .allSections()
        .build()

      // Old intro replaced
      expect(result).not.toContain('Old hardcoded instructions that should be replaced.')
      // Transformer instructions present
      expect(result).toContain('MUST identify the catalogue')
      expect(result).toContain('find_model')
    })

    it('renders preamble before transformer instructions', () => {
      const result = PromptContentGenerator.for(MockMultiGroupTransformerPrompt, 'test', {
        appsEnabled: false
      })
        .allSections()
        .build()

      const preambleIdx = result.indexOf('Domain-specific preamble text here.')
      const transformerIdx = result.indexOf('MUST identify the catalogue')
      expect(preambleIdx).toBeGreaterThan(-1)
      expect(transformerIdx).toBeGreaterThan(preambleIdx)
    })

    it('preserves section-level notes after all groups', () => {
      const result = PromptContentGenerator.for(MockMultiGroupTransformerPrompt, 'test', {
        appsEnabled: false
      })
        .allSections()
        .build()

      expect(result).toContain('A section-level note.')
    })

    it('generates picker instructions when appsEnabled is true', () => {
      const result = PromptContentGenerator.for(MockMultiGroupTransformerPrompt, 'test', {
        appsEnabled: true
      })
        .allSections()
        .build()

      expect(result).toContain('autocomplete_picker(group: "catalogue")')
      expect(result).toContain('Preferred Method')
      expect(result).toContain('Fallback Method')
    })

    it('skips transformer intro when no transformers exist', () => {
      class NoTransformerPrompt {
        static strategy = 'stateful'
        static sections = {
          plain: {
            title: 'Plain',
            description: 'No transformers here',
            required: false,
            groups: ['grp_a', 'grp_b'],
            content: { intro: 'Static intro preserved.' }
          }
        }
        static fieldGroups = {
          grp_a: { fields: ['x'], required: false },
          grp_b: { fields: ['y'], required: false }
        }
        static fieldDefinitions = {
          x: { type: 'string', required: false, description: 'X' },
          y: { type: 'string', required: false, description: 'Y' }
        }
        static getFlowDiagram() {
          return ''
        }
        static generateStatefulGuidanceInstructions() {
          return ''
        }
        static generateSectionDocumentation() {
          return ''
        }
        static generateSummaryTemplate() {
          return ''
        }
        static generateAttributeReferenceFromConfig() {
          return ''
        }
        static generateEnumTable() {
          return ''
        }
      }

      const result = PromptContentGenerator.for(NoTransformerPrompt, 'test').allSections().build()

      expect(result).toContain('Static intro preserved.')
    })
  })
})
