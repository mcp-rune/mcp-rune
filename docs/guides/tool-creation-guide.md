# Tool Creation Guide

This document provides guidelines for creating MCP tools in this codebase.

## Overview

Tools are the primary way MCP servers expose functionality to AI agents. Each tool:

- Has a unique name (snake_case)
- Provides a description for LLM understanding
- Defines an input schema (JSON Schema)
- Executes an action and returns results

## Tool Architecture

Tools follow a two-layer architecture: **generic tools** in mcp-kit for cross-server reuse, and **server-specific tools** in your server's `tools/` directory.

```
mcp-kit/src/mcp/tools/
├── base-tool.ts              # BaseTool — root base class (with serverContext)
├── save-model-base-tool.ts   # SaveModelBaseTool — base for create/update tools
├── tool-registry.ts          # ToolRegistry — convention-based tool registration
├── tool-pipeline.ts          # ToolInterceptor + wrapToolHandler
├── interceptors.ts           # Built-in interceptors (logging, tracing, error-catch)
├── validators.ts             # Generic model validators
├── categories.ts             # Tool category definitions
└── data/                     # Generic CRUD tools (reusable across servers)
    ├── list-models-tool.ts
    ├── find-model-tool.ts
    ├── create-model-tool.ts
    ├── update-model-tool.ts
    └── delete-model-tool.ts

your-server/tools/
├── base-tool.js              # ServerBaseTool — extends mcp-kit BaseTool
├── registry.js               # Factory using mcp-kit ToolRegistry
└── {custom}-tool.js          # Server-specific tools only
```

### Inheritance Chain

```
BaseTool (mcp-kit)
  ├── data/*.ts (generic CRUD tools, from mcp-kit)
  └── ServerBaseTool (your server)
        └── {custom}-tool.js (server-specific tools)
```

### Generic CRUD Tools

The following CRUD tools are provided in `lib/mcp/tools/crud/` and shared across all servers:

| Tool           | Description                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_models`  | Lists available models with attributes and associations                                                                                              |
| `find_model`   | Finds records by ID or search criteria with pagination. Supports compound IDs for nested resources and `parent_path` for listing nested collections. |
| `create_model` | Creates records with model-key payload wrapping. Supports `parent_path` for nested model creation.                                                   |
| `update_model` | Updates records with model-key payload wrapping. Supports compound IDs.                                                                              |
| `delete_model` | Deletes records by ID. Supports compound IDs.                                                                                                        |

These tools are completely generic — they have zero server-specific logic. They receive their configuration (models, serverContext) via constructor dependency injection.

### Service Layer

Tools delegate data operations to two services:

- **`ModelService`** — CRUD operations (create, find, update, delete). Composes `EndpointResolver` + `Convention` + `ApiClient`.
- **`SearchService`** — search, lookup, and listing. Composes `SearchAdapter` + `Convention` + `ApiClient`.

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
    │Endpoint│ │Convention │ │SearchAdapter  │
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

See the [Service Layer Guide](service-layer-guide.md) for full details on both services, resolution chains, adapters, and design boundaries.

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

```javascript
import { TOOL_CATEGORIES } from 'mcp-kit/tools'

export class MyTool extends ServerBaseTool {
  static get category() {
    return TOOL_CATEGORIES.STRATEGY
  } // No auth required
  // ...
}
```

Default category is `DATA` (requires authentication).

## Server Context and Disambiguation

When multiple MCP servers are connected to the same AI agent, tool names may overlap. The `serverContext` mechanism provides automatic disambiguation.

### How It Works

`BaseTool.getDisambiguationNote()` generates a note from `serverContext` that is appended to every tool description:

```
IMPORTANT: This tool operates on Engineer specifically.
Engineer is the learning tracking application.
If the user has not specified which application to use, confirm they intend to use this application before proceeding.
```

## Model Associations

Models define relationships using the `associations` property with `belongsTo`, `hasMany`, and `custom`:

```javascript
static associations = {
  belongsTo: {
    theme: { rel: 'theme', target_model: 'theme' }
  },
  hasMany: {
    activities: { rel: 'activities', target_model: 'activity' }
  }
}
```

The `list_models` tool exposes these associations in its output. Nested resources are accessed via `find_model` with compound IDs (e.g., `titles/42/assets/7`) or the `parent_path` parameter for listing nested collections.

## Generic Validators

`lib/mcp/tools/validators.js` provides reusable validation functions:

| Function                   | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `validateSearchParams()`   | Validates search params against a model's searchable fields  |
| `validateNestedResource()` | Validates nested resource relationships using `associations` |

## Tool Registration

### ToolRegistry

`ToolRegistry` from `mcp-kit/tools` handles all registration boilerplate: schema validation, auth wrapping per tool category, tracing, logging, and error catching.

```javascript
import { ToolRegistry, DATA_TOOL_CLASSES, TOOL_CATEGORIES } from 'mcp-kit/tools'
import { STRATEGY_TOOL_CLASSES } from 'mcp-kit/prompts'

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

```javascript
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

```javascript
import { wrapToolHandler, loggingInterceptor, errorInterceptor } from 'mcp-kit/tools'

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

```javascript
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

```javascript
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

### Generic Tools (in mcp-kit)

For tools that are reusable across servers, create them in `src/mcp/tools/`:

```typescript
import { BaseTool } from './base-tool.js'

export class MyGenericTool extends BaseTool {
  // Extend BaseTool directly (not server-specific base)
}
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

| Method                    | Description                               |
| ------------------------- | ----------------------------------------- |
| `static get category()`   | Tool category (auth requirements)         |
| `getUsageRules()`         | Add behavioral rules to description       |
| `getDisambiguationNote()` | Add server/product disambiguation context |

## Best Practices

### Naming Conventions

- Tool names: `snake_case` (e.g., `find_model`, `create_model`)
- Tool classes: `PascalCase` + `Tool` suffix (e.g., `FindModelTool`)
- File names: `kebab-case` + `-tool.js` (e.g., `find-model-tool.js`)

### Descriptions

Write descriptions that help LLMs understand:

1. **What** the tool does (first line)
2. **When** to use it (use cases)
3. **What** it returns (response structure)
4. **Constraints** (limits, requirements)

### Error Handling

Always wrap execute logic in try/catch:

```javascript
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

```javascript
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

| Tier       | Description                          | Examples                      |
| ---------- | ------------------------------------ | ----------------------------- |
| `core`     | Essential tools always visible       | `find_model`, `create_model`  |
| `standard` | Common tools, visible by default     | `list_models`, `update_model` |
| `advanced` | Specialized tools, hidden by default | `delete_model`                |

## Checklist for New Tools

- [ ] Create tool class with required methods (`name`, `baseDescription`, `inputSchema`, `execute`)
- [ ] Set appropriate category (`static get category()`)
- [ ] Add to `toolClasses` in your ToolRegistry configuration
- [ ] Add comprehensive tests
- [ ] Document in tool descriptions what it does, when to use it, and constraints
- [ ] If generic/reusable, place in `src/mcp/tools/` in mcp-kit
- [ ] If server-specific, extend the server's base tool
