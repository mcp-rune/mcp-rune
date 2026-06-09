> **Customization:** register your `BaseTool` subclass via `toolClasses:` on `ToolRegistry`.
> Your tool receives `this.dataLayer`, `this.modelLayer`, `this.analysisLayer` automatically. The framework handles dispatch, schema validation, interceptors, and result envelopes.

# Tool creation

The previous chapter covered the nine polymorphic tools the framework ships. This chapter covers the other path: writing a `BaseTool` subclass when your operation is _not_ uniform across models — a bespoke verb like "cancel a subscription", "retry a payment", or "recompute a leaderboard".

Every tool you write consumes the three layers from the chapter before that one (`this.dataLayer`, `this.modelLayer`, `this.analysisLayer`). The framework provides the dispatch, the schema validation, the interceptor pipeline, and the result envelope — your subclass only fills in the bespoke logic.

## Overview

Tools are the primary way MCP servers expose functionality to AI agents. Each tool:

- Has a unique name (snake_case)
- Provides a description for LLM understanding
- Defines an input schema (JSON Schema)
- Executes an action and returns results

## Tool Architecture

Tools follow a two-layer architecture: **generic tools** in mcp-rune for cross-server reuse, and **server-specific tools** in your server's `tools/` directory.

<!-- illustration: tool-creation#tree -->

```
mcp-rune/src/mcp/tools/
├── base-tool.ts              # BaseTool — root base class (with serverContext)
├── save-model-base-tool.ts   # SaveModelBaseTool — base for create/update tools
├── tool-registry.ts          # ToolRegistry — convention-based tool registration
├── tool-pipeline.ts          # ToolInterceptor + wrapToolHandler
├── interceptors.ts           # Built-in interceptors (logging, tracing, error-catch)
├── validators.ts             # Generic model validators
├── categories.ts             # Tool category definitions
└── data/                     # Generic CRUD tools (reusable across servers)
    ├── list-models-tool.ts
    ├── find-records-tool.ts
    ├── create-model-tool.ts
    ├── update-model-tool.ts
    └── delete-model-tool.ts

your-server/tools/
├── base-tool.js              # ServerBaseTool — extends mcp-rune BaseTool
├── registry.js               # Factory using mcp-rune ToolRegistry
└── {custom}-tool.js          # Server-specific tools only
```

### Inheritance Chain

<!-- illustration: tool-creation#inherit -->

```
BaseTool (mcp-rune)
  ├── data/*.ts (generic CRUD tools, from mcp-rune)
  └── ServerBaseTool (your server)
        └── {custom}-tool.js (server-specific tools)
```

### Generic CRUD Tools

The following CRUD tools are provided in `lib/mcp/tools/crud/` and shared across all servers:

| Tool           | Description                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_models`  | Lists available models with attributes and associations                                                                                              |
| `find_records` | Finds records by ID or search criteria with pagination. Supports compound IDs for nested resources and `parent_path` for listing nested collections. |
| `create_model` | Creates records with model-key payload wrapping. Supports `parent_path` for nested model creation.                                                   |
| `update_model` | Updates records with model-key payload wrapping. Supports compound IDs.                                                                              |
| `delete_model` | Deletes records by ID. Supports compound IDs.                                                                                                        |

These tools are completely generic — they have zero server-specific logic. They receive their configuration (models, serverContext) via constructor dependency injection.

### How tools reach data

Tools call **only** the three peer interfaces from [chapter 4](./the-three-layers.md): `this.dataLayer`, `this.modelLayer`, `this.analysisLayer`. The diagram below shows the historical decomposition behind `DataLayer` — `ModelService` (the default `DataLayer` implementation) composes `EndpointResolver` + convention + `ApiClient`, and `SearchEnabledDataLayer` adds search/lookup on top — but **projection-layer code (tools, apps) must not reference these names directly**; the eslint guard rejects it. Use the three layers; the rest is internal.

<!-- illustration: tool-creation#service -->

```
┌─────────────────────────────────────────────────┐
│  MCP Tool Layer                                  │
│  (input validation, response formatting,         │
│   vector storage, usage rules)                   │
└──────────────┬──────────────────┬───────────────┘
               │                  │
    ┌──────────▼──────┐  ┌───────▼────────┐
    │  ModelService    │  │  SearchService  │
    │  (CRUD ops)      │  │  (search/lookup)│
    └──────┬───┬──────┘  └───────┬────────┘
           │   │                 │
    ┌──────▼┐ ┌▼──────────┐ ┌───▼──────────┐
    │Endpoint│ │Convention │ │SearchRequestShaper  │
    │Resolver│ │(payload/  │ │(query body   │
    │(URLs)  │ │ response) │ │ building)    │
    └──────┬┘ └─────┬─────┘ └───┬──────────┘
           │        │            │
           └────────┼────────────┘
                    │
              ┌─────▼─────┐
              │ ApiClient  │
              │ (HTTP)     │
              └────────────┘
