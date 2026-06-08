# Form-Strategies (qualified GoF Strategy)

This module implements a **Strategy Pattern** — qualified here as **form-strategies** —
for handling form data collection across different prompt complexities. Each
form-strategy defines how the LLM interacts with the server during form creation.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FORM-STRATEGY SELECTION                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  Prompt Class                                                                │
│       │                                                                      │
│       ▼                                                                      │
│  static formStrategy = 'stateless' | 'hybrid' | 'stateful'                  │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │  Stateless  │    │   Hybrid    │    │  Stateful   │                      │
│  │FormStrategy │    │FormStrategy │    │FormStrategy │                      │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Form-Strategy Comparison

| Aspect                | Stateless               | Hybrid                                | Stateful                                          |
| --------------------- | ----------------------- | ------------------------------------- | ------------------------------------------------- |
| **Complexity**        | Simple (< 10 fields)    | Medium (10-20 fields)                 | Complex (20+ fields)                              |
| **Validation**        | None (errors at submit) | All fields at once                    | Section-by-section                                |
| **Progress Tracking** | No                      | No                                    | Yes                                               |
| **Conditionals**      | LLM handles             | Basic                                 | Full support                                      |
| **Operations**        | `getDocumentation`      | `+ validateFields`, `generateSummary` | `+ validateSection`, `getProgress`, `getDefaults` |

## Form-Strategy Details

### 1. StatelessFormStrategy (`stateless-form-strategy.ts`)

**Purpose:** Documentation-only approach for simple forms.

**Flow:**

```
get_prompt_guide → LLM guides conversation → create_model
```

**Supported Operations:**

- `getDocumentation()` - Returns static guidance

**Best For:**

- Simple forms with few fields (< 10)
- No conditional fields
- Straightforward submission

---

### 2. HybridFormStrategy (`hybrid-form-strategy.ts`)

**Purpose:** Documentation + validation before submission.

**Flow:**

```
get_prompt_guide → LLM guides → validate_form → create_model
```

**Supported Operations:**

- `getDocumentation()` - Returns guidance
- `validateFields(fields)` - Validates all fields at once
- `generateSummary(fields, ctx, renderer?)` - Server-generated summary (via renderer)

**Best For:**

- Medium complexity forms (10-20 fields)
- Some conditional fields
- Want validation without full state management

---

### 3. StatefulFormStrategy (`stateful-form-strategy.ts`)

**Purpose:** Section-aware validation with progress tracking. **Server keeps no
persistent state** — "stateful" refers to the LLM-server protocol exposing
section identity and progress, not server-side session storage. The LLM
remembers values across turns and resubmits them on every call.

**Flow:**

```
get_prompt_guide → [validate_section]* → validate_form → get_form_progress → create_model
```

**Supported Operations:**

- `getDocumentation()` - Returns guidance with section info
- `validateSection(section, fields)` - Validates one section
- `validateFields(fields)` - Validates all fields
- `getProgress(fields)` - Returns completion status per section
- `generateSummary(fields, ctx, renderer?)` - Summary + progress (via renderer)
- `getDefaults()` - Returns default form state

**Best For:**

- Complex forms (20+ fields)
- Many conditional fields
- Field dependencies between sections
- Need progress tracking

---

## How a Form-Strategy is Selected

Each prompt class declares its form-strategy via a static property:

```javascript
// In prompt class
export class MyPrompt extends BasePrompt {
  static formStrategy = 'stateful' // 'stateless' | 'hybrid' | 'stateful'
  // ...
}
```

`'stateless'` is the default if `static formStrategy` is omitted.

The form-strategy is retrieved using:

```javascript
import { getFormStrategy } from '#src/mcp/prompts/form-strategies/index.js'

const strategyType = PromptClass.formStrategy || 'stateless'
const strategy = getFormStrategy(strategyType)
```

---

## Tool Integration

### MCP Tools and Form-Strategies

| MCP Tool            | Stateless     | Hybrid          | Stateful                   |
| ------------------- | ------------- | --------------- | -------------------------- |
| `get_prompt_guide`  | Returns docs  | Returns docs    | Returns docs with sections |
| `validate_form`     | Not supported | Validates all   | Validates all + progress   |
| `get_form_progress` | Not supported | Not supported   | Returns section progress   |
| `get_form_summary`  | Not supported | Returns summary | Returns summary + progress |

The three form-strategy tools live in `src/mcp/tools/form-strategies/` and all
inherit from `BaseFormStrategyTool`.

---

## Customizing the Summary

