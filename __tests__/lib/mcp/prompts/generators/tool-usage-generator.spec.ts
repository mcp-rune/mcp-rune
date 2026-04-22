import { generateToolUsage } from '../../../../../src/mcp/prompts/generators/tool-usage-generator.js'

// =============================================================================
// MOCK HELPERS
// =============================================================================

function makeContext(toolUsage = {}, fieldDefs = {}, modelName = 'brand') {
  return {
    modelName,
    promptClass: {
      toolUsage,
      fieldDefinitions: fieldDefs
    }
  }
}

const baseFieldDefs = {
  id: { type: 'string', prompt_visible: false, description: 'Unique identifier' },
  name: { type: 'string', required: true, description: 'The name', examples: ['Breaking Bad'] },
  external_id: {
    type: 'string',
    immutable: true,
    description: 'External system identifier',
    examples: ['BRAND-001']
  },
  tags: { type: 'string', description: 'Comma-separated tags', examples: ['Action,Drama'] }
}

// =============================================================================
// PATTERN A: Simple standalone
// =============================================================================

describe('Pattern A: Simple standalone', () => {
  it('generates basic create_model block', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    expect(result).toContain('## TOOL USAGE')
    expect(result).toContain('### Creating the Brand')
    expect(result).toContain('model: "brand"')
    expect(result).not.toContain('parent_resource')
  })

  it('auto-derives example attributes from model examples', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    // Required field with examples should be included
    expect(result).toContain('"name": "Breaking Bad"')
    // Optional field should NOT be auto-included
    expect(result).not.toContain('"tags"')
  })

  it('includes required attributes checklist', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    expect(result).toContain('### Required Attributes')
    expect(result).toContain('`name`: REQUIRED')
  })

  it('includes optional attributes list', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    expect(result).toContain('### Optional Attributes')
    expect(result).toContain('`tags`')
  })

  it('excludes prompt_visible: false fields from checklists', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    expect(result).not.toContain('`id`')
  })

  it('renders immutable field warnings', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    expect(result).toContain('`external_id` is immutable')
  })

  it('uses explicit exampleAttributes overrides', () => {
    const config = {
      exampleAttributes: {
        name: 'Custom Name',
        licensor_link: 'https://api.example.com/licensors/123'
      }
    }
    const result = generateToolUsage(makeContext(config, baseFieldDefs))

    expect(result).toContain('"name": "Custom Name"')
    expect(result).toContain('"licensor_link"')
  })
})

// =============================================================================
// PATTERN B: Nested with static parent
// =============================================================================

describe('Pattern B: Nested with static parent', () => {
  const nestedFieldDefs = {
    name: { type: 'string', required: true, description: 'Asset name', examples: ['Asset Name'] },
    external_id: { type: 'string', description: 'External ID', examples: ['ASSET-001'] }
  }

  it('includes parent_resource in create block', () => {
    const config = { parentResource: 'titles/{title_id}/assets' }
    const result = generateToolUsage(makeContext(config, nestedFieldDefs, 'asset'))

    expect(result).toContain('parent_resource: "titles/{title_id}/assets"')
  })

  it('renders alternative creation section', () => {
    const config = {
      parentResource: 'titles/{title_id}/assets',
      alternativeCreation: {
        title: 'Using title_link in attributes',
        linkAttribute: 'title_link',
        exampleAttributes: { name: 'Asset Name' }
      }
    }
    const result = generateToolUsage(makeContext(config, nestedFieldDefs, 'asset'))

    expect(result).toContain('### Using title_link in attributes')
    expect(result).toContain('"title_link"')
  })
})

// =============================================================================
// PATTERN C: Dynamic parent (instance override)
// =============================================================================

describe('Pattern C: Dynamic parent via instance overrides', () => {
  const fieldDefs = {
    put_up: {
      type: 'datetime',
      required: true,
      description: 'Start date',
      examples: ['2024-06-17T06:00:00Z']
    },
    take_down: {
      type: 'datetime',
      required: true,
      description: 'End date',
      examples: ['2024-11-01T06:00:00Z']
    }
  }

  it('uses parentResource from instance overrides', () => {
    const result = generateToolUsage(makeContext({}, fieldDefs, 'scheduling'), {
      parentResource: 'titles/123/schedule/schedulings'
    })

    expect(result).toContain('parent_resource: "titles/123/schedule/schedulings"')
  })
})

// =============================================================================
// PATTERN D: Multi-step with post-create
// =============================================================================

