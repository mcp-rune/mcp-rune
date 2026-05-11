# Prompt Creation Guide

This document provides guidelines for creating MCP prompts in this codebase.

## Table of Contents

- [Overview](#overview)
- [Prompt Strategies](#prompt-strategies)
- [Sections Architecture](#sections-architecture)
- [Schema Derivation](#schema-derivation)
- [PromptContentGenerator](#promptcontentgenerator)
- [Stateful Prompts](#stateful-prompts)
- [StatefulStrategy API](#statefulstrategy-api)
- [Stateless Prompts](#stateless-prompts)
- [Registry Configuration](#registry-configuration)
- [Testing Prompts](#testing-prompts)
- [Checklist for New Prompts](#checklist-for-new-prompts)

## Overview

Prompts guide LLM interactions for creating/updating models. They define:

- Sections for user-facing workflow structure
- Field groups for validation and technical organization
- Field definitions with validation rules
- Prompt content for domain-specific documentation
- MCP arguments for discoverability

## Prompt Strategies

| Strategy    | Use Case      | Fields       | Validation           |
| ----------- | ------------- | ------------ | -------------------- |
| `stateless` | Simple forms  | < 10 fields  | None before submit   |
| `hybrid`    | Medium forms  | 10-20 fields | Full form validation |
| `stateful`  | Complex forms | 20+ fields   | Section-by-section   |

## Sections Architecture

Sections are **first-class citizens** that define the user-facing workflow structure. They group one or more `fieldGroups` for display purposes while keeping validation logic at the fieldGroup level.

### Why Sections?

1. **Separation of concerns** - Display structure (sections) vs validation structure (fieldGroups)
2. **Scalability** - Add new fieldGroups to existing sections without changing the user-facing workflow
3. **Flexibility** - Multiple fieldGroups can be grouped under one section
4. **Single source of truth** - Section titles and descriptions defined once

### Sections vs FieldGroups

| Aspect      | Sections                                           | FieldGroups                                              |
| ----------- | -------------------------------------------------- | -------------------------------------------------------- |
| Purpose     | User-facing workflow                               | Validation & technical organization                      |
| Contains    | `title`, `description`, `required`, `groups[]`     | `fields[]`, `required`, `conditional`, `validateSection` |
| Used by     | `generateFlowDiagramFromConfig()`, `getSections()` | `validateSection()`, `getProgress()`                     |
| Granularity | Coarse (user journey)                              | Fine (field validation)                                  |

### Defining Sections

```javascript
static sections = {
  basics: {
    title: 'Basic Information',
    description: 'Title and description for the activity',
    required: true,
    groups: ['basics'],
    content: {
      intro: 'The title and description that identify the activity.'
    }
  },
  classification: {
    title: 'Classification',
    description: 'Theme and category for organizing the activity',
    required: true,
    groups: ['classification'],
    content: {
      notes: [
        'Use `find_records(model: "theme")` to find the theme',
        'Use `find_records(model: "category")` to find the category'
      ]
    }
  },
  timing: {
    title: 'Timing',
    description: 'When the activity occurred and how long it lasted',
    required: false,
    groups: ['timing'],
    content: {
      intro: 'When the activity occurred and how long it lasted.'
    }
  }
}
```

### Section Content Enrichment

Sections support a `content` property with `intro` and `notes` that are automatically rendered in the generated section documentation. Use these to add domain-specific context without writing custom section generator methods.

| Property        | Type       | Description                                                                                           |
| --------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `content.intro` | `string`   | Introductory text rendered at the top of the section, before the field table. Supports full markdown. |
| `content.notes` | `string[]` | Array of notes rendered as a bullet list after the field table and enum tables.                       |
| `askPrompt`     | `string`   | Custom prompt shown as "Ask the user: ..." at the end of the section.                                 |

**How it works**: When `allSections()` or `generateSectionDocumentation()` renders a section, it automatically:

1. Adds `content.intro` before the field table
2. Generates the field table from `fieldDefinitions`
3. Generates enum tables for any field with `enumDescriptions`
4. Adds `content.notes` as a bullet list
5. Adds the `askPrompt` prompt

**Key principle**: Prefer `content.intro` and `content.notes` over custom `generateSectionXDocumentation()` methods. This keeps domain content in configuration and lets the framework auto-generate field tables and enum tables alongside it.

### Per-Group Content (Multi-Group Sections)

When a section contains multiple groups (`groups: ['group_a', 'group_b']`), each group can have its own `context` (display name) and `content: { intro, notes }` defined in `fieldGroups`. The generator renders each group as a `###` sub-section with its own field table.

**Key behaviors:**

- `context` defaults to title-cased group name if absent (`snake_case_name` → "Snake Case Name")
- Groups without `content` render just a heading and field table (no intro/notes)
- Single-group sections are completely unchanged — they read from `section.content` as before
- `context` and `content` on fieldGroups are ignored by StatefulStrategy (no breaking changes to validation)

### Defining FieldGroups (Simplified)

With sections as first-class citizens, fieldGroups focus on validation:

```javascript
static fieldGroups = {
  basics: {
    fields: ['title', 'description'],
    context: 'Basic Information',
    required: true,
    description: 'Title and description for the activity'
  },
  classification: {
    fields: ['theme_id', 'category_id'],
    context: 'Classification',
    required: true,
    description: 'Theme and category for organizing the activity'
  }
}
```

### Section Helper Methods

BasePrompt provides helper methods for working with sections:

| Method                              | Description                                                     |
| ----------------------------------- | --------------------------------------------------------------- |
| `getSectionFields(sectionName)`     | Get all field definitions for a section (across all its groups) |
| `getSectionFieldNames(sectionName)` | Get all field names for a section                               |
| `getSectionForGroup(groupName)`     | Reverse lookup: find which section a group belongs to           |
| `getSectionNumber(sectionName)`     | Get 1-based section number for display                          |

### Flow Diagram Generation

The `generateFlowDiagramFromConfig()` method uses sections to create a compact flow overview:

```javascript
// Auto-generated from sections config
**Flow:** (● required, ○ optional)
● 1. BASIC INFORMATION - title, description
● 2. CLASSIFICATION - theme_id, category_id
○ 3. TIMING - started_at, ended_at, duration_minutes
○ 4. RESOURCES - book_ids, notes_generated
● 5. SUMMARY
```

## Schema Derivation

Field definitions are derived from model classes via `derivePromptSchema()`. This eliminates duplication between models and prompts.

### How It Works

```javascript
import { derivePromptSchema } from '#src/mcp/prompts/schema-derivation.js'
import { Activity } from '../models/index.js'

export class ActivityPrompt extends BasePrompt {
  static fieldGroups = {
    basics: {
      fields: ['title', 'description'],
      context: 'Basic Information',
      required: true
    }
  }

  // Schema derivation: generates fieldDefinitions FROM model's attributes
  static {
    const schema = derivePromptSchema(Activity, {
      fieldGroups: this.fieldGroups,
      fieldOverrides: {
        theme_id: { required: true }
      },
      promptFields: {
        book_ids: { name: 'book_ids', type: 'array', required: false }
      }
    })

    this.fieldGroups = schema.fieldGroups
    this.fieldDefinitions = schema.fieldDefinitions
  }
}
```

### Key Principles

1. **Model is source of truth**: `attributes` contains ALL field metadata
2. **Prompt groups fields**: `fieldGroups` specifies which fields belong together
3. **Schema derivation bridges them**: `derivePromptSchema()` generates `fieldDefinitions` from model config
4. **Never hardcode field tables**: Use generated documentation from `fieldDefinitions`

## PromptContentGenerator

The `PromptContentGenerator` is a fluent builder for assembling prompt content from configuration. It implements Layers 3-4 of the derivation framework.

### Usage

```javascript
import { PromptContentGenerator } from '#src/mcp/prompts/prompt-content-generator.js'

get promptContent() {
  return PromptContentGenerator.for(ActivityPrompt, 'activity')
    .add(`# Activity Creation Guide

## What is an Activity?
...custom intro text...`)
    .standard()           // flowDiagram → guidance → allSections → summary
    .add(this.generateToolUsageSection())  // Custom tool usage
    .attributeReference() // Auto-generated attribute reference table
    .build()
}
```

### Builder Methods

| Method                                   | Description                                                                | Strategy      |
| ---------------------------------------- | -------------------------------------------------------------------------- | ------------- |
| `.add(content)`                          | Add custom markdown content                                                | All           |
| `.standard(options?)`                    | Canonical: flowDiagram → guidance → beforeSections → allSections → summary | All           |
| `.flowDiagram()`                         | Add step-by-step roadmap                                                   | All           |
| `.guidance()`                            | Add stateful guidance instructions                                         | Stateful only |
| `.section(groupName, num)`               | Add single section documentation                                           | Stateful      |
| `.allSections({ skip, customSections })` | Add all section docs                                                       | Stateful      |
| `.summary()`                             | Add standard summary template                                              | Stateful      |
| `.attributeReference()`                  | Add auto-generated attribute table                                         | All           |
| `.build(separator)`                      | Join all parts (default: `\n\n---\n\n`)                                    | All           |

### Atomic Helpers on BasePrompt

The builder delegates to these static methods on BasePrompt:

| Method                                   | Description                           |
| ---------------------------------------- | ------------------------------------- |
| `generateEnumTable(fieldName)`           | Enum value table with descriptions    |
| `generateAttributeReferenceFromConfig()` | Full attribute reference table        |
| `generateSummaryTemplate(modelName)`     | Standard summary/confirmation section |

### Strategy Patterns

**Standard** (all strategies — preferred):

```javascript
PromptContentGenerator.for(ActivityPrompt, 'activity')
  .add(intro)
  .standard() // Enforces canonical ordering
  .add(toolUsage)
  .attributeReference()
  .build()
```

**With custom sections** (skip pattern):

```javascript
PromptContentGenerator.for(MyPrompt, 'model')
  .add(intro)
  .standard({
    beforeSections: [customSection], // Inserted before allSections
    skip: ['content'] // Skipped in allSections
  })
  .add(toolUsage)
  .attributeReference()
  .build()
```

## Stateful Prompts

Stateful prompts are for complex models with many fields organized into sections. They provide step-by-step guidance and per-section validation.

### Mode Configuration

Stateful prompts support two interaction modes:

| Mode     | Behavior                                      | Use Case                         |
| -------- | --------------------------------------------- | -------------------------------- |
| `guided` | Walk through each section interactively       | Human interaction via MCP client |
| `quick`  | Minimize questions, infer values from context | Agentic workflows, automation    |

#### Enabling Mode Selection

**1. Add `mode` to static arguments**

```javascript
static arguments = [
  { name: 'mode', description: '"guided" (step-by-step) or "quick" (minimal interaction)', required: false },
  // ... other prompt-specific arguments
]
```

**2. Mode selection is automatic via BasePrompt**

The `generateStatefulGuidanceInstructions()` method automatically includes mode selection instructions.

### Structural Overview

The **Flow diagram** (generated by `.flowDiagram()`) serves as the single structural overview. In guided mode, the LLM references this diagram rather than repeating section information.

### Stateful Prompt Structure

```javascript
import { BasePrompt } from './base_prompt.js'

export class ActivityPrompt extends BasePrompt {
  // 1. Declare strategy
  static strategy = 'stateful'

  // 2. Define sections (user-facing workflow)
  static sections = {
    basics: {
      title: 'Basic Information',
      description: 'Title and description',
      required: true,
      groups: ['basics']
    }
  }

  // 3. Define field groups (validation structure)
  static fieldGroups = {
    basics: {
      fields: ['title', 'description'],
      required: true
    }
  }

  // 4. Schema derivation
  static {
    const schema = derivePromptSchema(Activity, {
      fieldGroups: this.fieldGroups
    })
    this.fieldGroups = schema.fieldGroups
    this.fieldDefinitions = schema.fieldDefinitions
  }

  // 5. MCP metadata
  static title = 'Create Activity'
  static modelName = 'activity'

  // 6. Arguments with mode support
  static arguments = [
    { name: 'mode', description: '"guided" or "quick"', required: false },
    { name: 'title', description: 'Activity title', required: false }
  ]

  // 7. Generate description using BasePrompt helpers
  static description = `${ActivityPrompt.getStrategyIntro()} activities.

**Field Groups:**
${ActivityPrompt.generateFieldGroupsList()}

${ActivityPrompt.generateFlowDiagramFromConfig()}`

  // 8. Prompt content using PromptContentGenerator
  get promptContent() {
    return PromptContentGenerator.for(ActivityPrompt, 'activity')
      .add(`# Activity Creation Guide\n\n...`)
      .standard()
      .add(this.generateToolUsageSection())
      .attributeReference()
      .build()
  }
}
```

### BasePrompt Helpers

| Method                                                              | Purpose                                             |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `generateFieldGroupsList()`                                         | List field groups with fields and requirements      |
| `generateFlowDiagramFromConfig()`                                   | Compact flow diagram from sections/fieldGroups      |
| `generateStatefulGuidanceInstructions(modelName)`                   | Full guidance instructions including mode selection |
| `generateSectionDocumentation(groupName, sectionNumber, modelName)` | Per-section documentation                           |
| `generateToolExample(modelName, action, attributes)`                | Generate tool usage example                         |
| `getStrategyIntro()`                                                | Strategy-appropriate intro text                     |
| `getSectionFields(sectionName)`                                     | Get all fields for a section                        |
| `getSectionForGroup(groupName)`                                     | Get section for a fieldGroup                        |
| `getSectionFieldNames(sectionName)`                                 | Get all field names for a section                   |
| `getSectionNumber(sectionName)`                                     | Get 1-based section number                          |

### Validation Flow

Stateful prompts require validation after each section:

```
User provides section input
    |
LLM calls validate_form(model, section, fields)
    |
Server validates and returns errors/warnings
    |
LLM proceeds to next section or asks for corrections
    |
After all sections: validate_form(model, fields) for full validation
    |
If ready_to_submit: true -> create_model()
```

## StatefulStrategy API

The `StatefulStrategy` class handles stateful prompts with sections support.

### getSections(promptClass)

Returns section metadata with aggregated fields from groups:

```javascript
const sections = StatefulStrategy.getSections(ActivityPrompt)
// Returns:
[
  {
    name: 'basics',
    title: 'Basic Information',
    required: true,
    fields: ['title', 'description'],
    groups: ['basics'],
    description: 'Title and description for the activity'
  },
  // ...
]
```

### getProgress(promptClass, fields)

Returns completion progress by fieldGroup:

```javascript
const progress = StatefulStrategy.getProgress(ActivityPrompt, fields)
// Returns:
{
  sections: {
    basics: {
      applicable: true,
      total_fields: 2,
      filled_fields: 1,
      complete: false,
      partial: true,
      required: true,
      title: 'Basic Information'
    }
  },
  overall: {
    total_sections: 4,
    completed_sections: 1,
    required_complete: false,
    percentage: 25
  }
}
```

## Stateless Prompts

For simple models (< 10 fields), use stateless strategy:

```javascript
export class ThemePrompt extends BasePrompt {
  static strategy = 'stateless'

  static fieldGroups = {
    theme_identity: {
      fields: ['name', 'slug'],
      required: true
    }
  }

  // No mode argument needed - stateless prompts don't have sections
  static arguments = [{ name: 'name', description: 'Theme name', required: false }]
}
```

Stateless prompts:

- Collect all fields at once
- No per-section validation
- No mode selection (no sections to walk through)

## Registry Configuration

Register prompts in `prompts/registry.js`:

```javascript
const PROMPT_CLASSES = {
  create_activity: {
    promptClass: ActivityPrompt,
    model: 'activity',
    toolDocDescription: 'For tracking learning activities with timing and resources',
    required: true,
    recommendedForBulk: false
  }
}
```

| Property             | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `promptClass`        | Reference to prompt class                                           |
| `model`              | Model name for validation/creation                                  |
| `toolDocDescription` | Shown in tool documentation                                         |
| `required`           | If true, create_model/update_model blocked without get_prompt_guide |
| `recommendedForBulk` | If true, suggest prompt for bulk operations                         |

## Testing Prompts

Test files should verify sections architecture:

```javascript
describe('ActivityPrompt', () => {
  describe('static properties', () => {
    it('should have strategy of stateful', () => {
      expect(ActivityPrompt.strategy).toBe('stateful')
    })

    it('should have mode in arguments', () => {
      const argNames = ActivityPrompt.arguments.map((a) => a.name)
      expect(argNames).toContain('mode')
    })
  })

  describe('sections architecture', () => {
    it('should have sections defined', () => {
      expect(ActivityPrompt.sections).toBeDefined()
      expect(Object.keys(ActivityPrompt.sections).length).toBeGreaterThan(0)
    })

    it('each section has required properties', () => {
      for (const [name, section] of Object.entries(ActivityPrompt.sections)) {
        expect(section.title).toBeDefined()
        expect(section.description).toBeDefined()
        expect(typeof section.required).toBe('boolean')
        expect(Array.isArray(section.groups)).toBe(true)
      }
    })

    it('all groups in sections exist in fieldGroups', () => {
      const fieldGroupNames = Object.keys(ActivityPrompt.fieldGroups)
      for (const [, section] of Object.entries(ActivityPrompt.sections)) {
        for (const groupName of section.groups) {
          expect(fieldGroupNames).toContain(groupName)
        }
      }
    })
  })
})
```

### File-Based Snapshot Tests

Use `toMatchFileSnapshot()` to capture the complete rendered `promptContent` as individual `.prompt.md` files:

```javascript
import { join } from 'node:path'

const SNAP_DIR = join(import.meta.dirname, '__file_snapshots__')
const snap = (name) => join(SNAP_DIR, `${name}.prompt.md`)

describe('Prompt Snapshots', () => {
  it('ActivityPrompt renders full output', async () => {
    const instance = new ActivityPrompt({})
    await expect(instance.promptContent).toMatchFileSnapshot(snap('activity-prompt'))
  })

  it('BookPrompt renders full output', async () => {
    const instance = new BookPrompt({})
    await expect(instance.promptContent).toMatchFileSnapshot(snap('book-prompt'))
  })
})
```

**Key rules:**

- All assertions must use `await` — `toMatchFileSnapshot` is async
- Naming convention: `{prompt-name}--{variant}.prompt.md`
- Update snapshots after intentional changes: `npx vitest run --update`

## Checklist for New Prompts

### All Prompts

- [ ] Choose strategy: `stateless`, `hybrid`, or `stateful`
- [ ] Define `sections` with user-facing structure (title, description, required, groups)
- [ ] Define `fieldGroups` with validation structure (fields, required, conditional)
- [ ] Use `derivePromptSchema()` to generate `fieldDefinitions` from model
- [ ] Use `PromptContentGenerator` builder in `promptContent` getter
- [ ] Use `.standard()` for canonical pipeline ordering
- [ ] Use `.attributeReference()` instead of manual attribute tables
- [ ] Register in `prompts/registry.js`
- [ ] Add unit tests
- [ ] Add file-based snapshot test(s) in `prompt-snapshots.spec.js`

### Additional for Stateful Prompts

- [ ] Add `mode` to `static arguments`
- [ ] Use `.standard({ beforeSections, skip })` for custom section handling
- [ ] Enrich sections with `content.intro` and `content.notes` for domain-specific context
- [ ] Ensure all groups in sections exist in fieldGroups
- [ ] Add tests for sections architecture