`get_form_summary` produces two halves: a human-facing markdown block and a
machine-facing technical payload. Both come from a `FormSummaryRenderer`
configured at registry construction time — no strategy subclassing required.

```javascript
import { FormSummaryRenderer, defaultFormSummaryRenderer } from '@mcp-rune/mcp-rune/prompts'
import { ToolRegistry } from '@mcp-rune/mcp-rune/tools'

class MyRenderer {
  renderHuman(promptClass, fields) {
    // Return any markdown layout — bullet list, table, localized text, etc.
    return `**Summary**: ${fields.title}`
  }

  renderTechnical(promptClass, fields, context) {
    // Return the API-bound payload shape your backend expects.
    return {
      model: context.model || 'unknown',
      parent_path: context.parent_path,
      attributes: fields
    }
  }
}

const registry = new ToolRegistry({
  // ...other options
  summaryRenderer: new MyRenderer()
})
```

The seam is end-to-end visible:

```
ToolRegistryConfig.summaryRenderer
        ↓ ToolDependencies.summaryRenderer
        ↓ BaseFormStrategyTool.summaryRenderer
        ↓ GetFormSummaryTool → strategy.generateSummary(..., renderer)
        ↓ renderer.renderHuman(...) / renderer.renderTechnical(...)
```

Default: `DefaultFormSummaryRenderer` (markdown human summary grouped by
`fieldGroups`; JSON-API-ish technical payload). Both halves are independently
overridable — you can extend `DefaultFormSummaryRenderer` and override just
the one you care about.

For stateful prompts, section progress is appended to the renderer's output
by the strategy itself — the renderer doesn't need to know about progress.

---

## Implementing a New Prompt

### Step 1: Choose the Right Form-Strategy

| Question                                                             | If Yes →  |
| -------------------------------------------------------------------- | --------- |
| Does it have < 10 fields?                                            | Stateless |
| Does it have 10-20 fields with some conditionals?                    | Hybrid    |
| Does it have 20+ fields, many conditionals, or complex dependencies? | Stateful  |

### Step 2: Create the Prompt Class

