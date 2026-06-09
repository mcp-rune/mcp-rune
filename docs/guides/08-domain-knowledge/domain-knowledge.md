# Domain knowledge framework

This guide explains how to extend the domain intelligence layer with new concepts, business rules, and workflows. The framework is declarative: all domain components are data structures, not procedural code.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [When to Use Each Component](#when-to-use-each-component)
3. [DomainConcept — Cross-Entity Knowledge](#domainconcept--cross-entity-knowledge)
4. [BusinessRule — Declarative Constraints](#businessrule--declarative-constraints)
5. [WorkflowDefinition — Multi-Step Guides](#workflowdefinition--multi-step-guides)
6. [Wiring It Up — The Domain Registry](#wiring-it-up--the-domain-registry)
7. [How Domain Tools Consume the Registry](#how-domain-tools-consume-the-registry)
8. [Step-by-Step: Adding Domain Intelligence to a New Server](#step-by-step-adding-domain-intelligence-to-a-new-server)
9. [Testing](#testing)

---

## Architecture Overview

<!-- illustration: domain-knowledge#arch -->

```
lib/mcp/domain/                      # Framework classes (shared)
├── knowledge.js                     # DomainConcept + DomainKnowledge
├── business-rules.js                # BusinessRule + RuleSet
├── workflows.js                     # WorkflowStep + WorkflowDefinition + WorkflowRegistry
└── registry.js                      # DomainRegistry (aggregates all of the above)

lib/mcp/tools/domain/                # Domain tools (shared)
├── base-domain-tool.js              # BaseDomainTool (DOMAIN category, no auth)
├── get-domain-context-tool.js       # Retrieves composed context for a model/concept
├── check-business-rules-tool.js     # Validates data against business rules
├── suggest-workflow-tool.js         # Returns a workflow roadmap + first step
└── get-workflow-step-tool.js        # Returns detail for a specific workflow step

src/<server>/domain/                 # Server-specific domain data
├── registry.js                      # Factory: createXxxDomainRegistry()
├── knowledge/
│   └── concepts.js                  # DomainConcept instances
├── rules/
│   ├── <domain>-rules.js            # BusinessRule instances
│   └── mutability-rules.js          # Auto-generated from model metadata
└── workflows/
    └── <workflow-category>.js       # WorkflowDefinition instances
```

**Data flow:**

1. Server-specific code creates `DomainConcept`, `BusinessRule`, and `WorkflowDefinition` instances
2. These are assembled into a `DomainRegistry` via a factory function
3. The registry is dependency-injected into the tool registry
4. Four domain tools (`get_domain_context`, `check_business_rules`, `suggest_workflow`, `get_workflow_step`) consume the registry and expose it to users

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

**Key distinction: Concept vs Rule vs Workflow**

- **Concept** = knowledge about what exists and how things relate ("projects contain tasks, which inherit priority and due date")
- **Rule** = a testable constraint that can pass or fail ("in-progress tasks must have a due_date")
- **Workflow** = an ordered sequence of steps to accomplish a goal ("set up a project with tasks in 5 steps")

If you find yourself writing a concept with an `evaluate` function, make it a rule. If you find yourself writing a rule with 10 steps, make it a workflow.

---

## DomainConcept — Cross-Entity Knowledge

**Source:** `lib/mcp/domain/knowledge.js`

A `DomainConcept` captures knowledge that spans multiple models and cannot be expressed in any single model's `static attributes`. Field-level knowledge (enum descriptions, conditionals, examples) belongs in models — concepts add cross-entity relationships on top.

### Constructor

```js file=examples/domain-knowledge-guide-01.js
import { DomainConcept } from '#src/mcp/domain/knowledge.js'

new DomainConcept({
  name: 'project_task_hierarchy',              // Unique identifier (snake_case)
  title: 'Project → Task → Tag',               // Human-readable title
  description: 'Projects contain tasks...',   // 1-2 sentence explanation
  models: ['project', 'task', 'tag'],          // Models this concept spans
  tags: ['hierarchy', 'structure'],            // For filtering and search
  details: { ... }                             // Structured additional context
})
```

```ts file=examples/domain-knowledge-guide-01.ts
import { DomainConcept } from '#src/mcp/domain/knowledge.js'

new DomainConcept({
  name: 'project_task_hierarchy',              // Unique identifier (snake_case)
  title: 'Project → Task → Tag',               // Human-readable title
  description: 'Projects contain tasks...',   // 1-2 sentence explanation
  models: ['project', 'task', 'tag'],          // Models this concept spans
  tags: ['hierarchy', 'structure'],            // For filtering and search
  details: { ... }                             // Structured additional context
})
```

### The `details` Object

The `details` object is **freeform by design** — the `get_domain_context` tool renders it as structured content to the LLM, so any keys work. However, the formatting layer recognizes certain conventional keys and renders them specially:

| Key           | Type                   | Rendering                                       | Purpose                                      |
| ------------- | ---------------------- | ----------------------------------------------- | -------------------------------------------- |
| `inheritance` | `{ from, to, fields }` | `**Inheritance:** project → task (fields: ...)` | Describes field inheritance between entities |
| `process`     | `string`               | `**Process:** Create project → add tasks → ...` | Step-by-step procedure                       |
| `tips`        | `string[]`             | Bulleted list under `**Tips:**`                 | Actionable guidance                          |

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

```js file=examples/domain-knowledge-guide-02.js
new DomainConcept({
  name: 'project_task_hierarchy',
  title: 'Project → Task → Tag',
  description:
    'Projects contain tasks, which in turn have tags. Tasks inherit certain fields from their parent project.',
  models: ['project', 'task', 'tag'],
  tags: ['hierarchy', 'structure', 'inheritance'],
  details: {
    inheritance: {
      from: 'project',
      to: 'task',
      fields: ['priority', 'due_date', 'assignee']
    },
    process: 'Create project first → add tasks under the project → assign tags per task',
    tips: [
      'Create the project before creating tasks — tasks are nested under projects',
      'Tag assignment is per-task, not per-project (use tags)'
    ]
  }
})
```

```ts file=examples/domain-knowledge-guide-02.ts
new DomainConcept({
  name: 'project_task_hierarchy',
  title: 'Project → Task → Tag',
  description:
    'Projects contain tasks, which in turn have tags. Tasks inherit certain fields from their parent project.',
  models: ['project', 'task', 'tag'],
  tags: ['hierarchy', 'structure', 'inheritance'],
  details: {
    inheritance: {
      from: 'project',
      to: 'task',
      fields: ['priority', 'due_date', 'assignee']
    },
    process: 'Create project first → add tasks under the project → assign tags per task',
    tips: [
      'Create the project before creating tasks — tasks are nested under projects',
      'Tag assignment is per-task, not per-project (use tags)'
    ]
  }
})
```

**Status enum concept:**

```js file=examples/domain-knowledge-guide-03.js
new DomainConcept({
  name: 'task_completion_status',
  title: 'Task Status Lifecycle',
  description:
    'When a task is created or updated, its completion status follows a defined lifecycle.',
  models: ['task', 'project'],
  tags: ['status', 'lifecycle', 'tasks'],
  details: {
    statuses: {
      pending: 'Task has not been started yet',
      in_progress: 'Task is actively being worked on',
      completed: 'Task has been finished',
      cancelled: 'Task was abandoned before completion'
    },
    process:
      'Task created → status set to pending → in_progress when started → completed when done',
    tips: [
      'Task status transitions are tracked automatically — update status to reflect current state'
    ]
  }
})
```

```ts file=examples/domain-knowledge-guide-03.ts
new DomainConcept({
  name: 'task_completion_status',
  title: 'Task Status Lifecycle',
  description:
    'When a task is created or updated, its completion status follows a defined lifecycle.',
  models: ['task', 'project'],
  tags: ['status', 'lifecycle', 'tasks'],
  details: {
    statuses: {
      pending: 'Task has not been started yet',
      in_progress: 'Task is actively being worked on',
      completed: 'Task has been finished',
      cancelled: 'Task was abandoned before completion'
    },
    process:
      'Task created → status set to pending → in_progress when started → completed when done',
    tips: [
      'Task status transitions are tracked automatically — update status to reflect current state'
    ]
  }
})
```

**Dynamic concept from model metadata:**

```js file=src/create-mutability-concept.js
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

```ts file=src/create-mutability-concept.ts
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

```js file=src/concepts.js
export const concepts = [
  // ============================================================================
  // HIERARCHY & STRUCTURE CONCEPTS
  // ============================================================================
  new DomainConcept({ name: 'project_task_hierarchy', ... }),
  new DomainConcept({ name: 'two_step_tag_assignment', ... }),

  // ============================================================================
  // RIGHTS VALIDATION CONCEPTS
  // ============================================================================
  new DomainConcept({ name: 'task_completion_status', ... }),

  // ============================================================================
  // TERMINOLOGY & WINDOWS CONCEPTS
  // ============================================================================
  new DomainConcept({ name: 'project_terminology', ... }),
]
```

```ts file=src/concepts.ts
export const concepts = [
  // ============================================================================
  // HIERARCHY & STRUCTURE CONCEPTS
  // ============================================================================
  new DomainConcept({ name: 'project_task_hierarchy', ... }),
  new DomainConcept({ name: 'two_step_tag_assignment', ... }),

  // ============================================================================
  // RIGHTS VALIDATION CONCEPTS
  // ============================================================================
  new DomainConcept({ name: 'task_completion_status', ... }),

  // ============================================================================
  // TERMINOLOGY & WINDOWS CONCEPTS
  // ============================================================================
  new DomainConcept({ name: 'project_terminology', ... }),
]
```

---

## BusinessRule — Declarative Constraints

**Source:** `lib/mcp/domain/business-rules.js`

A `BusinessRule` validates constraints between entities that individual model validation cannot express. Each rule is a data structure with an evaluate function — testable, auditable, introspectable.

### Constructor

```js file=examples/domain-knowledge-guide-06.js
import { BusinessRule } from '#src/mcp/domain/business-rules.js'

new BusinessRule({
  name: 'task_requires_due_date', // Unique identifier (snake_case)
  description: 'Tasks in progress must have a due_date set',
  scope: ['task'], // Models this rule applies to
  severity: 'error', // 'error' | 'warning' | 'info'
  tags: ['in-progress', 'required-fields'], // For filtering
  evaluate(data, context = {}) {
    // Validation function
    // ...
  }
})
```

```ts file=examples/domain-knowledge-guide-06.ts
import { BusinessRule } from '#src/mcp/domain/business-rules.js'

new BusinessRule({
  name: 'task_requires_due_date', // Unique identifier (snake_case)
  description: 'Tasks in progress must have a due_date set',
  scope: ['task'], // Models this rule applies to
  severity: 'error', // 'error' | 'warning' | 'info'
  tags: ['in-progress', 'required-fields'], // For filtering
  evaluate(data, context = {}) {
    // Validation function
    // ...
  }
})
```

### The `evaluate` Function

The evaluate function receives two arguments and must return a result object:

**Input:**

| Parameter | Description                                                                         |
| --------- | ----------------------------------------------------------------------------------- |
| `data`    | The entity data being validated (e.g., `{ status: 'in_progress', due_date: null }`) |
| `context` | Additional context — related entities, parent data, content type, etc.              |

**Output:**

```js file=examples/domain-knowledge-guide-07.js
{
  passed: true|false,        // Whether the rule passed
  message: 'Human-readable explanation',
  details: { ... },          // Optional: structured detail data
  suggestion: 'How to fix'   // Optional: actionable fix suggestion
}
```

```ts file=examples/domain-knowledge-guide-07.ts
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

```js file=examples/domain-knowledge-guide-08.js
evaluate(data) {
  if (data.status !== 'in_progress') {
    return { passed: true, message: 'Not an in-progress task, rule not applicable' }
  }
  // ... actual validation
}
```

```ts file=examples/domain-knowledge-guide-08.ts
evaluate(data) {
  if (data.status !== 'in_progress') {
    return { passed: true, message: 'Not an in-progress task, rule not applicable' }
  }
  // ... actual validation
}
```

**2. Use context for cross-entity validation:**

```js file=examples/domain-knowledge-guide-09.js
evaluate(data, context = {}) {
  if (!context.tasks || context.tasks.length === 0) {
    return { passed: true, message: 'No tasks in context to validate against' }
  }
  // ... validate project dates encompass task due dates
}
```

```ts file=examples/domain-knowledge-guide-09.ts
evaluate(data, context = {}) {
  if (!context.tasks || context.tasks.length === 0) {
    return { passed: true, message: 'No tasks in context to validate against' }
  }
  // ... validate project dates encompass task due dates
}
```

**3. Provide actionable suggestions:**

```js file=examples/domain-knowledge-guide-10.js
return {
  passed: false,
  message: `In-progress tasks require: ${missing.join(', ')}`,
  suggestion: 'Set due_date to a valid ISO date string (e.g., "2026-03-01T00:00:00Z")'
}
```

```ts file=examples/domain-knowledge-guide-10.ts
return {
  passed: false,
  message: `In-progress tasks require: ${missing.join(', ')}`,
  suggestion: 'Set due_date to a valid ISO date string (e.g., "2026-03-01T00:00:00Z")'
}
```

**4. A rule can apply to multiple models:**

```js file=examples/domain-knowledge-guide-11.js
new BusinessRule({
  name: 'end_date_after_start_date',
  scope: ['task', 'project'] // Applies to both
  // ...
})
```

```ts file=examples/domain-knowledge-guide-11.ts
new BusinessRule({
  name: 'end_date_after_start_date',
  scope: ['task', 'project'] // Applies to both
  // ...
})
```

### Examples

**Field requirement rule:**

```js file=src/missing.js
new BusinessRule({
  name: 'task_requires_due_date',
  description: 'Tasks in progress must have a due_date set',
  scope: ['task'],
  severity: 'error',
  tags: ['in-progress', 'required-fields'],
  evaluate(data) {
    if (data.status !== 'in_progress') {
      return { passed: true, message: 'Not an in-progress task, rule not applicable' }
    }
    const missing = []
    if (!data.due_date) missing.push('due_date')

    if (missing.length > 0) {
      return {
        passed: false,
        message: `In-progress tasks require: ${missing.join(', ')}`,
        suggestion: 'Set due_date to a valid ISO date string (e.g., "2026-03-01T00:00:00Z")'
      }
    }
    return { passed: true, message: 'Task due date is set' }
  }
})
```

```ts file=src/missing.ts
new BusinessRule({
  name: 'task_requires_due_date',
  description: 'Tasks in progress must have a due_date set',
  scope: ['task'],
  severity: 'error',
  tags: ['in-progress', 'required-fields'],
  evaluate(data) {
    if (data.status !== 'in_progress') {
      return { passed: true, message: 'Not an in-progress task, rule not applicable' }
    }
    const missing = []
    if (!data.due_date) missing.push('due_date')

    if (missing.length > 0) {
      return {
        passed: false,
        message: `In-progress tasks require: ${missing.join(', ')}`,
        suggestion: 'Set due_date to a valid ISO date string (e.g., "2026-03-01T00:00:00Z")'
      }
    }
    return { passed: true, message: 'Task due date is set' }
  }
})
```

**Cross-entity validation rule (uses context):**

```js file=src/project-dates-rule.js
new BusinessRule({
  name: 'project_dates_encompass_tasks',
  description: "Project date range should encompass its tasks' due dates",
  scope: ['project'],
  severity: 'warning',
  tags: ['dates', 'cross-entity'],
  evaluate(data, context = {}) {
    if (!data.starts && !data.ends) {
      return { passed: true, message: 'Project has no date constraints' }
    }
    if (!context.tasks || context.tasks.length === 0) {
      return { passed: true, message: 'No tasks in context to validate against' }
    }

    const projectStart = data.starts ? new Date(data.starts) : null
    const issues = []

    for (const task of context.tasks) {
      if (projectStart && task.due_date && new Date(task.due_date) < projectStart) {
        issues.push(`Task due date is before project start`)
      }
    }

    if (issues.length > 0) {
      return {
        passed: false,
        message: issues.join('; '),
        suggestion: 'Extend project dates to encompass all task due dates'
      }
    }
    return { passed: true, message: 'Project dates encompass all task due dates' }
  }
})
```

```ts file=src/project-dates-rule.ts
new BusinessRule({
  name: 'project_dates_encompass_tasks',
  description: "Project date range should encompass its tasks' due dates",
  scope: ['project'],
  severity: 'warning',
  tags: ['dates', 'cross-entity'],
  evaluate(data, context = {}) {
    if (!data.starts && !data.ends) {
      return { passed: true, message: 'Project has no date constraints' }
    }
    if (!context.tasks || context.tasks.length === 0) {
      return { passed: true, message: 'No tasks in context to validate against' }
    }

    const projectStart = data.starts ? new Date(data.starts) : null
    const issues = []

    for (const task of context.tasks) {
      if (projectStart && task.due_date && new Date(task.due_date) < projectStart) {
        issues.push(`Task due date is before project start`)
      }
    }

    if (issues.length > 0) {
      return {
        passed: false,
        message: issues.join('; '),
        suggestion: 'Extend project dates to encompass all task due dates'
      }
    }
    return { passed: true, message: 'Project dates encompass all task due dates' }
  }
})
```

### Where to Put Rules

Add rules to `src/<server>/domain/rules/<domain>-rules.js`. Each file exports an array:

```js file=src/task-rules.js
// src/<server>/domain/rules/task-rules.js
import { BusinessRule } from '#src/mcp/domain/business-rules.js'

export const taskRules = [
  new BusinessRule({ ... }),
  new BusinessRule({ ... }),
]
```

```ts file=src/task-rules.ts
// src/<server>/domain/rules/task-rules.js
import { BusinessRule } from '#src/mcp/domain/business-rules.js'

export const taskRules = [
  new BusinessRule({ ... }),
  new BusinessRule({ ... }),
]
```

Group related rules in the same file. Create new files for distinct domains (e.g., `project-rules.js`, `book-rules.js`).

---

## WorkflowDefinition — Multi-Step Guides

**Source:** `lib/mcp/domain/workflows.js`

A `WorkflowDefinition` is a structured multi-step process guide. It can include tool calls, decision points, and tips. Two common patterns:

- **Onboarding/Setup** — How-to guides for accomplishing a task
- **Demo** — Choreographed presentations with audience-friendly narration (tagged `demo`)

### Constructor

```js file=examples/domain-knowledge-guide-15.js
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

new WorkflowDefinition({
  name: 'create_project_workflow',                    // Unique identifier (snake_case)
  title: 'Set Up a New Project',               // Human-readable title
  description: 'Creates a project and populates it with tasks.',
  tags: ['project', 'tasks', 'onboarding'],    // For filtering
  models: ['project', 'task', 'tag'],          // Models involved
  steps: [
    { order: 1, title: '...', description: '...', ... },
    { order: 2, title: '...', description: '...', ... },
  ]
})
```

```ts file=examples/domain-knowledge-guide-15.ts
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

new WorkflowDefinition({
  name: 'create_project_workflow',                    // Unique identifier (snake_case)
  title: 'Set Up a New Project',               // Human-readable title
  description: 'Creates a project and populates it with tasks.',
  tags: ['project', 'tasks', 'onboarding'],    // For filtering
  models: ['project', 'task', 'tag'],          // Models involved
  steps: [
    { order: 1, title: '...', description: '...', ... },
    { order: 2, title: '...', description: '...', ... },
  ]
})
```

### WorkflowStep

Each step is a plain object (auto-wrapped in `WorkflowStep`):

```js file=examples/domain-knowledge-guide-16.js
{
  order: 1,                           // Step number (1-based)
  title: 'Find the project',          // Step title
  description: 'Search for the project you want to set up.',
  tool: 'find_records',               // Optional: MCP tool to call
  toolArgs: {                         // Optional: example arguments
    model: 'project',
    search: { name: '<project_name>' }
  },
  decision: {                          // Optional: branching point
    question: 'All tasks or specific ones?',
    options: [
      { label: 'All tasks', description: 'Skip — project applies to all tasks' },
      { label: 'Specific tasks', description: 'Add task records', nextStep: 6 }
    ]
  },
  tips: [                              // Optional: guidance for this step
    'You need the project ID for the next step',
    'If the project does not exist, create it first'
  ]
}
```

```ts file=examples/domain-knowledge-guide-16.ts
{
  order: 1,                           // Step number (1-based)
  title: 'Find the project',          // Step title
  description: 'Search for the project you want to set up.',
  tool: 'find_records',               // Optional: MCP tool to call
  toolArgs: {                         // Optional: example arguments
    model: 'project',
    search: { name: '<project_name>' }
  },
  decision: {                          // Optional: branching point
    question: 'All tasks or specific ones?',
    options: [
      { label: 'All tasks', description: 'Skip — project applies to all tasks' },
      { label: 'Specific tasks', description: 'Add task records', nextStep: 6 }
    ]
  },
  tips: [                              // Optional: guidance for this step
    'You need the project ID for the next step',
    'If the project does not exist, create it first'
  ]
}
```

**Notes:**

- `tool` references an MCP tool name. `toolArgs` are **example** arguments shown to users, not auto-executed.
- `decision.options[].nextStep` creates branching — users can jump to a different step.
- Steps without a `tool` are narrative/explanation steps (common in demo workflows).

### Examples

**Onboarding workflow:**

```js file=examples/domain-knowledge-guide-17.js
new WorkflowDefinition({
  name: 'create_project_workflow',
  title: 'Set Up a New Project',
  description: 'Set up a project and populate it with tasks.',
  tags: ['project', 'tasks', 'onboarding'],
  models: ['project', 'task', 'tag'],
  steps: [
    {
      order: 1,
      title: 'Find the project',
      description: 'Search for the project you want to set up.',
      tool: 'find_records',
      toolArgs: { model: 'project', search: { name: '<project_name>' } },
      tips: ['You need the project ID for the next step']
    },
    {
      order: 2,
      title: 'Get the task creation guide',
      description: 'Load the guided creation form for tasks.',
      tool: 'get_prompt_guide',
      toolArgs: { guide_name: 'create_task' },
      tips: ['Use mode: "quick" if you already know the field values']
    }
    // ... more steps
  ]
})
```

```ts file=examples/domain-knowledge-guide-17.ts
new WorkflowDefinition({
  name: 'create_project_workflow',
  title: 'Set Up a New Project',
  description: 'Set up a project and populate it with tasks.',
  tags: ['project', 'tasks', 'onboarding'],
  models: ['project', 'task', 'tag'],
  steps: [
    {
      order: 1,
      title: 'Find the project',
      description: 'Search for the project you want to set up.',
      tool: 'find_records',
      toolArgs: { model: 'project', search: { name: '<project_name>' } },
      tips: ['You need the project ID for the next step']
    },
    {
      order: 2,
      title: 'Get the task creation guide',
      description: 'Load the guided creation form for tasks.',
      tool: 'get_prompt_guide',
      toolArgs: { guide_name: 'create_task' },
      tips: ['Use mode: "quick" if you already know the field values']
    }
    // ... more steps
  ]
})
```

**Demo workflow:**

```js file=examples/domain-knowledge-guide-18.js
new WorkflowDefinition({
  name: 'demo_task_tracking',
  title: 'Demo: Task Tracking',
  description: 'Choreographed demo with audience-friendly explanations.',
  tags: ['tasks', 'demo'],
  models: ['project', 'task'],
  steps: [
    {
      order: 1,
      title: 'Set the scene',
      description:
        'Explain task tracking: "Tasks let you break down projects into actionable steps..."',
      tips: ['Key value prop: tasks make large goals manageable']
      // No tool — narrative step
    },
    {
      order: 2,
      title: 'Find a demo project',
      description: 'Search for a recognizable project.',
      tool: 'find_records',
      toolArgs: { model: 'project', search: { name: 'The Hobbit' } },
      tips: ['Choose a project the audience will recognize']
    }
    // ... more steps
  ]
})
```

```ts file=examples/domain-knowledge-guide-18.ts
new WorkflowDefinition({
  name: 'demo_task_tracking',
  title: 'Demo: Task Tracking',
  description: 'Choreographed demo with audience-friendly explanations.',
  tags: ['tasks', 'demo'],
  models: ['project', 'task'],
  steps: [
    {
      order: 1,
      title: 'Set the scene',
      description:
        'Explain task tracking: "Tasks let you break down projects into actionable steps..."',
      tips: ['Key value prop: tasks make large goals manageable']
      // No tool — narrative step
    },
    {
      order: 2,
      title: 'Find a demo project',
      description: 'Search for a recognizable project.',
      tool: 'find_records',
      toolArgs: { model: 'project', search: { name: 'The Hobbit' } },
      tips: ['Choose a project the audience will recognize']
    }
    // ... more steps
  ]
})
```

### Where to Put Workflows

Add workflows to `src/<server>/domain/workflows/<category>.js`. Each file exports an array:

```js file=src/project-workflows.js
// src/<server>/domain/workflows/project-tasks.js
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

export const projectWorkflows = [
  new WorkflowDefinition({ ... }),  // Setup
  new WorkflowDefinition({ ... }),  // Demo
]
```

```ts file=src/project-workflows.ts
// src/<server>/domain/workflows/project-tasks.js
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

export const projectWorkflows = [
  new WorkflowDefinition({ ... }),  // Setup
  new WorkflowDefinition({ ... }),  // Demo
]
```

Group related workflows in the same file (e.g., setup + demo variant of the same process).

---

## Wiring It Up — The Domain Registry

**Source:** `lib/mcp/domain/registry.js`

The `DomainRegistry` aggregates all domain intelligence into a single injectable dependency.

### Creating the Registry

```js file=src/registries/create-my-domain-registry.js
// src/<server>/domain/registry.js
import { DomainKnowledge } from '#src/mcp/domain/knowledge.js'
import { RuleSet } from '#src/mcp/domain/business-rules.js'
import { WorkflowRegistry } from '#src/mcp/domain/workflows.js'
import { DomainRegistry } from '#src/mcp/domain/registry.js'
import { MODEL_CLASSES } from '../models/index.js'

import { concepts } from './knowledge/concepts.js'
import { taskRules } from './rules/task-rules.js'
import { projectRules } from './rules/project-rules.js'
import { projectWorkflows } from './workflows/project-tasks.js'

export function createMyDomainRegistry() {
  const knowledge = new DomainKnowledge({
    concepts: [...concepts],
    models: MODEL_CLASSES // Pass model classes for field metadata
  })

  const rules = new RuleSet([...taskRules, ...projectRules])

  const workflows = new WorkflowRegistry([...projectWorkflows])

  return new DomainRegistry({ knowledge, rules, workflows })
}
```

```ts file=src/registries/create-my-domain-registry.ts
// src/<server>/domain/registry.js
import { DomainKnowledge } from '#src/mcp/domain/knowledge.js'
import { RuleSet } from '#src/mcp/domain/business-rules.js'
import { WorkflowRegistry } from '#src/mcp/domain/workflows.js'
import { DomainRegistry } from '#src/mcp/domain/registry.js'
import { MODEL_CLASSES } from '../models/index.js'

import { concepts } from './knowledge/concepts.js'
import { taskRules } from './rules/task-rules.js'
import { projectRules } from './rules/project-rules.js'
import { projectWorkflows } from './workflows/project-tasks.js'

export function createMyDomainRegistry() {
  const knowledge = new DomainKnowledge({
    concepts: [...concepts],
    models: MODEL_CLASSES // Pass model classes for field metadata
  })

  const rules = new RuleSet([...taskRules, ...projectRules])

  const workflows = new WorkflowRegistry([...projectWorkflows])

  return new DomainRegistry({ knowledge, rules, workflows })
}
```

### Injecting into the Tool Registry

Pass the domain registry when creating the tool registry. The tool registry injects it into every domain tool instance:

```js file=src/registries/domain-registry.js
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

```ts file=src/registries/domain-registry.ts
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

| Input                                      | Behavior                                                            |
| ------------------------------------------ | ------------------------------------------------------------------- |
| No args                                    | Lists all concepts and workflows (overview)                         |
| `{ model: 'task' }`                        | Returns field metadata + concepts + rules + workflows for the model |
| `{ concept: 'project_task_hierarchy' }`    | Returns full concept details                                        |
| `{ model: 'task', concept: 'completion' }` | Returns both model context and concept search results               |

**Formatting of `details` conventional keys:**

- `details.inheritance` → rendered as `**Inheritance:** from → to (fields: ...)`
- `details.process` → rendered as `**Process:** ...`
- `details.tips` → rendered as bulleted list under `**Tips:**`
- All other keys → included as structured JSON in the context

### `check_business_rules`

Validates entity data against applicable business rules.

| Input                                                          | Behavior                             |
| -------------------------------------------------------------- | ------------------------------------ |
| `{ model: 'task', data: { status: 'in_progress' } }`           | Evaluates all rules scoped to `task` |
| `{ model: 'project', data: {...}, context: { tasks: [...] } }` | Evaluates with cross-entity context  |

Output is grouped by severity: Errors (must fix) → Warnings (should fix) → Info → Passed.

### `suggest_workflow`

Returns a workflow roadmap (all step titles) plus the first step in full detail. The LLM executes one step at a time, calling `get_workflow_step` for each subsequent step.

| Input                                     | Behavior                                                   |
| ----------------------------------------- | ---------------------------------------------------------- |
| No args                                   | Lists all workflows                                        |
| `{ goal: 'project tasks' }`               | Searches by title/description/tags, returns best match     |
| `{ workflow: 'create_project_workflow' }` | Returns the full roadmap + first step for a named workflow |
| `{ tag: 'demo' }`                         | Filters by tag                                             |

### `get_workflow_step`

Returns detailed instructions for a single workflow step — the tool to call, arguments to pass, tips, and exclusion warnings. For loop and parallel groups, returns all steps in the group together with a hint about the next step after the group.

| Input                                               | Behavior                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `{ workflow: 'create_project_workflow', step: 1 }`  | Detail for step 1: tool, args, tips, next-step hint              |
| `{ workflow: 'create_project_workflow', step: 3 }`  | If step 3 is in a loop or parallel group, returns the full group |
| `{ workflow: 'unknown', step: 1 }`                  | Error: lists available workflow names                            |
| `{ workflow: 'create_project_workflow', step: 99 }` | Error: lists the workflow's available step numbers               |

The tool is stateless. The LLM (or a coordinating agent) drives progression by calling `get_workflow_step` once per step; the framework never tracks "current step" on the server side. Steps may declare a `contextHint` payload that surfaces in the response's `_meta.contextHints` for the transient-context protocol.

---

## Step-by-Step: Adding Domain Intelligence to a New Server

If your server doesn't have domain intelligence yet, follow these steps:

### 1. Create the domain directory structure

<!-- illustration: domain-knowledge#setup -->

```
src/<server>/domain/
├── registry.js
├── knowledge/
│   └── concepts.js
├── rules/
│   └── <domain>-rules.js
└── workflows/
    └── <category>.js
```

### 2. Define concepts

```js file=src/concepts.js
// src/<server>/domain/knowledge/concepts.js
import { DomainConcept } from '#src/mcp/domain/knowledge.js'

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

```ts file=src/concepts.ts
// src/<server>/domain/knowledge/concepts.js
import { DomainConcept } from '#src/mcp/domain/knowledge.js'

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

```js file=src/my-rules.js
// src/<server>/domain/rules/<domain>-rules.js
import { BusinessRule } from '#src/mcp/domain/business-rules.js'

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

```ts file=src/my-rules.ts
// src/<server>/domain/rules/<domain>-rules.js
import { BusinessRule } from '#src/mcp/domain/business-rules.js'

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

```js file=src/my-workflows.js
// src/<server>/domain/workflows/<category>.js
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

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
        tool: 'find_records',
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

```ts file=src/my-workflows.ts
// src/<server>/domain/workflows/<category>.js
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

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
        tool: 'find_records',
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

### 5. Assemble the registry

```js file=src/registries/create-my-domain-registry.js
// src/<server>/domain/registry.js
import { DomainKnowledge } from '#src/mcp/domain/knowledge.js'
import { RuleSet } from '#src/mcp/domain/business-rules.js'
import { WorkflowRegistry } from '#src/mcp/domain/workflows.js'
import { DomainRegistry } from '#src/mcp/domain/registry.js'
import { MODEL_CLASSES } from '../models/index.js'

import { concepts } from './knowledge/concepts.js'
import { myRules } from './rules/my-rules.js'
import { myWorkflows } from './workflows/my-category.js'

export function createMyDomainRegistry() {
  const knowledge = new DomainKnowledge({ concepts, models: MODEL_CLASSES })
  const rules = new RuleSet([...myRules])
  const workflows = new WorkflowRegistry([...myWorkflows])
  return new DomainRegistry({ knowledge, rules, workflows })
}
```

```ts file=src/registries/create-my-domain-registry.ts
// src/<server>/domain/registry.js
import { DomainKnowledge } from '#src/mcp/domain/knowledge.js'
import { RuleSet } from '#src/mcp/domain/business-rules.js'
import { WorkflowRegistry } from '#src/mcp/domain/workflows.js'
import { DomainRegistry } from '#src/mcp/domain/registry.js'
import { MODEL_CLASSES } from '../models/index.js'

import { concepts } from './knowledge/concepts.js'
import { myRules } from './rules/my-rules.js'
import { myWorkflows } from './workflows/my-category.js'

export function createMyDomainRegistry() {
  const knowledge = new DomainKnowledge({ concepts, models: MODEL_CLASSES })
  const rules = new RuleSet([...myRules])
  const workflows = new WorkflowRegistry([...myWorkflows])
  return new DomainRegistry({ knowledge, rules, workflows })
}
```

### 6. Inject into the server config

```js file=src/registries/domain-registry.js
// src/<server>/config.js
import { createMyDomainRegistry } from './domain/registry.js'

const domainRegistry = createMyDomainRegistry()

const toolRegistry = createToolRegistry({
  // ... other dependencies
  domainRegistry
})
```

```ts file=src/registries/domain-registry.ts
// src/<server>/config.js
import { createMyDomainRegistry } from './domain/registry.js'

const domainRegistry = createMyDomainRegistry()

const toolRegistry = createToolRegistry({
  // ... other dependencies
  domainRegistry
})
```

That's it. The four domain tools will automatically appear in the tool list and serve your domain knowledge, rules, and workflows.

---

## Semantic Search

Domain tools use **embedding-based semantic search** over the domain knowledge base (~60 items). Instead of substring matching, queries and items are converted to 384-dimensional vectors and compared by cosine similarity. This enables natural language queries, synonym matching ("permissions" finds "rights"), and ranked results.

### How It Works

1. At server startup, `domainRegistry.initEmbeddings()` is called (fire-and-forget)
2. Each registry (knowledge, workflows) converts its items to text using a text function
3. Text is embedded into 384-dim vectors via `embedBatch()` (local MiniLM-L6-v2, no API keys)
4. At search time, the query is embedded via `embed()` and compared against all pre-computed vectors
5. Results above a similarity threshold are returned, ranked by score (highest first)

### The `SemanticSearch` Class

`lib/mcp/domain/semantic-search.js` is a composable utility — each registry gets its own instance:

```js file=src/search.js
import { SemanticSearch } from '#src/mcp/domain/semantic-search.js'

const search = new SemanticSearch({ threshold: 0.3, topK: 20 })
await search.initialize(items, (item) => `${item.name} ${item.title}: ${item.description}`)

const results = await search.search('project hierarchy')
// [{ item: <DomainConcept>, score: 0.72 }, ...]
```

```ts file=src/search.ts
import { SemanticSearch } from '#src/mcp/domain/semantic-search.js'

const search = new SemanticSearch({ threshold: 0.3, topK: 20 })
await search.initialize(items, (item) => `${item.name} ${item.title}: ${item.description}`)

const results = await search.search('project hierarchy')
// [{ item: <DomainConcept>, score: 0.72 }, ...]
```

| Method                      | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `initialize(items, textFn)` | Pre-compute embeddings for all items                    |
| `search(query, options?)`   | Returns `{ item, score }[]` ranked by cosine similarity |
| `isInitialized`             | Boolean guard for fallback logic                        |

### Graceful Fallback

If `initEmbeddings()` hasn't completed yet (startup warmup ~2-5s) or failed, search methods fall back to substring matching automatically. Domain tools always work, even without the embedding model.

```js file=src/results.js
async searchConcepts(query) {
  if (this._semanticSearch.isInitialized) {
    const results = await this._semanticSearch.search(query)
    if (results.length > 0) return results.map((r) => r.item)
  }
  return this._substringSearch(query)  // fallback
}
```

```ts file=src/results.ts
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

| Option      | Default | Description                                         |
| ----------- | ------- | --------------------------------------------------- |
| `threshold` | 0.3     | Minimum cosine similarity to include in results     |
| `topK`      | 10-20   | Maximum results (20 for concepts, 10 for workflows) |

**Why threshold 0.3:** MiniLM-L6-v2 normalized embeddings produce lower similarity scores than larger models. A threshold of 0.3 catches semantically relevant results without noise. The threshold is configurable per-instance and overridable per-search call.

**Why in-memory, not pgvector:** The domain dataset is small (~60 items). Computing cosine similarity over 60 vectors takes microseconds. No external database needed. pgvector is reserved for the larger, growing CRUD operation history.

### Initialization

```js file=examples/domain-knowledge-guide-33.js
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

```ts file=examples/domain-knowledge-guide-33.ts
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

```js file=src/rule.js
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

```ts file=src/rule.ts
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

```js file=src/registry.js
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

```ts file=src/registry.ts
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