```

Tools receive services via dependency injection through `ToolRegistry` (see [Tool Registration](#tool-registration) below).

See [The three layers](./the-three-layers.md) for full details on `DataLayer` (the per-request backend seam), `ModelLayer` (per-model-bound model-config reads), and `AnalysisLayer` (per-model analysis projections) — the three peer interfaces every tool consumes through DI.

### Tool Pipeline

Every tool call passes through the same interceptor pipeline before reaching your `execute()`:

<!-- illustration: tool-creation#pipeline -->

```
   MCP request: { tool: "create_model", args: {...} }
                              │
                              ▼
       ┌─────────────────────────────────────────────┐
       │  wrapToolHandler(handler, [interceptors])   │
       └─────────────────────────────────────────────┘
                              │
                              ▼
       ┌─────────────────────────────────────────────┐
       │  loggingInterceptor     (start, args)       │  ← before
       └──────────────────────┬──────────────────────┘
                              ▼
       ┌─────────────────────────────────────────────┐
       │  tracingInterceptor     (span open)         │  ← before
       └──────────────────────┬──────────────────────┘
                              ▼
       ┌─────────────────────────────────────────────┐
       │  errorInterceptor       (try { ... } catch) │  ← around
       │   ┌─────────────────────────────────────┐   │
       │   │  YourTool.execute(args, context)    │   │  ← your code
       │   │   - input validation                │   │
       │   │   - service calls (DataLayer)       │   │
       │   │   - return shaped result            │   │
       │   └─────────────────────────────────────┘   │
       │                                             │
       │   catch → MCP-shaped error response         │
       └─────────────────────────────────────────────┘
                              │
                              ▼  result or error response
       ┌─────────────────────────────────────────────┐
       │  tracingInterceptor     (span close)        │  ← after
       │  loggingInterceptor     (duration, status)  │  ← after
       └──────────────────────┬──────────────────────┘
                              ▼
                       MCP response