```javascript
import { BasePrompt } from './base-prompt.js'

export class MyPrompt extends BasePrompt {
  // REQUIRED: Declare form-strategy
  static formStrategy = 'hybrid' // Choose: 'stateless', 'hybrid', 'stateful'

  // REQUIRED for hybrid/stateful: Field definitions
  static fieldDefinitions = {
    name: {
      name: 'name',
      type: 'string',
      required: true,
      description: 'Name of the item'
    }
    // ... more fields
  }

  // REQUIRED for stateful: Field groups (sections)
  static fieldGroups = {
    identity: {
      fields: ['name', 'external_id'],
      context: 'Identity',
      required: true,
      description: 'Basic identification'
    }
    // ... more groups
  }

  // REQUIRED: Instance documentation getter
  get promptContent() {
    return `# My Prompt Guide\n...`
  }
}
```

### Step 3: Add Validation Instructions to Documentation (CRITICAL for Hybrid/Stateful)

> **WARNING**: The form-strategy system provides validation capabilities, but
> the LLM will NOT automatically call `validate_form` unless explicitly
> instructed in the prompt documentation.

For **Hybrid** and **Stateful** form-strategies, your prompt's `promptContent`
getter MUST include explicit instructions telling the LLM to call validation
tools:

```javascript
get promptContent() {
  return `
# My Model Creation Guide

## Section Validation (IMPORTANT)

After completing each section, you MUST call \`validate_form\` to validate before proceeding:
\`\`\`
validate_form(model: "my_model", section: "<section_name>", fields: { ...current_fields... })
\`\`\`

The response includes:
- \`valid\`: Whether the section is valid
- \`errors\`: Any validation errors to fix
- \`next_section\`: The recommended next section
- \`section_complete\`: Whether the section has all required fields

Before final submission, validate ALL fields:
\`\`\`
validate_form(model: "my_model", fields: { ...all_fields... })
\`\`\`
Check that \`ready_to_submit: true\` before calling \`create_model\`.

## SECTION 1: ...
...
`
}
```

**Checklist for Hybrid/Stateful Prompts:**

- [ ] Documentation includes "Section Validation" instructions
- [ ] Each workflow step mentions calling `validate_form` after collecting data
- [ ] Final step requires `validate_form` with `ready_to_submit: true` check
- [ ] Available section names are listed for reference

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP Server                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐                                                       │
│  │  Tool Handlers   │                                                       │
│  └────────┬─────────┘                                                       │
│           │                                                                  │
│           ▼                                                                  │
│  ┌──────────────────┐     ┌──────────────────┐                              │
│  │  Prompt Registry │────▶│   Prompt Class   │                              │
│  └──────────────────┘     └────────┬─────────┘                              │
│                                    │                                         │
│                                    │ static formStrategy = 'stateful'       │
│                                    ▼                                         │
│                           ┌──────────────────┐                              │
│                           │ Form-Strategy    │                              │
│                           │ Selector         │                              │
│                           │ (form-strategies/│                              │
│                           │  index.ts)       │                              │
│                           └────────┬─────────┘                              │
│                                    │                                         │
│           ┌────────────────────────┼────────────────────────┐               │
│           ▼                        ▼                        ▼               │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │    Stateless    │     │     Hybrid      │     │    Stateful     │       │
│  │  FormStrategy   │     │  FormStrategy   │     │  FormStrategy   │       │
│  ├─────────────────┤     ├─────────────────┤     ├─────────────────┤       │
│  │ getDocumentation│     │ getDocumentation│     │ getDocumentation│       │
│  │                 │     │ validateFields  │     │ validateFields  │       │
│  │                 │     │ generateSummary │─────│ validateSection │       │
│  │                 │     │       │         │     │ getProgress     │       │
│  │                 │     │       │         │     │ generateSummary │       │
│  │                 │     │       │         │     │ getDefaults     │       │
│  └─────────────────┘     └───────┼─────────┘     └────────┬────────┘       │
│                                  │                        │                 │
│                                  ▼                        │                 │
│                       ┌──────────────────────┐            │                 │
│                       │ FormSummaryRenderer  │◀───────────┘                 │
│                       │ (injected via        │  (stateful delegates         │
│                       │  ToolRegistry)       │   summary to hybrid,         │
│                       └──────────────────────┘   then appends progress)     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Files in This Directory

| File                               | Description                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `index.ts`                         | Form-strategy registry and `getFormStrategy()` function                                      |
| `form-strategy-definitions.ts`     | Shared type vocabulary (`FormValidationResult`, `SummaryResult`, `FormSummaryRenderer`, ...) |
| `base-form-strategy.ts`            | Abstract base class for all form-strategies                                                  |
| `stateless-form-strategy.ts`       | Simple documentation-only form-strategy                                                      |
| `hybrid-form-strategy.ts`          | Documentation + validation form-strategy                                                     |
| `stateful-form-strategy.ts`        | Section-aware validation with progress tracking                                              |
| `default-form-summary-renderer.ts` | Default `FormSummaryRenderer` — markdown + JSON-API-ish payload                              |
| `README.md`                        | This documentation                                                                           |

---

## Common Patterns

### Conditional Sections (Stateful)

```javascript
static fieldGroups = {
  optional_section: {
    fields: ['field1', 'field2'],
    context: 'Optional Configuration',
    conditional: { type: 'specific_type' },  // Only when type === 'specific_type'
    required: false
  }
}
```

### Default Values

```javascript
static fieldDefinitions = {
  status: {
    name: 'status',
    type: 'enum',
    enumValues: ['active', 'inactive', 'draft'],
    default: 'draft',  // Applied automatically by the form-strategy
    required: true
  }
}
```

### Custom Summary Renderer

```javascript
import { defaultFormSummaryRenderer } from '@mcp-rune/mcp-rune/prompts'

// Reuse the default for the technical half, override only the human half.
const renderer = {
  renderHuman(promptClass, fields) {
    return `Localized summary for ${fields.title}…`
  },
  renderTechnical(promptClass, fields, context) {
    return defaultFormSummaryRenderer.renderTechnical(promptClass, fields, context)
  }
}

new ToolRegistry({ /* ... */, summaryRenderer: renderer })
```

---

## Logging

All form-strategies emit structured debug-level logs for the operations that
matter during incident response: `validateFields`, `validateSection`,
`getProgress`. Trivial passthroughs (`getDocumentation`, `getDefaults`,
`getNextSection`) intentionally don't emit traces — the parent operation's
completion log already carries the relevant signals.

### Enabling Debug Logs

Set the `LOG_LEVEL` environment variable to `debug`:

```bash
LOG_LEVEL=debug
```

### Log Format

All form-strategy logs include:

- `service: 'form-strategy'` — Identifies logs from the form-strategy module
- `formStrategy: 'stateless|hybrid|stateful'` — Which form-strategy generated the log

Errors thrown from user-supplied callbacks (e.g. `crossSectionValidation`,
`fieldGroups[…].validateSection`) are always logged at `error` level — those
are signals, not traces.