describe('Pattern D: Multi-step with postCreateSteps', () => {
  const dealFieldDefs = {
    right_type: {
      type: 'enum',
      required: true,
      description: 'Type of right',
      examples: ['archive']
    },
    starts: { type: 'datetime', description: 'Start date' }
  }

  const config = {
    excludeFromAttributes: ['selected_platforms'],
    postCreateSteps: [
      {
        title: 'Add Specific Platforms',
        condition: '`selected_platforms` array is NOT empty',
        skipCondition:
          '`selected_platforms` is empty, skip this step — the deal will apply to ALL platforms',
        model: 'specific_platform',
        parentTemplate: 'deals/{deal_id}/specific_platforms',
        attributes: { platform_link: '{platform_link}' },
        iterateOver: 'selected_platforms'
      }
    ],
    notes: ['The licensor URL must point to an existing licensor']
  }

  it('uses Step 1 prefix when post-create steps exist', () => {
    const result = generateToolUsage(makeContext(config, dealFieldDefs, 'deal'))

    expect(result).toContain('### Step 1: Creating the Deal')
  })

  it('renders post-create step with tool call', () => {
    const result = generateToolUsage(makeContext(config, dealFieldDefs, 'deal'))

    expect(result).toContain('### Step 2: Add Specific Platforms')
    expect(result).toContain('model: "specific_platform"')
    expect(result).toContain('parent_resource: "deals/{deal_id}/specific_platforms"')
  })

  it('renders iterate and skip instructions', () => {
    const result = generateToolUsage(makeContext(config, dealFieldDefs, 'deal'))

    expect(result).toContain('Repeat for each item in `selected_platforms`')
    expect(result).toContain('skip this step')
  })

  it('renders exclusion notes for prompt-only fields', () => {
    const result = generateToolUsage(makeContext(config, dealFieldDefs, 'deal'))

    expect(result).toContain('Do NOT include `selected_platforms`')
  })

  it('renders custom notes', () => {
    const result = generateToolUsage(makeContext(config, dealFieldDefs, 'deal'))

    expect(result).toContain('The licensor URL must point to an existing licensor')
  })
})

// =============================================================================
// PATTERN E: Multiple creation variants
// =============================================================================

describe('Pattern E: Multiple creation variants', () => {
  const seriesFieldDefs = {
    name: {
      type: 'string',
      required: true,
      description: 'Series name',
      examples: ['Series Name S1']
    },
    season_number: { type: 'integer', description: 'Season number', examples: [1] }
  }

  const config = {
    variants: [
      {
        title: 'Creating a Series (Basic - PREFERRED)',
        description: 'Use this method by default.',
        fixedAttributes: { title_group_type: 'series' }
      },
      {
        title: 'Creating Under a Brand',
        parentResource: 'brands/{brand_id}/series',
        fixedAttributes: { title_group_type: 'series' },
        description: 'WARNING: Only use if user explicitly requests.'
      }
    ]
  }

  it('renders each variant as a sub-section', () => {
    const result = generateToolUsage(makeContext(config, seriesFieldDefs, 'series'))

    expect(result).toContain('### Creating a Series (Basic - PREFERRED)')
    expect(result).toContain('### Creating Under a Brand')
  })

  it('includes variant descriptions', () => {
    const result = generateToolUsage(makeContext(config, seriesFieldDefs, 'series'))

    expect(result).toContain('Use this method by default.')
    expect(result).toContain('WARNING: Only use if user explicitly requests.')
  })

  it('includes parent_resource only for variants that have it', () => {
    const result = generateToolUsage(makeContext(config, seriesFieldDefs, 'series'))

    // First variant should NOT have parent_resource
    const firstBlock = result.split('### Creating Under a Brand')[0]
    // The first block contains the "Creating a Series" variant
    const firstCodeBlock = firstBlock.split('```')[1] || ''
    expect(firstCodeBlock).not.toContain('parent_resource')

    // Second variant SHOULD have parent_resource
    expect(result).toContain('parent_resource: "brands/{brand_id}/series"')
  })

  it('renders shared checklists once after all variants', () => {
    const result = generateToolUsage(makeContext(config, seriesFieldDefs, 'series'))

    expect(result).toContain('### Required Attributes')
    // Only one checklist section
    const requiredCount = (result.match(/### Required Attributes/g) || []).length
    expect(requiredCount).toBe(1)
  })

  it('includes fixedAttributes in create blocks', () => {
    const result = generateToolUsage(makeContext(config, seriesFieldDefs, 'series'))

    expect(result).toContain('"title_group_type": "series"')
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge cases', () => {
  it('handles empty toolUsage config', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    expect(result).toContain('## TOOL USAGE')
    expect(result).toContain('model: "brand"')
  })

  it('handles undefined toolUsage config', () => {
    const context = {
      modelName: 'brand',
      promptClass: { fieldDefinitions: baseFieldDefs }
    }
    const result = generateToolUsage(context)

    expect(result).toContain('## TOOL USAGE')
  })

  it('handles empty fieldDefinitions', () => {
    const result = generateToolUsage(makeContext({}, {}))

    expect(result).toContain('## TOOL USAGE')
    expect(result).toContain('model: "brand"')
    expect(result).not.toContain('### Required Attributes')
  })

  it('multiple postCreateSteps get sequential step numbers', () => {
    const config = {
      postCreateSteps: [
        {
          title: 'Add Platforms',
          model: 'specific_platform',
          parentTemplate: 'test',
          attributes: {}
        },
        {
          title: 'Add Requirements',
          model: 'granted_requirement',
          parentTemplate: 'test2',
          attributes: {}
        }
      ]
    }
    const result = generateToolUsage(makeContext(config, {}))

    expect(result).toContain('### Step 2: Add Platforms')
    expect(result).toContain('### Step 3: Add Requirements')
  })
})