```

Built-in interceptors (`loggingInterceptor`, `tracingInterceptor`, `errorInterceptor`) cover the common cases. Add your own via `ToolRegistry` to insert tenant-scoped header injection, rate limiting, or audit logging — the pipeline is composable and runs in declaration order.

## Tool Categories

Tools are organized by category which determines authentication requirements:

| Category       | Auth Required | Description                                             |
| -------------- | ------------- | ------------------------------------------------------- |
| `STRATEGY`     | No            | Prompt strategies (get_prompt_guide, etc.)              |
| `DATA`         | Yes           | API operations — generic CRUD tools                     |
| `AUTOCOMPLETE` | Yes           | Field value suggestions                                 |
| `ANALYSIS`     | No            | Qualitative data analysis (requires vector storage)     |
| `OPERATIONS`   | No            | CRUD operation retrospectives (requires vector storage) |
| `DOMAIN`       | No            | Domain intelligence (concepts, rules, workflows)        |
| `CUSTOM`       | Varies        | Server-specific behavior                                |

> **Shared embedding infrastructure:** Both `ANALYSIS`/`OPERATIONS` and `DOMAIN` categories use the same embedding service (MiniLM-L6-v2, 384 dims) and cosine similarity. ANALYSIS/OPERATIONS tools store embeddings in pgvector. DOMAIN tools keep embeddings in memory for semantic search over concepts, workflows, and diagrams.

### Setting Tool Category

Override the static `category` property:

```js file=src/tools/my-tool.js
import { TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'

export class MyTool extends ServerBaseTool {
  static get category() {
    return TOOL_CATEGORIES.STRATEGY
  } // No auth required
  // ...
}
```

```ts file=src/tools/my-tool.ts
import { TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'

export class MyTool extends ServerBaseTool {
  static get category() {
    return TOOL_CATEGORIES.STRATEGY
  } // No auth required
  // ...
}
```

Default category is `DATA` (requires authentication).

### Overriding `requiresAuth` per tool

Most tools inherit the auth requirement from their category. When a tool needs to depart from the category default — for example, an `ANALYSIS` tool that fetches records from the upstream API and therefore needs auth despite the category being vector-storage-gated — declare a per-tool override as a static field:

```ts file=src/tools/analysis-ingest-tool.ts
import { BaseTool, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'

export class AnalysisIngestTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.ANALYSIS
  }
  // ANALYSIS defaults to no-auth; this tool fetches from the API, so opts in.
  static override requiresAuth = true
}
```

```js file=src/tools/analysis-ingest-tool.js
import { BaseTool, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'

export class AnalysisIngestTool extends BaseTool {
  static get category() {
    return TOOL_CATEGORIES.ANALYSIS
  }
  // ANALYSIS defaults to no-auth; this tool fetches from the API, so opts in.
  static requiresAuth = true
}
```

`ToolRegistry` resolves the effective auth requirement through `ToolCls.getRequiresAuth()`, which returns the per-tool field if set or falls back to `getCategoryConfig(category).requiresAuth` otherwise. Always call `getRequiresAuth()` rather than reading `requiresAuth` directly — unset tools have `requiresAuth === undefined` and only the helper applies the category default.

## Multi-product disambiguation (deployer recipe)

When multiple MCP servers are connected to the same AI agent, tool names may overlap and the LLM needs a hint about which product a tool belongs to. mcp-rune does not bake an opinionated disambiguation paragraph into core; instead, deployers add it themselves by overriding `getUsageRules()` in their server-specific base tool class.

```ts file=examples/tool-creation-guide-03.ts
override getUsageRules(): string[] {
  const rules = super.getUsageRules()
  const { name } = this.serverContext
  if (name) {
    rules.push(
      `IMPORTANT: This tool operates on ${name} specifically. ` +
      `If the user has not specified which application to use, ` +
      `confirm they intend to use this application before proceeding.`
    )
  }
  return rules
}
```

```js file=examples/tool-creation-guide-03.js
getUsageRules() {
  const rules = super.getUsageRules()
  const { name } = this.serverContext
  if (name) {
    rules.push(
      `IMPORTANT: This tool operates on ${name} specifically. ` +
      `If the user has not specified which application to use, ` +
      `confirm they intend to use this application before proceeding.`
    )
  }
  return rules
}
```

Tailor the wording to your product. Add product-line callouts, "X is the Y application" descriptors, or compliance language as your deployment requires — the framework stays out of the way.

## Model Associations

Models define relationships using the `associations` property with `belongsTo`, `hasMany`, and `custom`:

```js file=examples/tool-creation-guide-02.js
static associations = {
  belongsTo: {
    theme: { rel: 'theme', target_model: 'theme' }
  },
  hasMany: {
    activities: { rel: 'activities', target_model: 'activity' }
  }
}
```

```ts file=examples/tool-creation-guide-02.ts
static associations = {
  belongsTo: {
    theme: { rel: 'theme', target_model: 'theme' }
  },
  hasMany: {
    activities: { rel: 'activities', target_model: 'activity' }
  }
}
```

The `list_models` tool exposes these associations in its output. Nested resources are accessed via `find_records` with compound IDs (e.g., `titles/42/assets/7`) or the `parent_path` parameter for listing nested collections.

## Generic Validators

`lib/mcp/tools/validators.js` provides reusable validation functions:

| Function                   | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `validateSearchParams()`   | Validates search params against a model's searchable fields  |
| `validateNestedResource()` | Validates nested resource relationships using `associations` |

## Tool Registration

### ToolRegistry

`ToolRegistry` from `@mcp-rune/mcp-rune/tools` handles all registration boilerplate: schema validation, auth wrapping per tool category, tracing, logging, and error catching.

```js file=src/registries/tool-registry.js
import { ToolRegistry, DATA_TOOL_CLASSES, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'
import { STRATEGY_TOOL_CLASSES } from '@mcp-rune/mcp-rune/prompts'

const toolRegistry = new ToolRegistry({
  toolClasses: {
    ...DATA_TOOL_CLASSES,
    ...STRATEGY_TOOL_CLASSES,
    my_custom_tool: MyCustomTool
  },
  models: MODEL_CLASSES,
  serverContext: { name: 'My Server', namespace: 'my-server' },
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  promptRegistry,
  // Feature gates: disable categories when their dependencies are unavailable
  gates: {
    [TOOL_CATEGORIES.ANALYSIS]: vectorStorage.isVectorStorageEnabled(),
    [TOOL_CATEGORIES.DOMAIN]: !!domainRegistry
  }
})
```

```ts file=src/registries/tool-registry.ts
import { ToolRegistry, DATA_TOOL_CLASSES, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'
import { STRATEGY_TOOL_CLASSES } from '@mcp-rune/mcp-rune/prompts'

const toolRegistry = new ToolRegistry({
  toolClasses: {
    ...DATA_TOOL_CLASSES,
    ...STRATEGY_TOOL_CLASSES,
    my_custom_tool: MyCustomTool
  },
  models: MODEL_CLASSES,
  serverContext: { name: 'My Server', namespace: 'my-server' },
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  promptRegistry,
  // Feature gates: disable categories when their dependencies are unavailable
  gates: {
    [TOOL_CATEGORIES.ANALYSIS]: vectorStorage.isVectorStorageEnabled(),
    [TOOL_CATEGORIES.DOMAIN]: !!domainRegistry
  }
})
```

For each tool, ToolRegistry automatically:

1. Creates a definition instance to read `description`, `inputSchema`, and `annotations`
2. Validates the schema at startup (skips broken tools instead of crashing)
3. Registers with `mcpServer.registerTool()` including annotations
4. Wraps the handler with the interceptor chain: logging -> custom interceptors -> error-catch
5. Wraps everything in `traceToolCall()` as the outermost layer
6. Creates an authenticated API client per invocation for `requiresAuth` tools

### Tool Interceptors

Interceptors add cross-cutting concerns to all tool executions. ToolRegistry applies built-in interceptors automatically and accepts custom ones:

```js file=src/audit-interceptor.js
const auditInterceptor = {
  name: 'audit',
  before(ctx) {
    ctx.meta.startedAt = Date.now()
  },
  after(ctx, result) {
    auditLog.write({
      tool: ctx.toolName,
      args: ctx.args,
      duration: Date.now() - ctx.meta.startedAt
    })
    return result
  },
  onError(ctx, error) {
    auditLog.write({ tool: ctx.toolName, error: error.message })
    // Return void to let the error propagate
  }
}

const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  interceptors: [auditInterceptor]
})
```

```ts file=src/audit-interceptor.ts
const auditInterceptor = {
  name: 'audit',
  before(ctx) {
    ctx.meta.startedAt = Date.now()
  },
  after(ctx, result) {
    auditLog.write({
      tool: ctx.toolName,
      args: ctx.args,
      duration: Date.now() - ctx.meta.startedAt
    })
    return result
  },
  onError(ctx, error) {
    auditLog.write({ tool: ctx.toolName, error: error.message })
    // Return void to let the error propagate
  }
}

const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  interceptors: [auditInterceptor]
})
```

**Execution order:**

- `before` hooks run in declared order: `[logging, custom1, custom2, error-catch]`
- `after` hooks run in reverse order: `[error-catch, custom2, custom1, logging]`
- `onError` hooks run in reverse order; the first to return a `ToolResult` recovers from the error

**Built-in interceptors** (applied automatically by ToolRegistry):

| Interceptor          | Purpose                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `loggingInterceptor` | Logs tool call start and errors with configurable `logContext`     |
| `errorInterceptor`   | Catches unhandled errors, returns `{ isError: true }` MCP response |

Tracing via `traceToolCall()` wraps the entire interceptor chain externally.

**Manual composition** — for tools registered outside ToolRegistry:

```js file=src/handler.js
import { wrapToolHandler, loggingInterceptor, errorInterceptor } from '@mcp-rune/mcp-rune/tools'

