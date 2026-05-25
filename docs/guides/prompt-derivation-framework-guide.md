# Prompt Derivation Framework Guide

A 5-layer architecture for generating prompt documentation from model and prompt configuration, eliminating manual duplication and ensuring consistency.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Layer 1: Schema Derivation](#layer-1-schema-derivation)
- [Layer 2: Grouping](#layer-2-grouping)
- [Layer 3: Section Documentation](#layer-3-section-documentation)
- [Layer 4: Assembly Pipeline](#layer-4-assembly-pipeline)
- [Layer 5: Behavioral](#layer-5-behavioral)
- [PromptContentGenerator API](#promptcontentgenerator-api)
- [Migration Guide](#migration-guide)
- [Content Categories](#content-categories)

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 5: BEHAVIORAL — generateStatefulGuidanceInstructions()    │
│ (BasePrompt) Turn-taking, validation, mode selection            │
├──────────────────────────────────────────────────────────────────┤
│ Layer 4: ASSEMBLY — PromptContentGenerator.build()              │
│ Composes all layers into final promptContent                    │
├──────────────────────────────────────────────────────────────────┤
│ Layer 3: SECTION DOCS — PromptContentGenerator + BasePrompt     │
│ Per-section field tables, enum tables, content notes            │
├──────────────────────────────────────────────────────────────────┤
│ Layer 2: GROUPING — sections + fieldGroups                      │
│ (BasePrompt static config) Workflow structure, field org        │
├──────────────────────────────────────────────────────────────────┤
│ Layer 1: SCHEMA — derivePromptSchema()                          │
│ (schema-derivation.js) fieldDefinitions from model config       │
└──────────────────────────────────────────────────────────────────┘
```

**Data flows bottom-up**: Model config → field definitions → grouped sections → assembled documentation → behavioral instructions.

## Layer 1: Schema Derivation

**File**: `lib/mcp/prompts/schema-derivation.js`

Generates `fieldDefinitions` from model's `attributes`. This is the foundation — all field metadata comes from the model.

```javascript
import { derivePromptSchema } from '#src/mcp/prompts/schema-derivation.js'
import { Activity } from '../models/index.js'

static {
  const schema = derivePromptSchema(Activity, {
    fieldGroups: this.fieldGroups,
    fieldOverrides: {
      // Override/extend fields from model
      theme_id: { required: true }
    },
    promptFields: {
      // Prompt-only fields not in model
      book_ids: { name: 'book_ids', type: 'array', required: false }
    }
  })

  this.fieldGroups = schema.fieldGroups
  this.fieldDefinitions = schema.fieldDefinitions
}
```

**Key principle**: The model's `attributes` is the single source of truth. `derivePromptSchema()` reads `type`, `description`, `examples`, `enumValues`, `enumDescriptions`, `default`, `validation`, `conditional`, and `required` from the model and assembles them into `fieldDefinitions`.

## Layer 2: Grouping

**File**: Prompt class static properties

> **Detailed reference:** [Sections & Field Groups guide](./sections-groups-guide.md). This section presents grouping as a layer of the derivation pipeline; the linked guide is the canonical reference for the two structures themselves.

Two complementary structures organize fields:

### Sections (User-facing)

```javascript
static sections = {
  classification: {
    title: 'Classification',
    description: 'Theme and category',
    required: true,
    groups: ['classification'],
    content: {
      intro: 'Classification determines how activities are organized.',
      notes: ['Use find_records to look up themes']
    }
  }
}
```

### FieldGroups (Validation)

```javascript
static fieldGroups = {
  classification: {
    fields: ['theme_id', 'category_id'],
    context: 'Classification',
    required: true
  }
}
```

**Section `content` enrichment**: The `content.intro` and `content.notes` properties are automatically included in generated section documentation (Layer 3). Use these to add domain-specific context without writing custom section generator methods:

- `content.intro` (string) — Rendered before the field table. Supports full markdown.
- `content.notes` (string[]) — Rendered as a bullet list after the field table and enum tables.
- `askPrompt` (string) — Custom "Ask the user: ..." prompt at the end of the section.

**Key principle**: Prefer `content.intro`/`content.notes` over `customSections` overrides in `allSections()`. This keeps domain content in configuration while the framework auto-generates field tables and enum tables alongside it.

## Layer 3: Section Documentation

**Files**: `lib/mcp/prompts/base-prompt.js`, `lib/mcp/prompts/prompt-content-generator.js`

Generates per-section documentation from config. Includes:

- Field tables (name, required, description)
- Enum value tables (from `enumDescriptions` in model config)
- Section intro text (from `content.intro`)
- Section notes (from `content.notes`)
- "Ask the user" prompts
- Validation reminders

### Atomic Helpers (BasePrompt static methods)

| Method                                            | Input                                       | Output                                                         |
| ------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `generateSectionDocumentation(group, num, model)` | fieldGroup name, section number, model name | Complete section doc with field table, enum tables, ask prompt |
| `generateEnumTable(fieldName)`                    | Field name with enumValues                  | Markdown table of enum values with descriptions                |
| `generateAttributeReferenceFromConfig()`          | (uses this.fieldDefinitions)                | Full attribute reference table                                 |
| `generateSummaryTemplate(modelName)`              | Model name                                  | Standard summary/confirmation section                          |

### Enum Tables

When a model field has `enumDescriptions`, enum tables are automatically generated:

```javascript
// In model:
static attributes = {
  status: {
    type: 'enum',
    enumValues: ['planned', 'active', 'paused', 'completed', 'archived'],
    default: 'planned',
    enumDescriptions: {
      planned: 'Not yet started',
      active: 'Currently in progress',
      paused: 'Temporarily on hold',
      completed: 'Finished',
      archived: 'No longer relevant'
    }
  }
}
```

Generated output:

```markdown
**`status` values:**
| Value | Description |
|-------|-------------|
| `"planned"` | Not yet started **(default)** |
| `"active"` | Currently in progress |
| `"paused"` | Temporarily on hold |
| `"completed"` | Finished |
| `"archived"` | No longer relevant |
```

## Layer 4: Assembly Pipeline

**File**: `lib/mcp/prompts/prompt-content-generator.js`

The `PromptContentGenerator` builder composes all layers into final `promptContent`.

```javascript
get promptContent() {
  return PromptContentGenerator.for(ActivityPrompt, 'activity')
    .add(`# Activity Creation Guide

## What is an Activity?
Custom intro text...`)
    .standard()           // flowDiagram → guidance → allSections → summary
    .add(this.generateToolUsageSection())  // Custom tool usage
    .attributeReference() // Layer 3: attribute reference table
    .build()              // Join with '\n\n---\n\n'
}
```

Parts are joined with `\n\n---\n\n` (horizontal rules) by default.

## Layer 5: Behavioral

**File**: `lib/mcp/prompts/base-prompt.js` — `generateStatefulGuidanceInstructions()`

Only applies to stateful prompts. Generates:

- Mode selection (guided vs quick)
- Turn-taking enforcement rules
- Section-by-section validation requirements
- Forbidden/correct behavior patterns

Accessed via `.guidance()` in the builder.

## PromptContentGenerator API

### Factory

```javascript
PromptContentGenerator.for(PromptClass, 'model_name')
```

### Builder Methods

| Method                                   | Description                                                                | Use With       |
| ---------------------------------------- | -------------------------------------------------------------------------- | -------------- |
| `.add(content)`                          | Add custom markdown content                                                | All strategies |
| `.standard(options?)`                    | Canonical: flowDiagram → guidance → beforeSections → allSections → summary | All            |
| `.guidance()`                            | Stateful guidance instructions (Layer 5)                                   | Stateful only  |
| `.section(groupName, num, options)`      | Single section documentation                                               | Stateful       |
| `.allSections({ skip, customSections })` | All sections from config                                                   | Stateful       |
| `.summary()`                             | Standard summary/confirmation template                                     | Stateful       |
| `.attributeReference()`                  | Auto-generated attribute table                                             | All strategies |
| `.build(separator)`                      | Join parts (default: `\n\n---\n\n`)                                        | All            |

### `.allSections()` Options

```javascript
.allSections({
  skip: ['content'],  // Skip sections handled by custom .add() calls
  customSections: {
    // Override specific sections with custom generators
    resources: (sectionNum) => `## SECTION ${sectionNum}: Resources\n...custom content...`
  }
})
```

## Migration Guide

### Before (manual documentation)

```javascript
get promptContent() {
  return `
# My Guide
...intro...

| Field | Required | Description |
|-------|----------|-------------|
| name | Yes | The name |        ← Hardcoded, will drift from model
| type | No | The type |

## Summary
...manual summary...

## Attribute Reference
${this.generateAttributeReference()}  ← Custom method per prompt
`
}
```

### After (framework)

```javascript
import { PromptContentGenerator } from '#src/mcp/prompts/prompt-content-generator.js'

get promptContent() {
  return PromptContentGenerator.for(MyPrompt, 'my_model')
    .add(`# My Guide\n\n...intro...`)
    .standard()
    .add(this.generateToolUsageSection())
    .attributeReference()  // One line replaces 20+ lines
    .build()
}
```

### Migration Steps

1. Add `import { PromptContentGenerator } from '#src/mcp/prompts/prompt-content-generator.js'`
2. Replace `promptContent` getter with builder pipeline
3. Remove `generateAttributeReference()` → replaced by `.attributeReference()`
4. Remove `generateSummarySection()` → replaced by `.summary()` (stateful)
5. Keep domain-specific methods (tool usage, custom sections) as `.add()` calls
6. Update tests if they check for specific format strings

## Content Categories

When migrating, classify each piece of content:

| Category                  | Description                                   | Action                                                       |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| **A: Auto-generatable**   | Summary templates, attribute references       | Replace with `.summary()`, `.attributeReference()`           |
| **B: Config-generatable** | Section documentation, enum tables            | Use `.allSections()` or `.section()`, enrich `content.notes` |
| **C: Custom**             | Intro text, tool usage, domain-specific logic | Keep as `.add()` calls                                       |

**Rule of thumb**: If the content depends only on `fieldDefinitions`, `fieldGroups`, or `sections`, it's auto-generatable. If it requires runtime state or domain knowledge, keep it as `.add()`.
