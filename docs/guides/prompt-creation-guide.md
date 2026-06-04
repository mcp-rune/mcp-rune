---
extension:
  kind: hook
  what: askPrompts · per-section content enrichment
---

# Prompt Creation Guide

This document provides guidelines for creating MCP prompts in this codebase.

## Table of Contents

- [Overview](#overview)
- [Prompt Strategies](#prompt-strategies)
- [Sections & field groups](#sections--field-groups) — see [`sections-groups-guide.md`](./sections-groups-guide.md)
- [Schema Derivation](#schema-derivation)
- [PromptContentGenerator](#promptcontentgenerator)
- [Stateful prompts](#stateful-prompts) — see [`stateful-strategies-guide.md`](./stateful-strategies-guide.md)
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

The three strategies are an escalation: as form complexity grows, the framework adds more LLM-facing tools so the agent can validate in smaller bites.

<!-- illustration: prompt-creation#strat -->

```
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │    STATELESS     │  │      HYBRID      │  │     STATEFUL     │
   ├──────────────────┤  ├──────────────────┤  ├──────────────────┤
   │ < 10 fields      │  │ 10 – 20 fields   │  │ 20+ fields       │
   │                  │  │                  │  │                  │
   │ Ops:             │  │ Ops:             │  │ Ops:             │
   │  getDocumen-     │  │  getDocumen-     │  │  getDocumen-     │
   │   tation         │  │   tation         │  │   tation         │
   │                  │  │  validateFields  │  │  validateFields  │
   │                  │  │  generateSummary │  │  generateSummary │
   │                  │  │                  │  │  validateSection │
   │                  │  │                  │  │  getProgress     │
   │                  │  │                  │  │                  │
   │ Validate at      │  │ Validate full    │  │ Validate per     │
   │ submit only      │  │ form once        │  │ section + track  │
   │                  │  │ before submit    │  │ progress         │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
        Simple forms       Medium forms          Complex forms
```

Same model definition drives all three — choose by setting `static strategy = 'stateless' | 'hybrid' | 'stateful'` on the prompt class. Upgrading later doesn't change the model.

| Strategy    | Use Case      | Fields       | Validation           |
| ----------- | ------------- | ------------ | -------------------- |
| `stateless` | Simple forms  | < 10 fields  | None before submit   |
| `hybrid`    | Medium forms  | 10-20 fields | Full form validation |
| `stateful`  | Complex forms | 20+ fields   | Section-by-section   |

## Sections & field groups

Sections define the user-facing workflow; field groups carry validation. The two work together — one section can contain one or more field groups, and the framework auto-generates field tables, enum tables, and flow diagrams from both.

For the full reference — section content enrichment, per-group content for multi-group sections, helper methods, and flow-diagram generation — see the **[Sections & Field Groups guide](./sections-groups-guide.md)**.

In short:

1. **Separation of concerns** — display structure (sections) vs validation structure (fieldGroups)
2. **Scalability** — add new fieldGroups to existing sections without changing the user-facing workflow
3. **Flexibility** — multiple fieldGroups can be grouped under one section
4. **Single source of truth** — section titles and descriptions defined once

## Schema Derivation

Field definitions are derived from model classes via `derivePromptSchema()`. This eliminates duplication between models and prompts.

### How It Works

```js file=src/prompts/activity-prompt.js
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

```ts file=src/prompts/activity-prompt.ts
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

```js file=examples/prompt-creation-guide-02.js
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

```ts file=examples/prompt-creation-guide-02.ts
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

```js file=examples/prompt-creation-guide-03.js
PromptContentGenerator.for(ActivityPrompt, 'activity')
  .add(intro)
  .standard() // Enforces canonical ordering
  .add(toolUsage)
  .attributeReference()
  .build()
```

```ts file=examples/prompt-creation-guide-03.ts
PromptContentGenerator.for(ActivityPrompt, 'activity')
  .add(intro)
  .standard() // Enforces canonical ordering
  .add(toolUsage)
  .attributeReference()
  .build()
```

**With custom sections** (skip pattern):

```js file=examples/prompt-creation-guide-04.js
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

```ts file=examples/prompt-creation-guide-04.ts
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

## Stateful prompts

For complex (20+ field) forms, mcp-rune ships a stateful strategy that walks the agent through one section at a time and validates as it goes. The strategy supports two interaction modes — `guided` (step-by-step for humans) and `quick` (minimal questions for agentic flows) — and exposes section progress through the `StatefulStrategy` API.

For mode configuration, the prompt class structure, the `BasePrompt` helpers, the validation flow, and the `StatefulStrategy.getSections()` / `getProgress()` reference, see the **[Stateful Strategies guide](./stateful-strategies-guide.md)**.

## Stateless Prompts

For simple models (< 10 fields), use stateless strategy:

```js file=src/prompts/theme-prompt.js
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

```ts file=src/prompts/theme-prompt.ts
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

```js file=examples/prompt-creation-guide-06.js
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

```ts file=examples/prompt-creation-guide-06.ts
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

```js file=src/arg-names.js
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

```ts file=src/arg-names.ts
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

```js file=src/snap.js
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

```ts file=src/snap.ts
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