const handler = wrapToolHandler(
  'my_tool',
  [loggingInterceptor(), errorInterceptor()],
  async (args) => {
    return tool.execute(args)
  }
)
```

```ts file=src/handler.ts
import { wrapToolHandler, loggingInterceptor, errorInterceptor } from '@mcp-rune/mcp-rune/tools'

const handler = wrapToolHandler(
  'my_tool',
  [loggingInterceptor(), errorInterceptor()],
  async (args) => {
    return tool.execute(args)
  }
)
```

## Creating a New Tool

### Server-Specific Tools

For tools with server-specific logic:

#### 1. Create the Tool Class

```js file=src/tools/my-new-tool.js
import { ServerBaseTool } from './base-tool.js'

export class MyNewTool extends ServerBaseTool {
  get name() {
    return 'my_new_tool'
  }

  get baseDescription() {
    return `Brief description of what the tool does.

Include:
- What it returns
- When to use it
- Any important constraints`
  }

  get inputSchema() {
    return {
      type: 'object',
      properties: {
        required_param: {
          type: 'string',
          description: 'Description of this parameter'
        }
      },
      required: ['required_param']
    }
  }

  async execute(args) {
    try {
      this.requireApiClient()
      const { required_param } = args
      const data = await this.apiClient.get(`endpoint/${required_param}`)
      return this.formatResponse(data)
    } catch (error) {
      return this.formatError(error)
    }
  }
}
```

```ts file=src/tools/my-new-tool.ts
import { ServerBaseTool } from './base-tool.js'

