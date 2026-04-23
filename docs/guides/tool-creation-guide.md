# Tool Creation Guide

This document provides guidelines for creating MCP tools in this codebase.

## Overview

Tools are the primary way MCP servers expose functionality to AI agents. Each tool:

- Has a unique name (snake_case)
- Provides a description for LLM understanding
- Defines an input schema (JSON Schema)
- Executes an action and returns results

## Tool Architecture

Tools follow a two-layer architecture: **generic tools** in `lib/` for cross-server reuse, and **server-specific tools** in `src/{server}/tools/`.

```
lib/mcp/tools/
├── base-tool.js              # BaseTool — root base class (with serverContext)
├── save-model-base-tool.js   # SaveModelBaseTool — base for create/update tools
├── validators.js             # Generic model validators
├── categories.js             # Tool category definitions
└── crud/                     # Generic CRUD tools (reusable across servers)
    ├── list-models-tool.js
    ├── find-model-tool.js
    ├── create-model-tool.js
    ├── update-model-tool.js
    ├── delete-model-tool.js
    └── get-nested-resources-tool.js

src/{server}/tools/
├── base-tool.js              # ServerBaseTool — extends lib BaseTool
├── registry.js               # ToolRegistry — imports CRUD from lib/, adds server-specific tools
├── validators.js             # Thin wrapper over lib validators
└── {custom}-tool.js          # Server-specific tools only
```

### Inheritance Chain

```
lib/mcp/tools/base-tool.js (BaseTool)
  ├── lib/mcp/tools/crud/*.js (generic CRUD tools)
  └── src/{server}/tools/base-tool.js (ServerBaseTool)
        └── src/{server}/tools/{custom}-tool.js (server-specific tools)
```

### Generic CRUD Tools

The following CRUD tools are provided in `lib/mcp/tools/crud/` and shared across all servers:

| Tool                   | Description                                             |
| ---------------------- | ------------------------------------------------------- |
| `list_models`          | Lists available models with attributes and associations |
| `find_model`           | Finds records by ID or search criteria with pagination  |
| `create_model`         | Creates records with model-key payload wrapping         |
| `update_model`         | Updates records with model-key payload wrapping         |
| `delete_model`         | Deletes records by ID                                   |
| `get_nested_resources` | Fetches nested/associated resources                     |

These tools are completely generic — they have zero server-specific logic. They receive their configuration (models, serverContext) via constructor dependency injection.

### Service Layer

CRUD tools delegate to `ModelService` when injected, which composes `EndpointResolver` + `Convention` + `ApiClient`. This separates concerns:

```
┌─────────────────────────────────────────────────┐
│  MCP Tool Layer                                  │
│  (input validation, response formatting,         │
│   vector storage, usage rules)                   │
└──────────────┬──────────────────┬───────────────┘
               │                  │
    ┌──────────▼──────┐  ┌───────▼────────┐
    │  ModelService    │  │  SearchService   │
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

To inject ModelService in your tool registry:

```typescript
import { ModelService } from 'mcp-kit/lib/mcp/services/index.js'

const modelService = new ModelService({ apiClient, models, namespace: 'api/v1' })
const tool = new CreateModelTool({ apiClient, modelService, models, logger })
```

See the [Service Layer Guide](service-layer-guide.md) for full details.

## Tool Categories

Tools are organized by category which determines authentication requirements:

| Category       | Auth Required | Description                                          |
| -------------- | ------------- | ---------------------------------------------------- |
| `STRATEGY`     | No            | Prompt strategies (get_prompt_guide, etc.)           |
| `CRUD`         | Yes           | API operations — generic in `lib/mcp/tools/crud/`    |
| `AUTOCOMPLETE` | Yes           | Field value suggestions                              |
| `VECTOR`       | No            | Vector retrospective tools (requires vector storage) |
| `DOMAIN`       | No            | Domain intelligence (concepts, rules, workflows)     |
| `CUSTOM`       | Varies        | Server-specific behavior                             |

> **Shared embedding infrastructure:** Both `VECTOR` and `DOMAIN` categories use the same embedding service (`lib/services/embeddings.js` — MiniLM-L6-v2, 384 dims) and cosine similarity (`lib/services/cosine-similarity.js`). VECTOR tools store embeddings in pgvector for CRUD operation retrospectives. DOMAIN tools keep embeddings in memory for semantic search over concepts, workflows, and diagrams.

### Setting Tool Category

Override the static `category` property:

```javascript
import { TOOL_CATEGORIES } from '#src/mcp/tools/categories.js'

export class MyTool extends EngineerBaseTool {
  static category = TOOL_CATEGORIES.STRATEGY // No auth required
  // ...
}
```

Default category is `CRUD` (requires authentication).

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

The `list_models` tool exposes these associations in its output. The `get_nested_resources` tool uses them to validate and fetch related resources.

## Generic Validators

`lib/mcp/tools/validators.js` provides reusable validation functions:

| Function                   | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `validateSearchParams()`   | Validates search params against a model's searchable fields  |
| `validateNestedResource()` | Validates nested resource relationships using `associations` |

Server-specific validators (e.g., `src/engineer/tools/validators.js`) are thin wrappers that bind these to the server's model registry.

## Creating a New Tool

### Server-Specific Tools

For tools with server-specific logic, create them in `src/engineer/tools/`:

#### 1. Create the Tool Class

```javascript
import { EngineerBaseTool } from './base-tool.js'

export class MyNewTool extends EngineerBaseTool {
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

Add to `src/engineer/tools/registry.js`.

#### 3. Add Tests

Create `__tests__/engineer/tools/my-new-tool.spec.js`.

### Generic Tools (in lib/)

For tools that are reusable across servers, create them in `lib/mcp/tools/`:

```javascript
import { BaseTool } from '../base-tool.js'

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

| Method                       | Description                                |
| ---------------------------- | ------------------------------------------ |
| `requireApiClient()`         | Throws if not authenticated                |
| `this.modelService`          | ModelService instance (optional, for CRUD) |
| `formatResponse(data)`       | Wrap successful response                   |
| `formatError(error)`         | Wrap error response                        |
| `validateModel(name)`        | Check model exists in config               |
| `getModelConfig(name)`       | Get model configuration                    |
| `getModelEnum()`             | Get list of available models               |
| `truncateString(s, n)`       | Truncate string to max length              |
| `sanitizeResponseData(data)` | JSON stringify for display                 |

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

## Tool Tiers

Tools can be organized into tiers for progressive disclosure:

| Tier       | Description                          | Examples                      |
| ---------- | ------------------------------------ | ----------------------------- |
| `core`     | Essential tools always visible       | `find_model`, `create_model`  |
| `standard` | Common tools, visible by default     | `list_models`, `update_model` |
| `advanced` | Specialized tools, hidden by default | `delete_model`                |

## Checklist for New Tools

- [ ] Create tool class with required methods
- [ ] Set appropriate category
- [ ] Register in registry.js
- [ ] Add comprehensive tests

- [ ] Document in tool descriptions what it does, when to use it, and constraints
- [ ] If generic/reusable, place in `lib/mcp/tools/` (not server-specific)
- [ ] If server-specific, extend the server's base tool
