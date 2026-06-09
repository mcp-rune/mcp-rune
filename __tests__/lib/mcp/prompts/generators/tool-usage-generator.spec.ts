import { generateToolUsage } from '../../../../../src/mcp/prompts/generators/tool-usage-generator.js'

// =============================================================================
// MOCK HELPERS
// =============================================================================

function makeContext(toolUsage = {}, fieldDefs = {}, modelName = 'book') {
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
  name: { type: 'string', required: true, description: 'The name', examples: ['The Hobbit'] },
  external_id: {
    type: 'string',
    immutable: true,
    description: 'External system identifier',
    examples: ['BOOK-001']
  },
  tags: { type: 'string', description: 'Comma-separated tags', examples: ['Fiction,Fantasy'] }
}

// =============================================================================
// PATTERN A: Simple standalone
// =============================================================================

describe('Pattern A: Simple standalone', () => {
  it('generates basic create_model block', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    expect(result).toContain('## TOOL USAGE')
    expect(result).toContain('### Creating the Book')
    expect(result).toContain('model: "book"')
    expect(result).not.toContain('parent_path')
  })

  it('auto-derives example attributes from model examples', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    // Required field with examples should be included
    expect(result).toContain('"name": "The Hobbit"')
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
        publisher_link: 'https://api.example.com/publishers/123'
      }
    }
    const result = generateToolUsage(makeContext(config, baseFieldDefs))

    expect(result).toContain('"name": "Custom Name"')
    expect(result).toContain('"publisher_link"')
  })
})

// =============================================================================
// PATTERN B: Nested with static parent
// =============================================================================

describe('Pattern B: Nested with static parent', () => {
  const nestedFieldDefs = {
    name: {
      type: 'string',
      required: true,
      description: 'Chapter name',
      examples: ['Chapter Name']
    },
    external_id: { type: 'string', description: 'External ID', examples: ['CHAPTER-001'] }
  }

  it('includes parent_path in create block', () => {
    const config = { parentPath: 'books/{book_id}/chapters' }
    const result = generateToolUsage(makeContext(config, nestedFieldDefs, 'chapter'))

    expect(result).toContain('parent_path: "books/{book_id}/chapters"')
  })

  it('renders alternative creation section', () => {
    const config = {
      parentPath: 'books/{book_id}/chapters',
      alternativeCreation: {
        title: 'Using book_link in attributes',
        linkAttribute: 'book_link',
        exampleAttributes: { name: 'Chapter Name' }
      }
    }
    const result = generateToolUsage(makeContext(config, nestedFieldDefs, 'chapter'))

    expect(result).toContain('### Using book_link in attributes')
    expect(result).toContain('"book_link"')
  })
})

// =============================================================================
// PATTERN C: Dynamic parent (instance override)
// =============================================================================

describe('Pattern C: Dynamic parent via instance overrides', () => {
  const fieldDefs = {
    started_at: {
      type: 'datetime',
      required: true,
      description: 'Start date',
      examples: ['2024-06-17T06:00:00Z']
    },
    due_date: {
      type: 'datetime',
      required: true,
      description: 'Due date',
      examples: ['2024-11-01T06:00:00Z']
    }
  }

  it('uses parentPath from instance overrides', () => {
    const result = generateToolUsage(makeContext({}, fieldDefs, 'task'), {
      parentPath: 'projects/123/tasks'
    })

    expect(result).toContain('parent_path: "projects/123/tasks"')
  })
})

// =============================================================================
// PATTERN D: Multi-step with post-create
// =============================================================================

describe('Pattern D: Multi-step with postCreateSteps', () => {
  const projectFieldDefs = {
    priority: {
      type: 'enum',
      required: true,
      description: 'Priority level',
      examples: ['high']
    },
    due_date: { type: 'datetime', description: 'Due date' }
  }

  const config = {
    excludeFromAttributes: ['selected_tags'],
    postCreateSteps: [
      {
        title: 'Add Tags',
        condition: '`selected_tags` array is NOT empty',
        skipCondition: '`selected_tags` is empty, skip this step — the project will have no tags',
        model: 'tag',
        parentTemplate: 'projects/{project_id}/tags',
        attributes: { tag_link: '{tag_link}' },
        iterateOver: 'selected_tags'
      }
    ],
    notes: ['The author link must point to an existing author']
  }

  it('uses Step 1 prefix when post-create steps exist', () => {
    const result = generateToolUsage(makeContext(config, projectFieldDefs, 'project'))

    expect(result).toContain('### Step 1: Creating the Project')
  })

  it('renders post-create step with tool call', () => {
    const result = generateToolUsage(makeContext(config, projectFieldDefs, 'project'))

    expect(result).toContain('### Step 2: Add Tags')
    expect(result).toContain('model: "tag"')
    expect(result).toContain('parent_path: "projects/{project_id}/tags"')
  })

  it('renders iterate and skip instructions', () => {
    const result = generateToolUsage(makeContext(config, projectFieldDefs, 'project'))

    expect(result).toContain('Repeat for each item in `selected_tags`')
    expect(result).toContain('skip this step')
  })

  it('renders exclusion notes for prompt-only fields', () => {
    const result = generateToolUsage(makeContext(config, projectFieldDefs, 'project'))

    expect(result).toContain('Do NOT include `selected_tags`')
  })

  it('renders custom notes', () => {
    const result = generateToolUsage(makeContext(config, projectFieldDefs, 'project'))

    expect(result).toContain('The author link must point to an existing author')
  })
})