export class MyNewTool extends ServerBaseTool {
  get name() {
    return 'my_new_tool'
  }

  get baseDescription() {
    return `Brief description of what the tool does.

Include:
- What it returns
- When to use it
- Any important constraints`
  }

  get inputSchema() {
    return {
      type: 'object',
      properties: {
        required_param: {
          type: 'string',
          description: 'Description of this parameter'
        }
      },
      required: ['required_param']
    }
  }

  async execute(args) {
    try {
      this.requireApiClient()
      const { required_param } = args
      const data = await this.apiClient.get(`endpoint/${required_param}`)
      return this.formatResponse(data)
    } catch (error) {
      return this.formatError(error)
    }
  }
}
```

#### 2. Register the Tool

Add to the `toolClasses` map in your `ToolRegistry` configuration:

```js file=src/registries/tool-registry.js
const toolRegistry = new ToolRegistry({
  toolClasses: {
    ...DATA_TOOL_CLASSES,
    my_new_tool: MyNewTool
  }
  // ...
})
```

```ts file=src/registries/tool-registry.ts
const toolRegistry = new ToolRegistry({
  toolClasses: {
    ...DATA_TOOL_CLASSES,
    my_new_tool: MyNewTool
  }
  // ...
})
```

#### 3. Add Tests

Create `__tests__/tools/my-new-tool.spec.js`.

### Generic Tools (in mcp-rune)

For tools that are reusable across servers, create them in `src/mcp/tools/`:

```ts file=src/tools/my-generic-tool.ts
import { BaseTool } from './base-tool.js'

