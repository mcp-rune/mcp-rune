> **Customization:** register your `BaseTool` subclass via `toolClasses:` on `ToolRegistry`. Your tool receives `this.dataLayer`, `this.modelLayer`, `this.analysisLayer` automatically. The framework handles dispatch, schema validation, interceptors, and result envelopes.

# Tool creation

The previous chapter covered the nine polymorphic tools the framework ships. This chapter covers the other path: writing a `BaseTool` subclass when your operation is _not_ uniform across models — a bespoke verb like "cancel a subscription", "retry a payment", or "recompute a leaderboard".

Every tool you write consumes the three layers from the chapter before that one (`this.dataLayer`, `this.modelLayer`, `this.analysisLayer`). The framework provides the dispatch, the schema validation, the interceptor pipeline, and the result envelope — your subclass only fills in the bespoke logic.

## Overview

Tools are the primary way MCP servers expose functionality to AI agents. Each tool:

- Has a unique name (snake_case)
- Provides a description for LLM understanding
- Defines an input schema (a Zod raw shape)
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
├── interceptors.ts           # Built-in interceptors (logging, error-catch)
├── validators.ts             # Boot-time input-schema validator
├── data/                     # Generic CRUD tools (reusable across servers)
│   ├── list-models-tool.ts
│   ├── find-records-tool.ts
│   ├── create-model-tool.ts
│   ├── update-model-tool.ts
│   ├── delete-model-tool.ts
│   └── bulk-action-models-tool.ts
├── form-strategies/          # Form-strategy tools (get_prompt_guide, validate_form, get_form_summary)
├── analysis/                 # Analysis tools (vector-storage-backed sessions)
├── operations/               # Operations tools (CRUD retrospectives over vector storage)
└── domain/                   # Domain intelligence tools (concepts, rules, workflows)

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

The following CRUD tools are provided in `src/mcp/tools/data/` (exported together as `DATA_TOOL_CLASSES`) and shared across all servers:

| Tool | Description |
| --- | --- |
| `list_models` | Lists available models with attributes and associations |
| `find_records` | Finds records by ID or search criteria with pagination. Supports compound IDs for nested resources and `parent_path` for listing nested collections. |
| `create_model` | Creates records with model-key payload wrapping. Supports `parent_path` for nested model creation. |
| `update_model` | Updates records with model-key payload wrapping. Supports compound IDs. |
| `delete_model` | Deletes records by ID. Supports compound IDs. |
| `bulk_action_models` | Batch create/update/delete in one call |

These tools are completely generic — they have zero server-specific logic. They receive their configuration (models, serverContext) via constructor dependency injection.

### How tools reach data

Tools call **only** the three peer interfaces from [chapter 4](./the-three-layers.md): `this.dataLayer`, `this.modelLayer`, `this.analysisLayer`. The diagram below shows the historical decomposition behind `DataLayer` — `ModelService` (the default `DataLayer` implementation) composes `EndpointResolver` + convention + `ApiClient`, and `SearchEnabledDataLayer` adds search/lookup on top — but **projection-layer code (tools, apps) must not reference these names directly** — AGENTS.md forbids it and the eslint layer-guard enforces the layer-helper half. Use the three layers; the rest is internal.

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
   ┌──────────────────────────────────────────────────────┐
   │  traceToolCall (tracing wraps the entire chain)      │
   │                                                      │
   │    ┌─────────────────────────────────────────────┐   │
   │    │  wrapToolHandler(handler, [interceptors])   │   │
   │    └──────────────────────┬──────────────────────┘   │
   │                           ▼                          │
   │    ┌─────────────────────────────────────────────┐   │
   │    │  loggingInterceptor     (start, args)       │   │  ← before
   │    └──────────────────────┬──────────────────────┘   │
   │                           ▼                          │
   │    ┌─────────────────────────────────────────────┐   │
   │    │  errorInterceptor       (try { ... } catch) │   │  ← around
   │    │   ┌─────────────────────────────────────┐   │   │
   │    │   │  YourTool.execute(args, context)    │   │   │  ← your code
   │    │   │   - input validation                │   │   │
   │    │   │   - service calls (DataLayer)       │   │   │
   │    │   │   - return shaped result            │   │   │
   │    │   └─────────────────────────────────────┘   │   │
   │    │                                             │   │
   │    │   catch → MCP-shaped error response         │   │
   │    └──────────────────────┬──────────────────────┘   │
   │                           │                          │
   └───────────────────────────┼──────────────────────────┘
                               ▼  result or error response
                        MCP response