// =============================================================================
// PATTERN E: Multiple creation variants
// =============================================================================

describe('Pattern E: Multiple creation variants', () => {
  const authorFieldDefs = {
    name: {
      type: 'string',
      required: true,
      description: 'Author name',
      examples: ['Author Name']
    },
    book_count: { type: 'integer', description: 'Number of published books', examples: [1] }
  }

  const config = {
    variants: [
      {
        title: 'Creating an Author (Basic - PREFERRED)',
        description: 'Use this method by default.',
        fixedAttributes: { entity_type: 'author' }
      },
      {
        title: 'Creating Under a Genre',
        parentPath: 'genres/{genre_id}/authors',
        fixedAttributes: { entity_type: 'author' },
        description: 'WARNING: Only use if user explicitly requests.'
      }
    ]
  }

  it('renders each variant as a sub-section', () => {
    const result = generateToolUsage(makeContext(config, authorFieldDefs, 'author'))

    expect(result).toContain('### Creating an Author (Basic - PREFERRED)')
    expect(result).toContain('### Creating Under a Genre')
  })

  it('includes variant descriptions', () => {
    const result = generateToolUsage(makeContext(config, authorFieldDefs, 'author'))

    expect(result).toContain('Use this method by default.')
    expect(result).toContain('WARNING: Only use if user explicitly requests.')
  })

  it('includes parent_path only for variants that have it', () => {
    const result = generateToolUsage(makeContext(config, authorFieldDefs, 'author'))

    // First variant should NOT have parent_path
    const firstBlock = result.split('### Creating Under a Genre')[0]
    // The first block contains the "Creating an Author" variant
    const firstCodeBlock = firstBlock.split('```')[1] || ''
    expect(firstCodeBlock).not.toContain('parent_path')

    // Second variant SHOULD have parent_path
    expect(result).toContain('parent_path: "genres/{genre_id}/authors"')
  })

  it('renders shared checklists once after all variants', () => {
    const result = generateToolUsage(makeContext(config, authorFieldDefs, 'author'))

    expect(result).toContain('### Required Attributes')
    // Only one checklist section
    const requiredCount = (result.match(/### Required Attributes/g) || []).length
    expect(requiredCount).toBe(1)
  })

  it('includes fixedAttributes in create blocks', () => {
    const result = generateToolUsage(makeContext(config, authorFieldDefs, 'author'))

    expect(result).toContain('"entity_type": "author"')
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge cases', () => {
  it('handles empty toolUsage config', () => {
    const result = generateToolUsage(makeContext({}, baseFieldDefs))

    expect(result).toContain('## TOOL USAGE')
    expect(result).toContain('model: "book"')
  })

  it('handles undefined toolUsage config', () => {
    const context = {
      modelName: 'book',
      promptClass: { fieldDefinitions: baseFieldDefs }
    }
    const result = generateToolUsage(context)

    expect(result).toContain('## TOOL USAGE')
  })

  it('handles empty fieldDefinitions', () => {
    const result = generateToolUsage(makeContext({}, {}))

    expect(result).toContain('## TOOL USAGE')
    expect(result).toContain('model: "book"')
    expect(result).not.toContain('### Required Attributes')
  })

  it('multiple postCreateSteps get sequential step numbers', () => {
    const config = {
      postCreateSteps: [
        {
          title: 'Add Tags',
          model: 'tag',
          parentTemplate: 'test',
          attributes: {}
        },
        {
          title: 'Add Labels',
          model: 'label',
          parentTemplate: 'test2',
          attributes: {}
        }
      ]
    }
    const result = generateToolUsage(makeContext(config, {}))

    expect(result).toContain('### Step 2: Add Tags')
    expect(result).toContain('### Step 3: Add Labels')
  })
})