export class MyGenericTool extends BaseTool {
  // Extend BaseTool directly (not server-specific base)
}
```

```js file=src/tools/my-generic-tool.js
import { BaseTool } from './base-tool.js'
export class MyGenericTool extends BaseTool {}
```

## Tool Base Class Methods

### Required Overrides

| Method                  | Description                |
| ----------------------- | -------------------------- |
| `get name()`            | Tool name (snake_case)     |
| `get baseDescription()` | Tool description for LLM   |
| `get inputSchema()`     | JSON Schema for parameters |
| `execute(args)`         | Main execution logic       |

### Available Helpers

| Method                       | Description                                                          |
| ---------------------------- | -------------------------------------------------------------------- |
| `requireApiClient()`         | Throws if not authenticated                                          |
| `this.modelService`          | ModelService instance (optional, for CRUD)                           |
| `formatResponse(data)`       | Wrap successful response                                             |
| `formatError(error)`         | Wrap error response (delegates to convention for structured parsing) |
| `storeToolMemory(params)`    | Fire-and-forget vector storage of tool operations                    |
| `validateModel(name)`        | Check model exists in config                                         |
| `getModelConfig(name)`       | Get model configuration                                              |
| `getModelEnum()`             | Get list of available models                                         |
| `truncateString(s, n)`       | Truncate string to max length                                        |
| `sanitizeResponseData(data)` | JSON stringify for display                                           |

### Optional Overrides

| Method                  | Description                         |
| ----------------------- | ----------------------------------- |
| `static get category()` | Tool category (auth requirements)   |
| `getUsageRules()`       | Add behavioral rules to description |

## Best Practices

### Naming Conventions

- Tool names: `snake_case` (e.g., `find_records`, `create_model`)
- Tool classes: `PascalCase` + `Tool` suffix (e.g., `FindRecordsTool`)
- File names: `kebab-case` + `-tool.js` (e.g., `find-records-tool.js`)

### Descriptions

Write descriptions that help LLMs understand:

1. **What** the tool does (first line)
2. **When** to use it (use cases)
3. **What** it returns (response structure)
4. **Constraints** (limits, requirements)

### Error Handling

Always wrap execute logic in try/catch:

```js file=examples/tool-creation-guide-09.js
async execute(args) {
  try {
    this.requireApiClient()
    // ... tool logic
    return this.formatResponse(data)
  } catch (error) {
    return this.formatError(error)
  }
}
```

```ts file=examples/tool-creation-guide-09.ts
async execute(args) {
  try {
    this.requireApiClient()
    // ... tool logic
    return this.formatResponse(data)
  } catch (error) {
    return this.formatError(error)
  }
}
```

`formatError()` delegates to the model's API convention to parse structured error responses into LLM-optimized text. The convention's `parseErrorResponse()` extracts field-level errors, and the tool layer joins them with semicolons and appends the HTTP status inline:

```
title: can't be blank; status: is not included in the list (422)
```

No "Error:" prefix is added — `isError: true` on the MCP response already signals it.

### Tool Memory (Vector Storage)

Write tools that modify data should record operations for retrospective analysis using `storeToolMemory()`:

```js file=src/data.js
const data = await service.create(model, attributes, options)

this.storeToolMemory({
  toolName: 'create_model',
  toolArgs: { model, attributes },
  toolOutput: data,
  userId: user_id
})
```

```ts file=src/data.ts
const data = await service.create(model, attributes, options)

this.storeToolMemory({
  toolName: 'create_model',
  toolArgs: { model, attributes },
  toolOutput: data,
  userId: user_id
})
```

This is fire-and-forget — it never blocks the tool response. The `sessionId` is extracted automatically from `this.serverContext`. If vector storage is not configured, the call is a no-op.

## Tool Tiers

Tools can be organized into tiers for progressive disclosure:

| Tier       | Description                          | Examples                       |
| ---------- | ------------------------------------ | ------------------------------ |
| `core`     | Essential tools always visible       | `find_records`, `create_model` |
| `standard` | Common tools, visible by default     | `list_models`, `update_model`  |
| `advanced` | Specialized tools, hidden by default | `delete_model`                 |

## Checklist for new tools

- [ ] Create tool class with required methods (`name`, `baseDescription`, `inputSchema`, `execute`)
- [ ] Set appropriate category (`static get category()`)
- [ ] Add to `toolClasses` in your ToolRegistry configuration
- [ ] Add comprehensive tests
- [ ] Document in tool descriptions what it does, when to use it, and constraints
- [ ] If generic/reusable, place in `src/mcp/tools/` in mcp-rune
- [ ] If server-specific, extend the server's base tool

## What's next

A single bespoke tool is the right answer when one call does the job. When the operation spans multiple LLM turns — fetch context, analyze, write — the framework offers a higher-level primitive. The next chapter, [Workflow creation](./workflow-creation.md), covers `get_workflow_step` and the `contextHints` protocol that lets the LLM pilot a long-running operation across multiple tool calls.