```

Built-in interceptors (`loggingInterceptor`, `errorInterceptor`) cover the common cases; tracing is not an interceptor — `ToolRegistry` wraps the whole handler (interceptor chain included) in `traceToolCall`. Add your own interceptors via `ToolRegistry` to insert tenant-scoped header injection, rate limiting, or audit logging — the pipeline is composable and runs in declaration order.

## Tool families and static requirement flags

There is no category enum. Each tool class declares what it needs through four static boolean flags, all defined on `BaseTool` with safe defaults:

| Flag | Default on `BaseTool` | Effect |
| --- | --- | --- |
| `requiresAuth` | `true` | When `true`, `ToolRegistry` resolves the session's access token and constructs a fresh `DataLayer` per invocation. When `false`, the tool is instantiated without one — calling `requireDataLayer()` throws. |
| `requiresVectorStorage` | `false` | When `true`, the tool is skipped at registration unless the registry was configured with `vectorStorageEnabled: true`. |
| `requiresDomainRegistry` | `false` | When `true`, the tool is skipped at registration unless a `domainRegistry` was passed to the registry. |
| `requiresPromptRegistry` | `false` | When `true`, the tool is skipped at registration unless a `promptRegistry` was passed to the registry. |

The bundled tools ship in families. Each family base class overrides the flags declaratively and sets `static defaultAnnotations` to match the family's read-only / destructive character:

| Family base | Flags overridden | Ships as |
| --- | --- | --- |
| `BaseTool` (CRUD tools extend it directly) | — (defaults: auth required, no special services) | `DATA_TOOL_CLASSES` |
| `BaseFormStrategyTool` | `requiresAuth = false`, `requiresPromptRegistry = true` | `FORM_STRATEGY_TOOL_CLASSES` |
| `BaseAnalysisTool` | `requiresAuth = false`, `requiresVectorStorage = true` | `ANALYSIS_TOOL_CLASSES` |
| `BaseOperationsTool` | `requiresAuth = false`, `requiresVectorStorage = true` | `OPERATIONS_TOOL_CLASSES` |
| `BaseDomainTool` | `requiresAuth = false`, `requiresDomainRegistry = true` | `DOMAIN_TOOL_CLASSES` |

> **Shared embedding infrastructure:** the analysis/operations tool families and the domain tools use the same embedding service (all-MiniLM-L6-v2, 384 dims) and cosine similarity. Analysis and operations tools store embeddings in pgvector; domain tools keep embeddings in memory for semantic search over concepts, rules, and workflows.

### Choosing a base

Extend `BaseTool` directly for anything CRUD-shaped — the defaults (authenticated `DataLayer` per invocation, no special services) are the common case. Reach for a family base when your tool belongs to that family's infrastructure: `BaseFormStrategyTool` for tools that read prompt classes, `BaseAnalysisTool` or `BaseOperationsTool` for vector-storage-backed tools, `BaseDomainTool` for tools that read the domain registry. The base class buys you the right flags and `defaultAnnotations` in one declaration.

### Overriding a flag per tool

When a tool departs from its family default — for example, an analysis tool that fetches records from the upstream API and therefore needs auth despite the family being no-auth — override the flag as a static field:

```ts file=src/tools/my-ingest-tool.ts
import { BaseAnalysisTool } from '@mcp-rune/mcp-rune/tools'

