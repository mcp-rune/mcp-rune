# Strategy Pattern for Form Handling

This module implements a **Strategy Pattern** for handling form data collection across different prompt complexities. Each strategy defines how the LLM interacts with the server during form creation.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STRATEGY SELECTION                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Prompt Class                                                                │
│       │                                                                      │
│       ▼                                                                      │
│  static strategy = 'stateless' | 'hybrid' | 'stateful'                      │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │  Stateless  │    │   Hybrid    │    │  Stateful   │                      │
│  │  Strategy   │    │  Strategy   │    │  Strategy   │                      │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Strategy Comparison

| Aspect                | Stateless               | Hybrid                                | Stateful                                          |
| --------------------- | ----------------------- | ------------------------------------- | ------------------------------------------------- |
| **Complexity**        | Simple (< 10 fields)    | Medium (10-20 fields)                 | Complex (20+ fields)                              |
| **Validation**        | None (errors at submit) | All fields at once                    | Section-by-section                                |
| **Progress Tracking** | No                      | No                                    | Yes                                               |
| **Conditionals**      | LLM handles             | Basic                                 | Full support                                      |
| **Operations**        | `getDocumentation`      | `+ validateFields`, `generateSummary` | `+ validateSection`, `getProgress`, `getDefaults` |

## Strategy Details

### 1. Stateless Strategy (`stateless-strategy.js`)

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

### 2. Hybrid Strategy (`hybrid-strategy.js`)

**Purpose:** Documentation + validation before submission.

**Flow:**

```
get_prompt_guide → LLM guides → validate_form → create_model
```

**Supported Operations:**

- `getDocumentation()` - Returns guidance
- `validateFields(fields)` - Validates all fields at once
- `generateSummary(fields)` - Server-generated summary

**Best For:**

- Medium complexity forms (10-20 fields)
- Some conditional fields
- Want validation without full state management

---

### 3. Stateful Strategy (`stateful-strategy.js`)

**Purpose:** Full progressive validation with sections.

**Flow:**

```
get_prompt_guide → [validate_section]* → validate_form → get_form_progress → create_model
```

**Supported Operations:**

- `getDocumentation()` - Returns guidance with section info
- `validateSection(section, fields)` - Validates one section
- `validateFields(fields)` - Validates all fields
- `getProgress(fields)` - Returns completion status per section
- `generateSummary(fields)` - Server-generated summary
- `getDefaults()` - Returns default form state

**Best For:**

- Complex forms (20+ fields)
- Many conditional fields
- Field dependencies between sections
- Need progress tracking

---

## How Strategy is Selected

Each prompt class declares its strategy via a static property:

```javascript
// In prompt class
export class MyPrompt extends BasePrompt {
  static strategy = 'stateful' // 'stateless' | 'hybrid' | 'stateful'
  // ...
}
```

The strategy is retrieved using:

```javascript
import { getStrategy } from '#src/mcp/prompts/strategies/index.js'

const strategyType = PromptClass.strategy || 'stateless'
const strategy = getStrategy(strategyType)
```

---

## Tool Integration

### MCP Tools and Strategies

| MCP Tool            | Stateless     | Hybrid          | Stateful                   |
| ------------------- | ------------- | --------------- | -------------------------- |
| `get_prompt_guide`  | Returns docs  | Returns docs    | Returns docs with sections |
| `validate_form`     | Not supported | Validates all   | Validates all + progress   |
| `get_form_progress` | Not supported | Not supported   | Returns section progress   |
| `get_form_summary`  | Not supported | Returns summary | Returns summary + progress |

---

## Implementing a New Prompt

### Step 1: Choose the Right Strategy

| Question                                                             | If Yes →  |
| -------------------------------------------------------------------- | --------- |
| Does it have < 10 fields?                                            | Stateless |
| Does it have 10-20 fields with some conditionals?                    | Hybrid    |
| Does it have 20+ fields, many conditionals, or complex dependencies? | Stateful  |

### Step 2: Create the Prompt Class

```javascript
import { BasePrompt } from './base_prompt.js'

export class MyPrompt extends BasePrompt {
  // REQUIRED: Declare strategy
  static strategy = 'hybrid' // Choose: 'stateless', 'hybrid', 'stateful'

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

> **WARNING**: The strategy system provides validation capabilities, but the LLM will NOT
> automatically call `validate_form` unless explicitly instructed in the prompt documentation.

For **Hybrid** and **Stateful** strategies, your prompt's `promptContent` getter MUST include
explicit instructions telling the LLM to call validation tools:

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
│                                    │ static strategy = 'stateful'           │
│                                    ▼                                         │
│                           ┌──────────────────┐                              │
│                           │ Strategy Selector│                              │
│                           │ (strategies/     │                              │
│                           │  index.js)       │                              │
│                           └────────┬─────────┘                              │
│                                    │                                         │
│           ┌────────────────────────┼────────────────────────┐               │
│           ▼                        ▼                        ▼               │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │    Stateless    │     │     Hybrid      │     │    Stateful     │       │
│  │    Strategy     │     │    Strategy     │     │    Strategy     │       │
│  ├─────────────────┤     ├─────────────────┤     ├─────────────────┤       │
│  │ getDocumentation│     │ getDocumentation│     │ getDocumentation│       │
│  │                 │     │ validateFields  │     │ validateFields  │       │
│  │                 │     │ generateSummary │     │ validateSection │       │
│  │                 │     │                 │     │ getProgress     │       │
│  │                 │     │                 │     │ generateSummary │       │
│  │                 │     │                 │     │ getDefaults     │       │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Files in This Directory

| File                    | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `index.js`              | Strategy registry and `getStrategy()` function |
| `base-strategy.js`      | Abstract base class for all strategies         |
| `stateless-strategy.js` | Simple documentation-only strategy             |
| `hybrid-strategy.js`    | Documentation + validation strategy            |
| `stateful-strategy.js`  | Full progressive validation with sections      |
| `README.md`             | This documentation                             |

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
    default: 'draft',  // Applied automatically by strategy
    required: true
  }
}
```

---

## Logging

All strategies include debug-level logging for troubleshooting and auditing.

### Enabling Debug Logs

Set the `LOG_LEVEL` environment variable to `debug`:

```bash
LOG_LEVEL=debug
```

### Log Format

All strategy logs include:

- `service: 'strategy'` - Identifies logs from the strategy module
- `strategy: 'stateless|hybrid|stateful'` - Which strategy generated the log
