# Sections & Field Groups

Sections and field groups are the two halves of mcp-rune's prompt structure. **Sections** define the user-facing workflow — how an LLM walks the user through a creation or update flow. **Field groups** define validation — which fields belong together and what rules apply. They live side by side in every prompt class, and the framework derives field tables, flow diagrams, and per-section docs from both.

This guide is the reference for how the two work together. For the strategy that consumes them (stateless / hybrid / stateful), see the [Prompt Creation guide](./prompt-creation-guide.md).

## Why sections?

1. **Separation of concerns** — display structure (sections) vs validation structure (fieldGroups)
2. **Scalability** — add new fieldGroups to existing sections without changing the user-facing workflow
3. **Flexibility** — multiple fieldGroups can be grouped under one section
4. **Single source of truth** — section titles and descriptions defined once

## Sections vs FieldGroups

| Aspect      | Sections                                           | FieldGroups                                              |
| ----------- | -------------------------------------------------- | -------------------------------------------------------- |
| Purpose     | User-facing workflow                               | Validation & technical organization                      |
| Contains    | `title`, `description`, `required`, `groups[]`     | `fields[]`, `required`, `conditional`, `validateSection` |
| Used by     | `generateFlowDiagramFromConfig()`, `getSections()` | `validateSection()`, `getProgress()`                     |
| Granularity | Coarse (user journey)                              | Fine (field validation)                                  |

## Defining sections

```js file=examples/sections-groups-guide-01.js
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

```ts file=examples/sections-groups-guide-01.ts
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

## Section content enrichment

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

## Per-group content (multi-group sections)

When a section contains multiple groups (`groups: ['group_a', 'group_b']`), each group can have its own `context` (display name) and `content: { intro, notes }` defined in `fieldGroups`. The generator renders each group as a `###` sub-section with its own field table.

**Key behaviors:**

- `context` defaults to title-cased group name if absent (`snake_case_name` → "Snake Case Name")
- Groups without `content` render just a heading and field table (no intro/notes)
- Single-group sections are completely unchanged — they read from `section.content` as before
- `context` and `content` on fieldGroups are ignored by StatefulStrategy (no breaking changes to validation)

## Defining fieldGroups (simplified)

With sections as first-class citizens, fieldGroups focus on validation:

```js file=examples/sections-groups-guide-02.js
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

```ts file=examples/sections-groups-guide-02.ts
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

## Section helper methods

`BasePrompt` provides helper methods for working with sections:

| Method                              | Description                                                     |
| ----------------------------------- | --------------------------------------------------------------- |
| `getSectionFields(sectionName)`     | Get all field definitions for a section (across all its groups) |
| `getSectionFieldNames(sectionName)` | Get all field names for a section                               |
| `getSectionForGroup(groupName)`     | Reverse lookup: find which section a group belongs to           |
| `getSectionNumber(sectionName)`     | Get 1-based section number for display                          |

## Flow diagram generation

The `generateFlowDiagramFromConfig()` method uses sections to create a compact flow overview:

```js file=examples/sections-groups-guide-03.js
// Auto-generated from sections config
**Flow:** (● required, ○ optional)
● 1. BASIC INFORMATION - title, description
● 2. CLASSIFICATION - theme_id, category_id
○ 3. TIMING - started_at, ended_at, duration_minutes
○ 4. RESOURCES - book_ids, notes_generated
● 5. SUMMARY
```

```ts file=examples/sections-groups-guide-03.ts
// Auto-generated from sections config
**Flow:** (● required, ○ optional)
● 1. BASIC INFORMATION - title, description
● 2. CLASSIFICATION - theme_id, category_id
○ 3. TIMING - started_at, ended_at, duration_minutes
○ 4. RESOURCES - book_ids, notes_generated
● 5. SUMMARY
```

## See also

- [Prompt Creation guide](./prompt-creation-guide.md) — the strategies (stateless / hybrid / stateful) that consume these sections.
- [Stateful Strategies guide](./stateful-strategies-guide.md) — per-section validation and progress tracking on top of this structure.
- [Prompt Derivation Framework guide](./prompt-derivation-framework-guide.md) — Layer 2 of the derivation pipeline where this content is consumed.