export class MyIngestTool extends BaseAnalysisTool {
  // BaseAnalysisTool sets requiresAuth = false; this tool fetches from the API, so opts back in.
  static override requiresAuth = true
}
```

```js file=src/tools/my-ingest-tool.js
import { BaseAnalysisTool } from '@mcp-rune/mcp-rune/tools'

export class MyIngestTool extends BaseAnalysisTool {
  // BaseAnalysisTool sets requiresAuth = false; this tool fetches from the API, so opts back in.
  static requiresAuth = true
}
```

`ToolRegistry` reads `ToolCls.requiresAuth` directly — the flag is always defined because `BaseTool` declares a default.

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

`src/mcp/tools/validators.ts` exports one function: `validateToolInputSchema(toolName, inputSchema)` — the boot-time check `ToolRegistry` runs on every tool's Zod shape. Filter and nested-resource validation live on the `DataLayer` seam instead: `dataLayer.validateFilters(model, filters)` and `dataLayer.validateNestedResource(parentModel, childResource)`.

## Tool Registration

### ToolRegistry

`ToolRegistry` from `@mcp-rune/mcp-rune/tools` handles all registration boilerplate: schema validation, auth wrapping per tool's static `requiresAuth` flag, tracing, logging, and error catching.

```js file=src/registries/tool-registry.js
import {
  DATA_TOOL_CLASSES,
  FORM_STRATEGY_TOOL_CLASSES,
  ToolRegistry
} from '@mcp-rune/mcp-rune/tools'

const toolRegistry = new ToolRegistry({
  toolClasses: {
    ...DATA_TOOL_CLASSES,
    ...FORM_STRATEGY_TOOL_CLASSES,
    my_custom_tool: MyCustomTool
  },
  models: MODEL_CLASSES,
  serverContext: { name: 'My Server' },
  namespace: 'my-server',
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  // Gating is implicit: tools with requiresPromptRegistry register because
  // promptRegistry is present; tools with requiresDomainRegistry register
  // because domainRegistry is present.
  promptRegistry,
  domainRegistry,
  // Tools with requiresVectorStorage register only when this is true.
  vectorStorageEnabled: vectorStorage.isEnabled()
})
```

```ts file=src/registries/tool-registry.ts
import {
  DATA_TOOL_CLASSES,
  FORM_STRATEGY_TOOL_CLASSES,
  ToolRegistry
} from '@mcp-rune/mcp-rune/tools'

const toolRegistry = new ToolRegistry({
  toolClasses: {
    ...DATA_TOOL_CLASSES,
    ...FORM_STRATEGY_TOOL_CLASSES,
    my_custom_tool: MyCustomTool
  },
  models: MODEL_CLASSES,
  serverContext: { name: 'My Server' },
  namespace: 'my-server',
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  // Gating is implicit: tools with requiresPromptRegistry register because
  // promptRegistry is present; tools with requiresDomainRegistry register
  // because domainRegistry is present.
  promptRegistry,
  domainRegistry,
  // Tools with requiresVectorStorage register only when this is true.
  vectorStorageEnabled: vectorStorage.isEnabled()
})
```

For each tool, ToolRegistry automatically:

1. Creates a definition instance to read `description`, `inputSchema`, and `annotations`
2. Validates the schema at boot and throws if a tool's schema cannot serialize — a broken schema is a programming error, so boot fails loudly instead of shipping the server with the tool silently missing
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
import { z } from 'zod'

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
    // A Zod raw shape — field name to Zod schema, not a JSON Schema object
    return {
      required_param: z.string().describe('Description of this parameter')
    }
  }

  async execute(args) {
    try {
      const dataLayer = this.requireDataLayer()
      const data = await dataLayer.find('book', args.required_param)
      return this.formatResponse(data)
    } catch (error) {
      return this.formatError(error)
    }
  }
}
```

