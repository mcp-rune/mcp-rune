---
extension:
  kind: plugin
  what: Author multi-step workflow definitions
---

# Workflow Creation Guide

This guide covers how to create effective `WorkflowDefinition` files that the LLM executes via the `suggest_workflow` tool.

## Table of Contents

- [Overview](#overview)
- [Schema Reference](#schema-reference)
- [Step Types](#step-types)
- [Tool Selection: Data Tools vs View Tools](#tool-selection-data-tools-vs-view-tools)
- [Workflow Patterns](#workflow-patterns)
- [Writing Effective Tips](#writing-effective-tips)
- [Writing Effective Decisions](#writing-effective-decisions)
- [Mutation Plans & Drafts](#mutation-plans--drafts)
- [Registration](#registration)
- [Checklist for New Workflows](#checklist-for-new-workflows)

## Overview

Workflows are multi-step process definitions that guide the LLM through complex tasks. They are:

- **LLM-consumed** — the `suggest_workflow` tool renders them as structured markdown for the LLM to follow
- **Declarative** — they describe _what_ to do, not _how_ to implement it
- **Tool-oriented** — each step references MCP tools the LLM should call
- **User-interactive** — decision steps let the user steer the workflow

The LLM receives the workflow via `suggest_workflow` (roadmap + first step), then advances step-by-step using `get_workflow_step`. This prompt-chaining approach scopes tool context per step, preventing the LLM from substituting similar-looking tools.

## Schema Reference

### WorkflowDefinition

```js file=examples/workflow-creation-guide-01.js
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

new WorkflowDefinition({
  name, // string — unique identifier, snake_case (e.g., 'log_study_session')
  title, // string — human-readable title (e.g., 'Log a Study Session')
  description, // string — what this workflow accomplishes (1-2 sentences)
  tags, // string[] — filtering tags (e.g., ['activity', 'onboarding'])
  models, // string[] — models involved (e.g., ['activity', 'theme', 'category'])
  steps, // WorkflowStep[] — ordered steps (see below)
  draftRequired, // boolean — must call preview_mutation_plan before mutations?
  mutationPlans // object — plan definitions (see Mutation Plans section)
})
```

```ts file=examples/workflow-creation-guide-01.ts
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

new WorkflowDefinition({
  name, // string — unique identifier, snake_case (e.g., 'log_study_session')
  title, // string — human-readable title (e.g., 'Log a Study Session')
  description, // string — what this workflow accomplishes (1-2 sentences)
  tags, // string[] — filtering tags (e.g., ['activity', 'onboarding'])
  models, // string[] — models involved (e.g., ['activity', 'theme', 'category'])
  steps, // WorkflowStep[] — ordered steps (see below)
  draftRequired, // boolean — must call preview_mutation_plan before mutations?
  mutationPlans // object — plan definitions (see Mutation Plans section)
})
```

| Property        | Required | Description                                                                                  |
| --------------- | -------- | -------------------------------------------------------------------------------------------- |
| `name`          | Yes      | Unique snake_case identifier. Used for exact lookup via `suggest_workflow(workflow: "name")` |
| `title`         | Yes      | Displayed in workflow lists and as the heading when rendered                                 |
| `description`   | Yes      | Searchable description. Include key verbs and nouns for goal-based search                    |
| `tags`          | No       | Used for `suggest_workflow(tag: "...")` filtering. Reuse existing tags when possible         |
| `models`        | No       | Enables `getWorkflowsByModel()` — workflows shown when the LLM works with these models       |
| `steps`         | Yes      | Array of step objects. Must have sequential `order` values starting from 1                   |
| `draftRequired` | No       | When `true`, the rendered workflow includes a "Draft Required" notice                        |
| `mutationPlans` | No       | Defines named plans for `preview_mutation_plan`. Keyed by plan name                          |

### WorkflowStep

```js file=examples/workflow-creation-guide-02.js
{
  order,           // number — step number (1-based, sequential)
  title,           // string — short step title
  description,     // string — what this step does (LLM reads this)
  tool,            // string — MCP tool name to call (e.g., 'find_records', 'search_records')
  toolArgs,        // object — example arguments (shown as JSON in rendered output)
  decision,        // object — decision point: { question, options: [{label, description}] }
  tips,            // string[] — guidance for the LLM
  parallelGroup,   // string — group ID for concurrent execution (adjacent steps with same ID)
  loopGroup,       // string — group ID for per-page iteration (adjacent steps with same ID)
  exhaustive,      // boolean — step needs ALL paginated records (renders pagination guidance)
  dependsOn,       // number[] — step order numbers that must complete first
  changeset,       // object — MCP client changeset integration: { mutating?: boolean, requiresPlan?: string }
}
```

```ts file=examples/workflow-creation-guide-02.ts
{
  order,           // number — step number (1-based, sequential)
  title,           // string — short step title
  description,     // string — what this step does (LLM reads this)
  tool,            // string — MCP tool name to call (e.g., 'find_records', 'search_records')
  toolArgs,        // object — example arguments (shown as JSON in rendered output)
  decision,        // object — decision point: { question, options: [{label, description}] }
  tips,            // string[] — guidance for the LLM
  parallelGroup,   // string — group ID for concurrent execution (adjacent steps with same ID)
  loopGroup,       // string — group ID for per-page iteration (adjacent steps with same ID)
  exhaustive,      // boolean — step needs ALL paginated records (renders pagination guidance)
  dependsOn,       // number[] — step order numbers that must complete first
  changeset,       // object — MCP client changeset integration: { mutating?: boolean, requiresPlan?: string }
}
```

Each step should have either `tool` (with optional `toolArgs`) or `decision`, not both. Steps with neither serve as analysis/planning steps where the LLM uses its own judgment.

## Step Types

### Tool Steps

The most common type. Tell the LLM which tool to call and provide example arguments:

```js file=examples/workflow-creation-guide-03.js
{
  order: 1,
  title: 'Find or create the theme',
  description:
    'Search for the top-level learning topic this session belongs to. If the theme does not exist yet, create it.',
  tool: 'find_records',
  toolArgs: {
    model: 'theme',
    search: { name: '<topic_name>' }
  },
  tips: [
    'Common themes: "Software Engineering", "Machine Learning", "DevOps"',
    'If no matching theme exists, use create_model to create one',
    'Note the theme ID — you need it for the category lookup in step 2'
  ]
}
```

```ts file=examples/workflow-creation-guide-03.ts
{
  order: 1,
  title: 'Find or create the theme',
  description:
    'Search for the top-level learning topic this session belongs to. If the theme does not exist yet, create it.',
  tool: 'find_records',
  toolArgs: {
    model: 'theme',
    search: { name: '<topic_name>' }
  },
  tips: [
    'Common themes: "Software Engineering", "Machine Learning", "DevOps"',
    'If no matching theme exists, use create_model to create one',
    'Note the theme ID — you need it for the category lookup in step 2'
  ]
}
```

- Use `<placeholder>` syntax in `toolArgs` for values the LLM must fill in
- The `toolArgs` are rendered as a JSON code block in the workflow output

### Decision Steps

Present the user with choices that affect workflow direction:

```js file=examples/workflow-creation-guide-04.js
{
  order: 4,
  title: 'Link learning resources',
  description:
    'Optionally associate books or repositories with this activity.',
  decision: {
    question: 'Would you like to link any learning resources to this session?',
    options: [
      { label: 'Link books', description: 'Search for books studied during this session' },
      { label: 'Link repositories', description: 'Search for code repositories worked on' },
      { label: 'Link both', description: 'Associate both books and repositories' },
      { label: 'Skip', description: 'No resources to link — finish the session log' }
    ]
  },
  tips: [
    'Use find_records to search for existing books or repositories',
    'You can always add links later by updating the activity'
  ]
}
```

```ts file=examples/workflow-creation-guide-04.ts
{
  order: 4,
  title: 'Link learning resources',
  description:
    'Optionally associate books or repositories with this activity.',
  decision: {
    question: 'Would you like to link any learning resources to this session?',
    options: [
      { label: 'Link books', description: 'Search for books studied during this session' },
      { label: 'Link repositories', description: 'Search for code repositories worked on' },
      { label: 'Link both', description: 'Associate both books and repositories' },
      { label: 'Skip', description: 'No resources to link — finish the session log' }
    ]
  },
  tips: [
    'Use find_records to search for existing books or repositories',
    'You can always add links later by updating the activity'
  ]
}
```

### Analysis Steps

Steps with no `tool` or `decision` — the LLM uses its own judgment:

```js file=examples/workflow-creation-guide-05.js
{
  order: 5,
  title: 'Plan next week',
  description:
    'Based on your review and decision, outline 2-3 planned activities for the coming week.',
  tips: [
    'Create activities with status "planned" for sessions you intend to do',
    'Consider creating activities for neglected themes first'
  ]
}
```

```ts file=examples/workflow-creation-guide-05.ts
{
  order: 5,
  title: 'Plan next week',
  description:
    'Based on your review and decision, outline 2-3 planned activities for the coming week.',
  tips: [
    'Create activities with status "planned" for sessions you intend to do',
    'Consider creating activities for neglected themes first'
  ]
}
```

### Mutation Steps

Steps that modify data. Use `changeset` to integrate with the MCP client's changeset system — a human-in-the-loop layer that intercepts mutating tool calls for user approval:

```js file=examples/workflow-creation-guide-06.js
{
  order: 7,
  title: 'Apply reclassifications',
  description:
    'Execute the approved reclassification plan using bulk_action_models.',
  tool: 'bulk_action_models',
  toolArgs: {
    model: 'activity',
    action: 'update',
    records: [
      { record_id: '<id>', theme_id: '<new_theme_id>', category_id: '<new_category_id>' }
    ],
    plan_id: '<plan_id_from_step_6>'
  },
  changeset: { mutating: true },
  tips: [
    'Include the plan_id from step 6 in the bulk_action_models call',
    'If more than 25 activities, split into multiple bulk calls'
  ]
}
```

```ts file=examples/workflow-creation-guide-06.ts
{
  order: 7,
  title: 'Apply reclassifications',
  description:
    'Execute the approved reclassification plan using bulk_action_models.',
  tool: 'bulk_action_models',
  toolArgs: {
    model: 'activity',
    action: 'update',
    records: [
      { record_id: '<id>', theme_id: '<new_theme_id>', category_id: '<new_category_id>' }
    ],
    plan_id: '<plan_id_from_step_6>'
  },
  changeset: { mutating: true },
  tips: [
    'Include the plan_id from step 6 in the bulk_action_models call',
    'If more than 25 activities, split into multiple bulk calls'
  ]
}
```

### Parallel Steps

Adjacent steps with the same `parallelGroup` are rendered as a group with a note to call them simultaneously:

```js file=examples/workflow-creation-guide-07.js
{
  order: 2,
  title: 'Fetch themes',
  tool: 'list_models',
  toolArgs: { model: 'theme' },
  parallelGroup: 'initial-data',
  tips: ['...']
},
{
  order: 3,
  title: 'Fetch categories',
  tool: 'list_models',
  toolArgs: { model: 'category' },
  parallelGroup: 'initial-data',
  dependsOn: [],
  tips: ['...']
}
```

```ts file=examples/workflow-creation-guide-07.ts
{
  order: 2,
  title: 'Fetch themes',
  tool: 'list_models',
  toolArgs: { model: 'theme' },
  parallelGroup: 'initial-data',
  tips: ['...']
},
{
  order: 3,
  title: 'Fetch categories',
  tool: 'list_models',
  toolArgs: { model: 'category' },
  parallelGroup: 'initial-data',
  dependsOn: [],
  tips: ['...']
}
```

Use `dependsOn` to express dependencies between steps when parallelism is involved.

### Loop Steps

Adjacent steps with the same `loopGroup` iterate together per page. Use this when an exhaustive data fetch must be paired with a processing step per page (e.g., fetch page → store analysis → fetch next page):

```js file=examples/workflow-creation-guide-08.js
{
  order: 2,
  title: 'Fetch activities for reclassification',
  description: 'Retrieve activity data for analysis.',
  tool: 'search_records',
  toolArgs: { model: 'activity' },
  exhaustive: true,
  loopGroup: 'fetch-analyze',
  tips: ['...']
},
{
  order: 3,
  title: 'Analyze and categorize findings',
  description: 'Store findings as analysis memories for this page.',
  tool: 'store_analysis_memory',
  loopGroup: 'fetch-analyze',
  tips: ['...']
}
```

```ts file=examples/workflow-creation-guide-08.ts
{
  order: 2,
  title: 'Fetch activities for reclassification',
  description: 'Retrieve activity data for analysis.',
  tool: 'search_records',
  toolArgs: { model: 'activity' },
  exhaustive: true,
  loopGroup: 'fetch-analyze',
  tips: ['...']
},
{
  order: 3,
  title: 'Analyze and categorize findings',
  description: 'Store findings as analysis memories for this page.',
  tool: 'store_analysis_memory',
  loopGroup: 'fetch-analyze',
  tips: ['...']
}
```

The renderer groups these steps and instructs the LLM:

- Execute all steps in the group
- Check `pagination.total_pages` from the search response
- If more pages, repeat the group with the next page number
- When all pages processed, advance to the next step

Use `exhaustive: true` on the data-fetching step within the loop to trigger pagination guidance. Steps without `exhaustive` in the group are processing steps that run once per page.

## Tool Selection: Data Tools vs View Tools

The prompt-chaining approach (`suggest_workflow` → `get_workflow_step`) scopes the LLM to one step's tool at a time, which greatly reduces substitution risk. Additionally, the workflow renderer auto-generates dynamic exclusion warnings for data tools, listing the actual registered app tool names. Vocabulary alignment in step descriptions remains important as a secondary defense.

### The problem

Data tools and view tools occupy overlapping semantic space:

| Data tool        | View tool            | Shared semantics              |
| ---------------- | -------------------- | ----------------------------- |
| `list_models`    | `list_records_app`   | "list", "show", "browse"      |
| `search_records` | `search_records_app` | "search", "find", "filter"    |
| `find_records`   | `find_records_app`   | "view", "see", "show details" |

The LLM treats `_view` tools as strictly better (same data + visual UI), so it will substitute them unless the workflow step explicitly steers it away.

### Rules

**1. Use data tools in workflow steps, not `_view` tools.**

Data tools (`list_models`, `search_records`, `find_records`) return raw JSON for programmatic use. View tools (`list_records_app`, `search_records_app`, `find_records_app`) render interactive MCP Apps. Workflows need data, not UI.

```js file=examples/workflow-creation-guide-09.js
// WRONG — opens an interactive table when you just need the data
tool: 'list_records_app'

// CORRECT — returns raw JSON for the LLM to process
tool: 'list_models'
```

```ts file=examples/workflow-creation-guide-09.ts
// WRONG — opens an interactive table when you just need the data
tool: 'list_records_app'

// CORRECT — returns raw JSON for the LLM to process
tool: 'list_models'
```

**2. Step descriptions must use data-tool vocabulary, not view-tool vocabulary.**

The LLM matches step descriptions against tool descriptions. Words like "browse", "visually review", "display" match `_view` tools. Words like "fetch", "retrieve", "get data" match data tools.

```js file=examples/workflow-creation-guide-10.js
// WRONG — "browse" semantically matches search_records_app
description: 'Browse all activities to identify misclassified ones.'

// CORRECT — "retrieve" semantically matches search_records
description: 'Retrieve activity data to identify records with incorrect assignments.'
```

```ts file=examples/workflow-creation-guide-10.ts
// WRONG — "browse" semantically matches search_records_app
description: 'Browse all activities to identify misclassified ones.'

// CORRECT — "retrieve" semantically matches search_records
description: 'Retrieve activity data to identify records with incorrect assignments.'
```

| Avoid (matches `_view` tools) | Use instead (matches data tools) |
| ----------------------------- | -------------------------------- |
| browse, display, show         | fetch, retrieve, get             |
| visually review, view records | check, examine, inspect data     |
| search for, find and select   | query, filter, look up           |

**3. Step titles should use neutral or data-oriented verbs.**

```js file=examples/workflow-creation-guide-11.js
// WRONG
title: 'Browse activities to reclassify'

// CORRECT
title: 'Fetch activities for reclassification'
```

```ts file=examples/workflow-creation-guide-11.ts
// WRONG
title: 'Browse activities to reclassify'

// CORRECT
title: 'Fetch activities for reclassification'
```

### When to use `_view` tools

Use `_view` tools only when the workflow **intentionally** wants to render an interactive UI for the user — e.g., a browsing step where the user should select records visually. In that case, the step description should use view vocabulary ("Browse and select records visually").

## Workflow Patterns

### Simple Linear

5 steps, 1 decision, no mutations. Most workflows follow this pattern.

**Example:** `log_study_session` — find theme → find category → create activity → link resources (decision) → review

Key traits:

- Each step feeds data to the next (theme ID → category lookup → activity creation)
- One optional decision point for branching
- Final review step to confirm the result

### Analysis Pipeline

Search → aggregate → visualize → decide → act. For workflows that analyze data before acting.

**Example:** `weekly_learning_review` — search activities → store analysis memories → render diagram → identify gaps (decision) → plan

Key traits:

- Uses `store_analysis_memory` and `recall_analysis_memories` for intermediate state
- `render_diagram` for visualization
- Decision based on analysis results

### Draft-Required Mutations

For workflows that preview bulk changes before applying them.

**Example:** `reclassify_activities` — review themes → search activities → analyze → recall → decide scope (decision) → preview draft → apply

Key traits:

- `draftRequired: true` on the workflow definition
- `mutationPlans` object defining named plans
- Step with `preview_mutation_plan` tool
- Final step with `mutating: true` and `requiresPlan`

## Writing Effective Tips

Tips are **LLM guidance** — they help the model make better decisions during execution. They are NOT user-facing documentation.

### Do

- **Reference specific tools:** `'Use find_records to search existing tags before creating new ones'`
- **Reference data from previous steps:** `'Use the theme_id from step 1'`
- **Warn about common mistakes:** `'If more than 25 activities, split into multiple bulk calls'`
- **Suggest fallback actions:** `'If no matching theme exists, use create_model to create one'`
- **Include domain knowledge:** `'Status options: unread, reading, completed, on_hold, abandoned'`

### Don't

- Don't write generic tips that apply to everything (`'Be careful'`, `'Double-check your work'`)
- Don't duplicate information already in the step description
- Don't write tips for the user — they won't see these; only the LLM reads them
- Don't include more than 5 tips per step — keep them focused

## Writing Effective Decisions

Decisions let the user steer the workflow at key branching points.

### Guidelines

- **2-4 options** — more than 4 is overwhelming
- **Distinct outcomes** — each option should lead to meaningfully different behavior
- **Include a skip/minimal option** when the step is optional
- **Frame as a question** — `decision.question` should be a clear, direct question
- **Short labels** — 2-4 words per option label
- **Descriptive text** — `option.description` explains what happens if chosen

### Good example

```js file=examples/workflow-creation-guide-12.js
decision: {
  question: 'How would you like to handle status updates?',
  options: [
    { label: 'Update individually', description: 'Review and update each book one at a time' },
    { label: 'Bulk update selected', description: 'Apply the same status change to all selected books' },
    { label: 'Skip status updates', description: 'Statuses look good — move on to tags and locations' }
  ]
}
```

```ts file=examples/workflow-creation-guide-12.ts
decision: {
  question: 'How would you like to handle status updates?',
  options: [
    { label: 'Update individually', description: 'Review and update each book one at a time' },
    { label: 'Bulk update selected', description: 'Apply the same status change to all selected books' },
    { label: 'Skip status updates', description: 'Statuses look good — move on to tags and locations' }
  ]
}
```

## Mutation Plans & Drafts

Use mutation plans when a workflow makes bulk changes that should be previewed before execution.

### When to use

- Bulk updates affecting many records
- Irreversible or hard-to-undo operations
- Changes where the user needs to review individual entries before approving

### Configuration

On the `WorkflowDefinition`:

```js file=examples/workflow-creation-guide-13.js
new WorkflowDefinition({
  name: 'reclassify_activities',
  // ...
  draftRequired: true,
  mutationPlans: {
    'reclassification-plan': {
      title: 'Activity Reclassification',
      description: 'Review all proposed theme/category changes before applying',
      targetModels: ['activity'],
      expectedActions: ['update']
    }
  },
  steps: [
    // ... earlier steps gather data ...
    {
      order: 6,
      title: 'Preview the reclassification plan',
      tool: 'preview_mutation_plan',
      toolArgs: {
        plan_title: 'Activity Reclassification',
        plan_name: 'reclassification-plan',
        entries: [
          {
            action: 'update',
            model: 'activity',
            record_id: '<activity_id>',
            description: 'Move from <current> to <new>',
            attributes: { theme_id: '<id>', category_id: '<id>' }
          }
        ]
      },
      changeset: { requiresPlan: 'reclassification-plan' },
      tips: ['Build entries from the analysis in previous steps']
    },
    {
      order: 7,
      title: 'Apply reclassifications',
      tool: 'bulk_action_models',
      toolArgs: {
        model: 'activity',
        action: 'update',
        records: [{ record_id: '<id>', theme_id: '<id>', category_id: '<id>' }],
        plan_id: '<plan_id_from_step_6>'
      },
      changeset: { mutating: true },
      tips: ['Include the plan_id from step 6']
    }
  ]
})
```

```ts file=examples/workflow-creation-guide-13.ts
new WorkflowDefinition({
  name: 'reclassify_activities',
  // ...
  draftRequired: true,
  mutationPlans: {
    'reclassification-plan': {
      title: 'Activity Reclassification',
      description: 'Review all proposed theme/category changes before applying',
      targetModels: ['activity'],
      expectedActions: ['update']
    }
  },
  steps: [
    // ... earlier steps gather data ...
    {
      order: 6,
      title: 'Preview the reclassification plan',
      tool: 'preview_mutation_plan',
      toolArgs: {
        plan_title: 'Activity Reclassification',
        plan_name: 'reclassification-plan',
        entries: [
          {
            action: 'update',
            model: 'activity',
            record_id: '<activity_id>',
            description: 'Move from <current> to <new>',
            attributes: { theme_id: '<id>', category_id: '<id>' }
          }
        ]
      },
      changeset: { requiresPlan: 'reclassification-plan' },
      tips: ['Build entries from the analysis in previous steps']
    },
    {
      order: 7,
      title: 'Apply reclassifications',
      tool: 'bulk_action_models',
      toolArgs: {
        model: 'activity',
        action: 'update',
        records: [{ record_id: '<id>', theme_id: '<id>', category_id: '<id>' }],
        plan_id: '<plan_id_from_step_6>'
      },
      changeset: { mutating: true },
      tips: ['Include the plan_id from step 6']
    }
  ]
})
```

### Data flow

1. `mutationPlans` declares the plan name and metadata
2. The preview step calls `preview_mutation_plan` with `plan_name` matching the key
3. The preview tool returns a `plan_id` (UUID)
4. The mutation step includes `plan_id` as a top-level tool argument for batch tracking
5. The MCP client reads `plan_id` from intercepted tool arguments and groups mutations in the changeset panel for batch approval

### Changeset integration

The `plan_id` integrates with the MCP client's changeset system — a human-in-the-loop layer that intercepts all mutating tool calls (`create_model`, `update_model`, `delete_model`, `bulk_action_models`) before execution and presents them for user approval.

When mutations include a `plan_id`, the MCP client groups them in the changeset panel so the user can approve or reject the entire plan with one click. The contract is minimal: MCP servers include `plan_id` as a top-level tool argument, and the MCP client reads it — no coordination or shared state required.

`preview_mutation_plan` is a built-in local tool provided by the MCP client — all connected MCP servers get it for free without any registration.

## Registration

### File location

```
src/<server>/domain/workflows/<workflow-name>.js
```

### Export pattern

```js file=src/my-workflows.js
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

export const myWorkflows = [
  new WorkflowDefinition({
    name: 'my_workflow',
    title: 'My Workflow'
    // ...
  })
]
```

```ts file=src/my-workflows.ts
import { WorkflowDefinition } from '#src/mcp/domain/workflows.js'

export const myWorkflows = [
  new WorkflowDefinition({
    name: 'my_workflow',
    title: 'My Workflow'
    // ...
  })
]
```

A file can export multiple workflow definitions in the array.

### Registry registration

Add the import and spread into the `WorkflowRegistry` in `src/<server>/domain/registry.js`:

```js file=src/registries/create-engineer-domain-registry.js
import { myWorkflows } from './workflows/my-workflow.js'

export function createEngineerDomainRegistry() {
  const workflows = new WorkflowRegistry([...existingWorkflows, ...myWorkflows])
  // ...
}
```

```ts file=src/registries/create-engineer-domain-registry.ts
import { myWorkflows } from './workflows/my-workflow.js'

export function createEngineerDomainRegistry() {
  const workflows = new WorkflowRegistry([...existingWorkflows, ...myWorkflows])
  // ...
}
```

## Checklist for New Workflows

- [ ] `name` is unique, snake_case, and descriptive
- [ ] `description` contains searchable keywords for goal-based discovery
- [ ] `tags` reuse existing tags where applicable
- [ ] `models` lists all models the workflow touches
- [ ] Steps have sequential `order` values starting from 1
- [ ] Each step has a clear `title` (short) and `description` (what the LLM should do)
- [ ] Data-fetching steps use data tools (`list_models`, `search_records`, `find_records`), not `_view` tools
- [ ] Step descriptions use data-tool vocabulary ("fetch", "retrieve") — not "browse", "display", "view"
- [ ] Data-fetching steps that need ALL records use `exhaustive: true`
- [ ] Steps that loop per page use `loopGroup` with a shared group ID (adjacent steps only)
- [ ] Tool steps include `tool` and realistic `toolArgs` with `<placeholder>` values
- [ ] Tips reference specific tools, previous step data, and domain knowledge
- [ ] Decision steps have 2-4 distinct options with a skip option when appropriate
- [ ] Mutation steps use `changeset: { mutating: true }` and `changeset: { requiresPlan: '...' }` when draft preview is needed
- [ ] `draftRequired` and `mutationPlans` are set if the workflow includes bulk mutations
- [ ] Workflow is exported and registered in the domain registry
- [ ] JSDoc comment at the top of the file describes the workflow's purpose
