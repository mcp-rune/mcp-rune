# Domain Intelligence Framework — Contributor Guide

This guide explains how to extend the domain intelligence layer with new concepts, business rules, workflows, and diagram templates. The framework is declarative: all domain components are data structures, not procedural code.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [When to Use Each Component](#when-to-use-each-component)
3. [DomainConcept — Cross-Entity Knowledge](#domainconcept--cross-entity-knowledge)
4. [BusinessRule — Declarative Constraints](#businessrule--declarative-constraints)
5. [WorkflowDefinition — Multi-Step Guides](#workflowdefinition--multi-step-guides)
6. [DiagramTemplate — Visual Explanations](#diagramtemplate--visual-explanations)
7. [Wiring It Up — The Domain Registry](#wiring-it-up--the-domain-registry)
8. [How Domain Tools Consume the Registry](#how-domain-tools-consume-the-registry)
9. [Step-by-Step: Adding Domain Intelligence to a New Server](#step-by-step-adding-domain-intelligence-to-a-new-server)
10. [Testing](#testing)

---

## Architecture Overview

```
lib/mcp/domain/                      # Framework classes (shared)
├── knowledge.js                     # DomainConcept + DomainKnowledge
├── business-rules.js                # BusinessRule + RuleSet
├── workflows.js                     # WorkflowStep + WorkflowDefinition + WorkflowRegistry
├── diagrams.js                      # DiagramTemplate + DiagramTemplateRegistry
└── registry.js                      # DomainRegistry (aggregates all of the above)

lib/mcp/tools/domain/                # Domain tools (shared)
├── base-domain-tool.js              # BaseDomainTool (DOMAIN category, no auth)
├── get-domain-context-tool.js       # Retrieves composed context for a model/concept
├── check-business-rules-tool.js     # Validates data against business rules
├── suggest-workflow-tool.js         # Finds and displays workflows
└── generate-diagram-tool.js         # Renders diagram templates

src/<server>/domain/                 # Server-specific domain data
├── registry.js                      # Factory: createXxxDomainRegistry()
├── knowledge/
│   └── concepts.js                  # DomainConcept instances
├── rules/
│   ├── <domain>-rules.js            # BusinessRule instances
│   └── mutability-rules.js          # Auto-generated from model metadata
├── workflows/
│   └── <workflow-category>.js       # WorkflowDefinition instances
└── diagrams/
    ├── <diagram-category>.js        # DiagramTemplate instances
    └── index.js                     # Aggregates all templates
```

**Data flow:**

1. Server-specific code creates `DomainConcept`, `BusinessRule`, `WorkflowDefinition`, and `DiagramTemplate` instances
2. These are assembled into a `DomainRegistry` via a factory function
3. The registry is dependency-injected into the tool registry
4. Four domain tools (`get_domain_context`, `check_business_rules`, `suggest_workflow`, `generate_diagram`) consume the registry and expose it to users

---

## When to Use Each Component

| I want to...                                    | Use                    |
| ----------------------------------------------- | ---------------------- |
| Explain how entities relate to each other       | **DomainConcept**      |
| Document inheritance, terminology, or processes | **DomainConcept**      |
| Validate constraints between entities           | **BusinessRule**       |
| Catch field-level errors before API calls       | **BusinessRule**       |
| Guide users through a multi-step process        | **WorkflowDefinition** |
| Create a demo or troubleshooting script         | **WorkflowDefinition** |
| Visualize relationships or decisions            | **DiagramTemplate**    |

**Key distinction: Concept vs Rule vs Workflow**

- **Concept** = knowledge about what exists and how things relate ("deals contain rights, which inherit restrictions")
- **Rule** = a testable constraint that can pass or fail ("catch-up rights must have transmission_type")
- **Workflow** = an ordered sequence of steps to accomplish a goal ("set up catch-up VOD in 5 steps")

If you find yourself writing a concept with an `evaluate` function, make it a rule. If you find yourself writing a rule with 10 steps, make it a workflow.

---

## DomainConcept — Cross-Entity Knowledge

**Source:** `lib/mcp/domain/knowledge.js`

A `DomainConcept` captures knowledge that spans multiple models and cannot be expressed in any single model's `static attributes`. Field-level knowledge (enum descriptions, conditionals, examples) belongs in models — concepts add cross-entity relationships on top.

### Constructor

```javascript
import { DomainConcept } from '#lib/mcp/domain/knowledge.js'

new DomainConcept({
  name: 'deal_rights_hierarchy',              // Unique identifier (snake_case)
  title: 'Deal → Rights → Platforms',          // Human-readable title
  description: 'Deals contain rights...',      // 1-2 sentence explanation
  models: ['deal', 'right', 'specific_platform'],  // Models this concept spans
  tags: ['hierarchy', 'licensing'],            // For filtering and search
  details: { ... }                             // Structured additional context
})
```

### The `details` Object

The `details` object is **freeform by design** — the `get_domain_context` tool renders it as structured content to the LLM, so any keys work. However, the formatting layer recognizes certain conventional keys and renders them specially:

| Key           | Type                   | Rendering                                     | Purpose                                      |
| ------------- | ---------------------- | --------------------------------------------- | -------------------------------------------- |
| `inheritance` | `{ from, to, fields }` | `**Inheritance:** deal → right (fields: ...)` | Describes field inheritance between entities |
| `process`     | `string`               | `**Process:** Create deal → add rights → ...` | Step-by-step procedure                       |
| `tips`        | `string[]`             | Bulleted list under `**Tips:**`               | Actionable guidance                          |

**Other keys** are passed through as-is in the JSON context. Common conventions:

| Key                | Type                                      | Purpose                                 |
| ------------------ | ----------------------------------------- | --------------------------------------- |
| `statuses`         | `{ status: description }`                 | Maps status enum values to meanings     |
| `conflicts`        | `{ type: description }`                   | Maps conflict types to descriptions     |
| `restrictions`     | `{ type: description }`                   | Describes restriction types             |
| `windows`          | `{ term: definition }`                    | Terminology definitions                 |
| `contentTypes`     | `{ type: behavior }`                      | Maps content types to their behavior    |
| `categoryExamples` | `{ category: examples }`                  | Example values for categorization       |
| `example`          | `{ scenario, problem, result, solution }` | Concrete scenario with problem/solution |
| `keyInsight`       | `string`                                  | Critical insight about the concept      |

You can invent new keys freely — just be descriptive. The formatting layer will include them in the rendered context as structured JSON.

### Examples

**Hierarchy concept with conventional keys:**

```javascript
new DomainConcept({
  name: 'deal_rights_hierarchy',
  title: 'Deal → Rights → Platforms',
  description:
    'Deals contain rights, which in turn have platform assignments. Rights inherit certain fields from their parent deal.',
  models: ['deal', 'right', 'specific_platform'],
  tags: ['hierarchy', 'licensing', 'inheritance'],
  details: {
    inheritance: {
      from: 'deal',
      to: 'right',
      fields: ['restrictions', 'transmission config', 'offset timing']
    },
    process: 'Create deal first → add rights under the deal → assign specific_platforms per right',
    tips: [
      'Create the deal before creating rights — rights are nested under deals',
      'Platform assignment is per-right, not per-deal (use specific_platforms)'
    ]
  }
})
```

**Status enum concept:**

```javascript
new DomainConcept({
  name: 'rights_validation_status',
  title: 'Rights Status Calculation',
  description: 'When a schedule entry is created, its rights status is calculated automatically.',
  models: ['right', 'scheduling', 'platform'],
  tags: ['rights', 'validation', 'status'],
  details: {
    statuses: {
      cleared: 'Rights are satisfied — the schedule entry is valid',
      in_conflict: 'One or more rights exist but a restriction has been breached',
      no_rights: 'No single right satisfies ALL platform requirements',
      denied: 'Rights have been explicitly denied'
    },
    process: 'Schedule entry created → background job calculates rights status → status displayed',
    tips: ['Rights status is calculated automatically — never set it manually']
  }
})
```

**Dynamic concept from model metadata:**

```javascript
export function createMutabilityConcept(modelClasses) {
  const readOnlyModels = Object.entries(modelClasses)
    .filter(([, M]) => M.readOnly)
    .map(([name]) => name)

  return new DomainConcept({
    name: 'model_mutability',
    title: 'Model Mutability: Read-Only Models and Immutable Fields',
    description: 'Some models are read-only lookups...',
    models: readOnlyModels,
    tags: ['infrastructure', 'read-only', 'mutability'],
    details: {
      readOnlyModels: { models: readOnlyModels },
      tips: ['Do not attempt to create or update read-only models']
    }
  })
}
```

### Where to Put Concepts

Add concepts to `src/<server>/domain/knowledge/concepts.js`. Organize them by logical groups with section comments:

```javascript
export const concepts = [
  // ============================================================================
  // HIERARCHY & STRUCTURE CONCEPTS
  // ============================================================================
  new DomainConcept({ name: 'deal_rights_hierarchy', ... }),
  new DomainConcept({ name: 'two_step_platform_assignment', ... }),

  // ============================================================================
  // RIGHTS VALIDATION CONCEPTS
  // ============================================================================
  new DomainConcept({ name: 'rights_validation_status', ... }),

  // ============================================================================
  // TERMINOLOGY & WINDOWS CONCEPTS
  // ============================================================================
  new DomainConcept({ name: 'window_terminology', ... }),
]
```

---

## BusinessRule — Declarative Constraints

**Source:** `lib/mcp/domain/business-rules.js`

A `BusinessRule` validates constraints between entities that individual model validation cannot express. Each rule is a data structure with an evaluate function — testable, auditable, introspectable.

### Constructor

```javascript
import { BusinessRule } from '#lib/mcp/domain/business-rules.js'

new BusinessRule({
  name: 'catchup_requires_transmission_config', // Unique identifier (snake_case)
  description: 'Catch-up rights must specify transmission_type and reference_tx_nth',
  scope: ['right'], // Models this rule applies to
  severity: 'error', // 'error' | 'warning' | 'info'
  tags: ['catch-up', 'required-fields'], // For filtering
  evaluate(data, context = {}) {
    // Validation function
    // ...
  }
})
```

### The `evaluate` Function

The evaluate function receives two arguments and must return a result object:

**Input:**

| Parameter | Description                                                                                  |
| --------- | -------------------------------------------------------------------------------------------- |
| `data`    | The entity data being validated (e.g., `{ right_type: 'catchup', transmission_type: null }`) |
| `context` | Additional context — related entities, parent data, content type, etc.                       |

**Output:**

```javascript
{
  passed: true|false,        // Whether the rule passed
  message: 'Human-readable explanation',
  details: { ... },          // Optional: structured detail data
  suggestion: 'How to fix'   // Optional: actionable fix suggestion
}
```

### Severity Levels

| Severity  | Meaning                      | Effect on `checkRules` overall result |
| --------- | ---------------------------- | ------------------------------------- |
| `error`   | Must fix before proceeding   | Fails the overall check               |
| `warning` | Should fix, but not blocking | Does NOT fail the overall check       |
| `info`    | Informational observation    | Does NOT fail the overall check       |

### Writing Good Rules

**1. Early exit for non-applicable rules:**

```javascript
evaluate(data) {
  if (data.right_type !== 'catchup') {
    return { passed: true, message: 'Not a catch-up right, rule not applicable' }
  }
  // ... actual validation
}
```

**2. Use context for cross-entity validation:**

```javascript
evaluate(data, context = {}) {
  if (!context.rights || context.rights.length === 0) {
    return { passed: true, message: 'No rights in context to validate against' }
  }
  // ... validate deal dates encompass rights dates
}
```

**3. Provide actionable suggestions:**

```javascript
return {
  passed: false,
  message: `Catch-up rights require: ${missing.join(', ')}`,
  suggestion:
    'Set transmission_type (play_run/costed_run/rerun) and reference_tx_nth (e.g., "all", "1")'
}
```

**4. A rule can apply to multiple models:**

```javascript
new BusinessRule({
  name: 'end_date_after_start_date',
  scope: ['right', 'deal'] // Applies to both
  // ...
})
```

### Examples

**Field requirement rule:**

```javascript
new BusinessRule({
  name: 'catchup_requires_transmission_config',
  description: 'Catch-up rights must specify transmission_type and reference_tx_nth',
  scope: ['right'],
  severity: 'error',
  tags: ['catch-up', 'required-fields'],
  evaluate(data) {
    if (data.right_type !== 'catchup') {
      return { passed: true, message: 'Not a catch-up right, rule not applicable' }
    }
    const missing = []
    if (!data.transmission_type) missing.push('transmission_type')
    if (!data.reference_tx_nth) missing.push('reference_tx_nth')

    if (missing.length > 0) {
      return {
        passed: false,
        message: `Catch-up rights require: ${missing.join(', ')}`,
        suggestion:
          'Set transmission_type (play_run/costed_run/rerun) and reference_tx_nth (e.g., "all", "1", "1-3")'
      }
    }
    return { passed: true, message: 'Catch-up transmission config is set' }
  }
})
```

**Cross-entity validation rule (uses context):**

```javascript
new BusinessRule({
  name: 'deal_dates_encompass_rights',
  description: 'Deal date range should encompass its rights date ranges',
  scope: ['deal'],
  severity: 'warning',
  tags: ['dates', 'cross-entity'],
  evaluate(data, context = {}) {
    if (!data.starts && !data.ends) {
      return { passed: true, message: 'Deal has no date constraints' }
    }
    if (!context.rights || context.rights.length === 0) {
      return { passed: true, message: 'No rights in context to validate against' }
    }

    const dealStart = data.starts ? new Date(data.starts) : null
    const issues = []

    for (const right of context.rights) {
      if (dealStart && right.starts && new Date(right.starts) < dealStart) {
        issues.push(`Right starts before deal`)
      }
    }

    if (issues.length > 0) {
      return {
        passed: false,
        message: issues.join('; '),
        suggestion: 'Extend deal dates to encompass all rights'
      }
    }
    return { passed: true, message: 'Deal dates encompass all rights' }
  }
})
```

### Where to Put Rules

Add rules to `src/<server>/domain/rules/<domain>-rules.js`. Each file exports an array:

```javascript
// src/<server>/domain/rules/rights-rules.js
import { BusinessRule } from '#lib/mcp/domain/business-rules.js'

export const rightsRules = [
  new BusinessRule({ ... }),
  new BusinessRule({ ... }),
]
```

Group related rules in the same file. Create new files for distinct domains (e.g., `deal-rules.js`, `scheduling-rules.js`).

---

## WorkflowDefinition — Multi-Step Guides

**Source:** `lib/mcp/domain/workflows.js`

A `WorkflowDefinition` is a structured multi-step process guide. It can include tool calls, decision points, and tips. Two common patterns:

- **Onboarding/Setup** — How-to guides for accomplishing a task
- **Demo** — Choreographed presentations with audience-friendly narration (tagged `demo`)

### Constructor

```javascript
import { WorkflowDefinition } from '#lib/mcp/domain/workflows.js'

new WorkflowDefinition({
  name: 'catchup_vod_setup',                    // Unique identifier (snake_case)
  title: 'Set Up Catch-Up VOD',                 // Human-readable title
  description: 'Creates a rule that generates schedulings when linear transmissions occur.',
  tags: ['catch-up', 'vod', 'onboarding'],      // For filtering
  models: ['title', 'rule', 'specific_platform'], // Models involved
  steps: [
    { order: 1, title: '...', description: '...', ... },
    { order: 2, title: '...', description: '...', ... },
  ]
})
```

### WorkflowStep

Each step is a plain object (auto-wrapped in `WorkflowStep`):

```javascript
{
  order: 1,                           // Step number (1-based)
  title: 'Find the title',            // Step title
  description: 'Search for the title you want to configure.',
  tool: 'find_model',                 // Optional: MCP tool to call
  toolArgs: {                         // Optional: example arguments
    model: 'title',
    search: { name: '<title_name>' }
  },
  decision: {                          // Optional: branching point
    question: 'All platforms or specific ones?',
    options: [
      { label: 'All platforms', description: 'Skip — rule applies everywhere' },
      { label: 'Specific platforms', description: 'Add specific_platform records', nextStep: 6 }
    ]
  },
  tips: [                              // Optional: guidance for this step
    'You need the title ID for the next step',
    'If the title does not exist, create it first'
  ]
}
```

**Notes:**

- `tool` references an MCP tool name. `toolArgs` are **example** arguments shown to users, not auto-executed.
- `decision.options[].nextStep` creates branching — users can jump to a different step.
- Steps without a `tool` are narrative/explanation steps (common in demo workflows).

### Examples

**Onboarding workflow:**

```javascript
new WorkflowDefinition({
  name: 'catchup_vod_setup',
  title: 'Set Up Catch-Up VOD',
  description: 'Set up catch-up VOD availability for a title.',
  tags: ['catch-up', 'vod', 'onboarding'],
  models: ['title', 'rule', 'specific_platform', 'scheduling'],
  steps: [
    {
      order: 1,
      title: 'Find the title',
      description: 'Search for the title to set up catch-up VOD for.',
      tool: 'find_model',
      toolArgs: { model: 'title', search: { name: '<title_name>' } },
      tips: ['You need the title ID for the next step']
    },
    {
      order: 2,
      title: 'Get the rule creation guide',
      description: 'Load the guided creation form for VOD rules.',
      tool: 'get_prompt_guide',
      toolArgs: { guide_name: 'create_rule' },
      tips: ['Use mode: "quick" if you already know the field values']
    }
    // ... more steps
  ]
})
```

**Demo workflow:**

```javascript
new WorkflowDefinition({
  name: 'catchup_vod_demo',
  title: 'Demo: Catch-Up VOD Rules',
  description: 'Choreographed demo with audience-friendly explanations.',
  tags: ['catch-up', 'vod', 'demo'],
  models: ['title', 'rule', 'specific_platform'],
  steps: [
    {
      order: 1,
      title: 'Set the scene',
      description:
        'Explain catch-up VOD: "Catch-up lets viewers watch on-demand after broadcast..."',
      tips: ['Key value prop: rules automate scheduling — no manual work per transmission']
      // No tool — narrative step
    },
    {
      order: 2,
      title: 'Find a demo title',
      description: 'Search for a recognizable title.',
      tool: 'find_model',
      toolArgs: { model: 'title', search: { name: 'Breaking Bad' } },
      tips: ['Choose a title the audience will recognize']
    }
    // ... more steps
  ]
})
```

### Where to Put Workflows

Add workflows to `src/<server>/domain/workflows/<category>.js`. Each file exports an array:

```javascript
// src/<server>/domain/workflows/catchup-vod.js
import { WorkflowDefinition } from '#lib/mcp/domain/workflows.js'

export const catchupWorkflows = [
  new WorkflowDefinition({ ... }),  // Setup
  new WorkflowDefinition({ ... }),  // Demo
]
```

Group related workflows in the same file (e.g., setup + demo variant of the same process).

---

## DiagramTemplate — Visual Explanations

**Source:** `lib/mcp/domain/diagrams.js`

A `DiagramTemplate` is a pre-built Mermaid diagram for visual domain explanations. Templates can be static or parameterized.

### Constructor

```javascript
import { DiagramTemplate } from '#lib/mcp/domain/diagrams.js'

new DiagramTemplate({
  name: 'deal_structure', // Unique identifier (snake_case)
  title: 'Deal → Rights → Platforms', // Human-readable title
  description: 'Shows the licensing hierarchy.',
  type: 'graph', // Mermaid type hint
  tags: ['licensing', 'hierarchy'], // For filtering
  params: [], // Parameter definitions (if parameterized)
  render(params = {}) {
    // Returns Mermaid syntax
    return `graph TD
  Deal["Deal"] --> Right["Right"]
  Right --> Platform["Platform"]`
  }
})
```

### Mermaid Diagram Types

| Type              | Use Case                      |
| ----------------- | ----------------------------- |
| `graph`           | Hierarchical/network diagrams |
| `flowchart`       | Decision flowcharts           |
| `gantt`           | Timeline/scheduling charts    |
| `sequenceDiagram` | Interaction sequences         |
| `erDiagram`       | Entity-relationship diagrams  |

### Parameterized Templates

```javascript
new DiagramTemplate({
  name: 'availability_window',
  title: 'Availability Window',
  type: 'graph',
  params: [
    { name: 'start_offset', type: 'string', description: 'Start offset', default: '0 minutes' },
    { name: 'end_offset', type: 'string', description: 'End offset', default: '7 days' }
  ],
  render({ start_offset = '0 minutes', end_offset = '7 days' } = {}) {
    return `graph LR
  TX["Linear TX"] -->|"${start_offset}"| Start["VOD Start"]
  Start -->|"${end_offset}"| End["VOD End"]`
  }
})
```

### Where to Put Diagrams

Add diagrams to `src/<server>/domain/diagrams/<category>.js`. Each file exports an array. Create an `index.js` that aggregates all templates:

```javascript
// src/<server>/domain/diagrams/index.js
import { dealStructureTemplates } from './deal-structure.js'
import { availabilityWindowTemplates } from './availability.js'

export const diagramTemplates = [...dealStructureTemplates, ...availabilityWindowTemplates]
```

---

## Wiring It Up — The Domain Registry

**Source:** `lib/mcp/domain/registry.js`

The `DomainRegistry` aggregates all domain intelligence into a single injectable dependency.

### Creating the Registry

```javascript
// src/<server>/domain/registry.js
import { DomainKnowledge } from '#lib/mcp/domain/knowledge.js'
import { RuleSet } from '#lib/mcp/domain/business-rules.js'
import { WorkflowRegistry } from '#lib/mcp/domain/workflows.js'
import { DiagramTemplateRegistry } from '#lib/mcp/domain/diagrams.js'
import { DomainRegistry } from '#lib/mcp/domain/registry.js'
import { MODEL_CLASSES } from '../models/index.js'

import { concepts } from './knowledge/concepts.js'
import { rightsRules } from './rules/rights-rules.js'
import { dealRules } from './rules/deal-rules.js'
import { catchupWorkflows } from './workflows/catchup-vod.js'
import { diagramTemplates } from './diagrams/index.js'

export function createMyDomainRegistry() {
  const knowledge = new DomainKnowledge({
    concepts: [...concepts],
    models: MODEL_CLASSES // Pass model classes for field metadata
  })

  const rules = new RuleSet([...rightsRules, ...dealRules])

  const workflows = new WorkflowRegistry([...catchupWorkflows])

  const diagrams = new DiagramTemplateRegistry(diagramTemplates)

  return new DomainRegistry({ knowledge, rules, workflows, diagrams })
}
```

### Injecting into the Tool Registry

Pass the domain registry when creating the tool registry. The tool registry injects it into every domain tool instance:

```javascript
// src/<server>/config.js
const domainRegistry = createMyDomainRegistry()

const toolRegistry = createToolRegistry({
  logger,
  models: MODEL_CLASSES,
  promptRegistry,
  serverContext,
  domainRegistry // <-- injected here
})
```

### Graceful Absence

If `domainRegistry` is `undefined` (not configured for this server), the four domain tools are simply filtered out of the tool list. No errors — other tools work normally. This allows the framework to be optional per server.

---

## How Domain Tools Consume the Registry

Four tools expose domain intelligence to users. All extend `BaseDomainTool` (category `DOMAIN`, no auth required).

### `get_domain_context`

Retrieves composed context for a model or concept.

| Input                                     | Behavior                                                            |
| ----------------------------------------- | ------------------------------------------------------------------- |
| No args                                   | Lists all concepts and workflows (overview)                         |
| `{ model: 'right' }`                      | Returns field metadata + concepts + rules + workflows for the model |
| `{ concept: 'deal_rights_hierarchy' }`    | Returns full concept details                                        |
| `{ model: 'right', concept: 'catch-up' }` | Returns both model context and concept search results               |

**Formatting of `details` conventional keys:**

- `details.inheritance` → rendered as `**Inheritance:** from → to (fields: ...)`
- `details.process` → rendered as `**Process:** ...`
- `details.tips` → rendered as bulleted list under `**Tips:**`
- All other keys → included as structured JSON in the context

### `check_business_rules`

Validates entity data against applicable business rules.

| Input                                                        | Behavior                              |
| ------------------------------------------------------------ | ------------------------------------- |
| `{ model: 'right', data: { right_type: 'catchup' } }`        | Evaluates all rules scoped to `right` |
| `{ model: 'deal', data: {...}, context: { rights: [...] } }` | Evaluates with cross-entity context   |

Output is grouped by severity: Errors (must fix) → Warnings (should fix) → Info → Passed.

### `suggest_workflow`

Finds and displays workflows.

| Input                               | Behavior                            |
| ----------------------------------- | ----------------------------------- |
| No args                             | Lists all workflows                 |
| `{ goal: 'catch-up' }`              | Searches by title/description/tags  |
| `{ workflow: 'catchup_vod_setup' }` | Returns full workflow by exact name |
| `{ tag: 'demo' }`                   | Filters by tag                      |

### `generate_diagram`

Renders diagram templates.

| Input                                                                   | Behavior                              |
| ----------------------------------------------------------------------- | ------------------------------------- |
| No args                                                                 | Lists all available templates         |
| `{ template: 'deal_structure' }`                                        | Renders pre-built template            |
| `{ template: 'availability_window', params: { end_offset: '3 days' } }` | Renders with custom parameters        |
| `{ mermaid: 'graph TD\n  A --> B' }`                                    | Renders raw Mermaid syntax (freeform) |

---

## Step-by-Step: Adding Domain Intelligence to a New Server

If your server doesn't have domain intelligence yet, follow these steps:

### 1. Create the domain directory structure

```
src/<server>/domain/
├── registry.js
├── knowledge/
│   └── concepts.js
├── rules/
│   └── <domain>-rules.js
├── workflows/
│   └── <category>.js
└── diagrams/
    ├── <category>.js
    └── index.js
```

### 2. Define concepts

```javascript
// src/<server>/domain/knowledge/concepts.js
import { DomainConcept } from '#lib/mcp/domain/knowledge.js'

export const concepts = [
  new DomainConcept({
    name: 'your_concept_name',
    title: 'Human-Readable Title',
    description: 'What this concept explains.',
    models: ['model_a', 'model_b'],
    tags: ['relevant', 'tags'],
    details: {
      process: 'Step 1 → Step 2 → Step 3',
      tips: ['Helpful tip 1', 'Helpful tip 2']
    }
  })
]
```

### 3. Define business rules

```javascript
// src/<server>/domain/rules/<domain>-rules.js
import { BusinessRule } from '#lib/mcp/domain/business-rules.js'

export const myRules = [
  new BusinessRule({
    name: 'my_validation_rule',
    description: 'What this rule checks',
    scope: ['model_a'],
    severity: 'error',
    tags: ['validation'],
    evaluate(data) {
      if (!data.required_field) {
        return {
          passed: false,
          message: 'required_field is missing',
          suggestion: 'Set required_field to a valid value'
        }
      }
      return { passed: true, message: 'required_field is present' }
    }
  })
]
```

### 4. Define workflows

```javascript
// src/<server>/domain/workflows/<category>.js
import { WorkflowDefinition } from '#lib/mcp/domain/workflows.js'

export const myWorkflows = [
  new WorkflowDefinition({
    name: 'my_setup_workflow',
    title: 'Set Up Feature X',
    description: 'Guides users through setting up Feature X.',
    tags: ['onboarding'],
    models: ['model_a', 'model_b'],
    steps: [
      {
        order: 1,
        title: 'Find the parent entity',
        description: 'Search for the entity to configure.',
        tool: 'find_model',
        toolArgs: { model: 'model_a', search: { name: '<name>' } },
        tips: ['You need the entity ID for the next step']
      },
      {
        order: 2,
        title: 'Create the child entity',
        description: 'Create a child entity linked to the parent.',
        tool: 'create_model',
        toolArgs: { model: 'model_b', attributes: { parent_id: '<from step 1>' } },
        tips: ['Check business rules first with check_business_rules']
      }
    ]
  })
]
```

### 5. Define diagrams (optional)

```javascript
// src/<server>/domain/diagrams/<category>.js
import { DiagramTemplate } from '#lib/mcp/domain/diagrams.js'

export const myDiagrams = [
  new DiagramTemplate({
    name: 'my_hierarchy',
    title: 'Entity Hierarchy',
    description: 'Shows how entities relate.',
    type: 'graph',
    tags: ['hierarchy'],
    params: [],
    render() {
      return `graph TD
  A["Parent"] --> B["Child 1"]
  A --> C["Child 2"]`
    }
  })
]

// src/<server>/domain/diagrams/index.js
import { myDiagrams } from './my-category.js'
export const diagramTemplates = [...myDiagrams]
```

### 6. Assemble the registry

```javascript
// src/<server>/domain/registry.js
import { DomainKnowledge } from '#lib/mcp/domain/knowledge.js'
import { RuleSet } from '#lib/mcp/domain/business-rules.js'
import { WorkflowRegistry } from '#lib/mcp/domain/workflows.js'
import { DiagramTemplateRegistry } from '#lib/mcp/domain/diagrams.js'
import { DomainRegistry } from '#lib/mcp/domain/registry.js'
import { MODEL_CLASSES } from '../models/index.js'

import { concepts } from './knowledge/concepts.js'
import { myRules } from './rules/my-rules.js'
import { myWorkflows } from './workflows/my-category.js'
import { diagramTemplates } from './diagrams/index.js'

export function createMyDomainRegistry() {
  const knowledge = new DomainKnowledge({ concepts, models: MODEL_CLASSES })
  const rules = new RuleSet([...myRules])
  const workflows = new WorkflowRegistry([...myWorkflows])
  const diagrams = new DiagramTemplateRegistry(diagramTemplates)
  return new DomainRegistry({ knowledge, rules, workflows, diagrams })
}
```

### 7. Inject into the server config

```javascript
// src/<server>/config.js
import { createMyDomainRegistry } from './domain/registry.js'

const domainRegistry = createMyDomainRegistry()

const toolRegistry = createToolRegistry({
  // ... other dependencies
  domainRegistry
})
```

That's it. The four domain tools will automatically appear in the tool list and serve your domain knowledge, rules, workflows, and diagrams.

---

## Semantic Search

Domain tools use **embedding-based semantic search** over the domain knowledge base (~60 items). Instead of substring matching, queries and items are converted to 384-dimensional vectors and compared by cosine similarity. This enables natural language queries, synonym matching ("permissions" finds "rights"), and ranked results.

### How It Works

1. At server startup, `domainRegistry.initEmbeddings()` is called (fire-and-forget)
2. Each registry (knowledge, workflows, diagrams) converts its items to text using a text function
3. Text is embedded into 384-dim vectors via `embedBatch()` (local MiniLM-L6-v2, no API keys)
4. At search time, the query is embedded via `embed()` and compared against all pre-computed vectors
5. Results above a similarity threshold are returned, ranked by score (highest first)

### The `SemanticSearch` Class

`lib/mcp/domain/semantic-search.js` is a composable utility — each registry gets its own instance:

```javascript
import { SemanticSearch } from '#lib/mcp/domain/semantic-search.js'

const search = new SemanticSearch({ threshold: 0.3, topK: 20 })
await search.initialize(items, (item) => `${item.name} ${item.title}: ${item.description}`)

const results = await search.search('licensing hierarchy')
// [{ item: <DomainConcept>, score: 0.72 }, ...]
```

| Method                      | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `initialize(items, textFn)` | Pre-compute embeddings for all items                    |
| `search(query, options?)`   | Returns `{ item, score }[]` ranked by cosine similarity |
| `isInitialized`             | Boolean guard for fallback logic                        |

### Graceful Fallback

If `initEmbeddings()` hasn't completed yet (startup warmup ~2-5s) or failed, search methods fall back to substring matching automatically. Domain tools always work, even without the embedding model.

```javascript
async searchConcepts(query) {
  if (this._semanticSearch.isInitialized) {
    const results = await this._semanticSearch.search(query)
    if (results.length > 0) return results.map((r) => r.item)
  }
  return this._substringSearch(query)  // fallback
}
```

### Text Representation

Each registry converts items to searchable text:

| Registry  | Text Format                                            |
| --------- | ------------------------------------------------------ |
| Concepts  | `{name} {title}: {description} {tags joined by space}` |
| Workflows | `{name} {title}: {description} {tags joined by space}` |
| Diagrams  | `{name} {title}: {description} {tags joined by space}` |

### Configuration

| Option      | Default | Description                                                  |
| ----------- | ------- | ------------------------------------------------------------ |
| `threshold` | 0.3     | Minimum cosine similarity to include in results              |
| `topK`      | 10-20   | Maximum results (20 for concepts, 10 for workflows/diagrams) |

**Why threshold 0.3:** MiniLM-L6-v2 normalized embeddings produce lower similarity scores than larger models. A threshold of 0.3 catches semantically relevant results without noise. The threshold is configurable per-instance and overridable per-search call.

**Why in-memory, not pgvector:** The domain dataset is small (~60 items). Computing cosine similarity over 60 vectors takes microseconds. No external database needed. pgvector is reserved for the larger, growing CRUD operation history.

### Initialization

```javascript
// src/<server>/config.js — fire-and-forget, same pattern as vector storage and tracing
domainRegistry
  .initEmbeddings()
  .then(() => logger.info('Domain semantic search initialized', { service: 'mcp-config' }))
  .catch((err) =>
    logger.warn('Domain semantic search unavailable, using substring fallback', {
      service: 'mcp-config',
      error: err.message
    })
  )
```

---

## Testing

### Unit Testing Rules

Rules are pure functions — test them directly:

```javascript
import { describe, it, expect } from 'vitest'
import { myRules } from '../src/<server>/domain/rules/my-rules.js'

describe('my_validation_rule', () => {
  const rule = myRules.find((r) => r.name === 'my_validation_rule')

  it('passes when required_field is present', () => {
    const result = rule.evaluate({ required_field: 'value' })
    expect(result.passed).toBe(true)
  })

  it('fails when required_field is missing', () => {
    const result = rule.evaluate({})
    expect(result.passed).toBe(false)
    expect(result.suggestion).toBeDefined()
  })

  it('uses context for cross-entity validation', () => {
    const result = rule.evaluate({ starts: '2025-01-01' }, { rights: [{ starts: '2024-12-01' }] })
    expect(result.passed).toBe(false)
  })
})
```

### Integration Testing the Registry

```javascript
import { describe, it, expect } from 'vitest'
import { createMyDomainRegistry } from '../src/<server>/domain/registry.js'

describe('domain registry', () => {
  const registry = createMyDomainRegistry()

  it('provides context for known models', () => {
    const context = registry.getContextForModel('model_a')
    expect(context.model).toBe('model_a')
    expect(context.concepts.length).toBeGreaterThan(0)
  })

  it('finds concepts by search', async () => {
    const results = await registry.searchConcepts('hierarchy')
    expect(results.length).toBeGreaterThan(0)
  })

  it('evaluates rules for a model', () => {
    const result = registry.checkRules('model_a', { required_field: 'value' })
    expect(result.passed).toBe(true)
  })
})
```

### Test File Naming

Test files must use the `.spec.js` extension (not `.test.js`). Place them in `__tests__/` mirroring the source structure.