```ts file=src/tools/my-new-tool.ts
import { z } from 'zod'

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
    // A Zod raw shape — field name to Zod schema, not a JSON Schema object
    return {
      required_param: z.string().describe('Description of this parameter')
    }
  }

  async execute(args) {
    try {
      const dataLayer = this.requireDataLayer()
      const data = await dataLayer.find('book', args.required_param)
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

| Method                  | Description                  |
| ----------------------- | ---------------------------- |
| `get name()`            | Tool name (snake_case)       |
| `get baseDescription()` | Tool description for LLM     |
| `get inputSchema()`     | Zod raw shape for parameters |
| `execute(args)`         | Main execution logic         |

### Available Helpers

| Method | Description |
| --- | --- |
| `requireDataLayer()` | Returns `this.dataLayer`, or throws `"Not authenticated. Please authenticate first."` when the tool ran without auth |
| `this.dataLayer` | The per-request `DataLayer` seam (present when `requiresAuth = true`) |
| `formatResponse(data)` | Wrap successful response |
| `formatError(error)` | Formats a seam error into an LLM-facing error result — backend failures arrive as typed `DataLayerError` subclasses with messages already parsed through the model's convention |
| `storeToolMemory(params)` | Fire-and-forget vector storage of tool operations |
| `validateModel(name)` | Check model exists in config |
| `getModelConfig(name)` | Get model configuration |
| `getModelNames()` / `getWritableModelNames()` | List available model names (all / write-enabled) |
| `zodEnum(values)` | Build a Zod enum from a value list (falls back to `z.string()` when empty) |
| `truncateString(s, n)` | Truncate string to max length |
| `sanitizeResponseData(data)` | JSON stringify for display |

### Optional Overrides

| Method | Description |
| --- | --- |
| `static requiresAuth` / `requiresVectorStorage` / `requiresDomainRegistry` / `requiresPromptRegistry` | Dependency flags — override when the tool departs from its base's default |
| `static defaultAnnotations` / `get annotations()` | MCP tool annotations (read-only / destructive / idempotent hints) |
| `getUsageRules()` | Add behavioral rules to description |

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
    this.requireDataLayer()
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
    this.requireDataLayer()
    // ... tool logic
    return this.formatResponse(data)
  } catch (error) {
    return this.formatError(error)
  }
}
```

By the time an error reaches `formatError()`, the seam has already translated it into a typed `DataLayerError` subclass (`RecordNotFoundError`, `ApiRequestError`) whose message was parsed through the failing model's convention — field errors joined with semicolons, HTTP status appended inline. `formatError()` truncates, logs, and wraps it into an `isError: true` result:

```
title: can't be blank; status: is not included in the list (422)
```

`formatError()` adds no "Error:" prefix — `isError: true` on the MCP response already signals it. Only errors thrown past your try/catch get an `Error: ` prefix, prepended by the built-in `errorInterceptor`.

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

## Checklist for new tools

- [ ] Create tool class with required methods (`name`, `baseDescription`, `inputSchema`, `execute`)
- [ ] Pick the right base class (`BaseTool` or a family base); override a static `requires*` flag only when the tool departs from its family default
- [ ] Add to `toolClasses` in your ToolRegistry configuration
- [ ] Add comprehensive tests
- [ ] Document in tool descriptions what it does, when to use it, and constraints
- [ ] If generic/reusable, place in `src/mcp/tools/` in mcp-rune
- [ ] If server-specific, extend the server's base tool

## What's next

A single bespoke tool is the right answer when one call does the job. When the operation spans multiple LLM turns — fetch context, analyze, write — the framework offers a higher-level primitive. The next chapter, [Workflow creation](./workflow-creation.md), covers `get_workflow_step` and the `contextHints` protocol that lets the LLM pilot a long-running operation across multiple tool calls.
