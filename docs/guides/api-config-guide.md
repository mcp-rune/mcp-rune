# API Configuration Guide

This guide covers the complete `static api` configuration on models and the services that consume it: EndpointResolver, ModelService, and ModelActionTool. It is the single reference for configuring how a model maps to API endpoints, HTTP methods, payload conventions, and custom actions.

## Table of Contents

- [Overview](#overview)
- [ApiConfig Reference](#apiconfig-reference)
  - [endpoint](#endpoint)
  - [convention](#convention)
  - [readOnly](#readonly)
  - [parent / standalone](#parent--standalone)
  - [namespace](#namespace)
  - [endpoints (CRUD overrides)](#endpoints-crud-overrides)
  - [actions (custom actions)](#actions-custom-actions)
- [ActionDefinition Reference](#actiondefinition-reference)
  - [method](#method)
  - [path](#path)
  - [Path Parameter Substitution](#path-parameter-substitution)
  - [recordLevel](#recordlevel)
  - [description](#description)
  - [rawPayload](#rawpayload)
- [EndpointResolver](#endpointresolver)
  - [CRUD Resolution Chain](#crud-resolution-chain)
  - [Action Resolution Chain](#action-resolution-chain)
  - [Namespace Resolution](#namespace-resolution)
  - [Custom pathForType](#custom-pathfortype)
- [ModelService](#modelservice)
  - [CRUD Operations](#crud-operations)
  - [Custom Actions](#custom-actions)
  - [Domain Errors](#domain-errors)
- [ModelActionTool](#modelactiontool)
- [Convention Integration](#convention-integration)
- [Compound IDs and Nested Resources](#compound-ids-and-nested-resources)
- [Examples](#examples)

---

## Overview

Every model declares a `static api` configuration that describes how it maps to a REST API:

```typescript
class Book extends BaseModel {
  static api: ApiConfig = {
    endpoint: 'books',
    convention: jsonApiConvention,
    namespace: 'api/v1',
    endpoints: { create: 'books/draft' },
    actions: { publish: { path: ':id/publish' } }
  }
}
```

This configuration is consumed by:

- **EndpointResolver** — builds URLs from model config + action context
- **ModelService** — orchestrates CRUD and custom actions through the resolver + convention + ApiClient pipeline
- **ModelActionTool** — MCP tool surface that exposes custom actions to LLMs
- **Convention** — formats request payloads and normalizes responses

---

## ApiConfig Reference

```typescript
interface ApiConfig {
  endpoint?: string
  convention?: BaseConvention
  readOnly?: boolean
  parent?: string | string[]
  standalone?: boolean
  namespace?: string
  endpoints?: EndpointOverrides
  actions?: Record<string, ActionDefinition>
}
```

### endpoint

**Type:** `string` — **Required**

The base API path for this model. Used by `EndpointResolver.pathForType()` as the default path segment.

```typescript
static api = { endpoint: 'books' }
// → GET /books, POST /books, PATCH /books/:id, DELETE /books/:id
```

### convention

**Type:** `BaseConvention` — **Optional** (defaults to `jsonApiConvention`)

Controls how request payloads are built and responses are normalized. The convention determines:

- How attributes are wrapped for create/update (`buildRequestPayload`)
- How association values are transformed (`resolveAssociationValues`)
- How list responses are extracted and paginated (`normalizeListResponse`)

```typescript
static api = { endpoint: 'books', convention: jsonApiConvention }
// create payload: { "book": { "title": "Test" } }

static api = { endpoint: 'books', convention: flatConvention }
// create payload: { "title": "Test" }
```

### readOnly

**Type:** `boolean` — **Optional** (defaults to `false`)

When `true`, ModelService blocks write operations (create, update, delete) on this model with a `ModelReadOnlyError`. Custom actions are **not** blocked by `readOnly` — they use `_validateModel` instead of `_validateWritable`.

```typescript
static api = { endpoint: 'reports', readOnly: true }
// create/update/delete → throws ModelReadOnlyError
// action('export', { recordId: '1' }) → allowed
```

### parent / standalone

**Type:** `parent: string | string[]`, `standalone: boolean` — **Optional**

Configure nested resource relationships.

- `parent` — names the parent model(s) this resource is nested under
- `standalone: false` — this model has no standalone endpoint; a `parentPath` is required for collection operations

```typescript
class Asset extends BaseModel {
  static api = {
    endpoint: 'assets',
    parent: 'title',
    standalone: false
  }
}

// List: requires parentPath → GET /titles/42/assets
// Find: uses compound ID → GET /titles/42/assets/7
// Create: requires parentPath → POST /titles/42/assets
```

When `standalone` is `false` and no `parentPath` is provided, `EndpointResolver` throws `MissingParentError`.

Multiple parents are supported:

```typescript
static api = {
  endpoint: 'schedulings',
  parent: ['title', 'title_group'],
  standalone: false
}
```

### namespace

**Type:** `string` — **Optional**

Per-model API namespace prefix. Overrides the server-wide namespace configured on `EndpointResolver`.

```typescript
// Server-wide namespace: 'api/v1'
static api = { endpoint: 'books', namespace: 'api/v2' }
// → api/v2/books (model-level overrides server-wide)
```

### endpoints (CRUD overrides)

**Type:** `EndpointOverrides` — **Optional**

Per-action endpoint overrides for APIs with non-standard CRUD paths.

```typescript
interface EndpointOverrides {
  collection?: string // list + create (unless overridden)
  record?: string // find + update + delete (unless overridden), :id substituted
  create?: string // create only — highest priority for collection ops
  update?: string // update only — highest priority for record ops, :id substituted
  delete?: string // delete only — highest priority for record ops, :id substituted
}
```

Resolution priority (highest first):

| Action | Resolution Order                                      |
| ------ | ----------------------------------------------------- |
| list   | `endpoints.collection` → default                      |
| create | `endpoints.create` → `endpoints.collection` → default |
| find   | `endpoints.record` → default                          |
| update | `endpoints.update` → `endpoints.record` → default     |
| delete | `endpoints.delete` → `endpoints.record` → default     |

```typescript
static api = {
  endpoint: 'books',
  endpoints: {
    collection: 'catalogue/book-items',
    record: 'catalogue/book-items/:id',
    create: 'books/draft',
    update: 'books/:id/revise',
    delete: 'books/:id/archive'
  }
}

// list   → catalogue/book-items
// create → books/draft              (per-action > collection)
// find   → catalogue/book-items/123
// update → books/123/revise         (per-action > record)
// delete → books/123/archive        (per-action > record)
```

**Note:** Explicit overrides bypass namespace — they are treated as full paths.

### actions (custom actions)

**Type:** `Record<string, ActionDefinition>` — **Optional**

Custom actions beyond CRUD. Each key is the action name, each value defines the HTTP method, URL path template, and behavior options. See [ActionDefinition Reference](#actiondefinition-reference).

```typescript
static api = {
  endpoint: 'books',
  actions: {
    publish:         { path: ':id/publish', description: 'Publish a draft book' },
    archive:         { path: ':id/archive', method: 'PATCH' },
    export:          { path: ':id/export', method: 'GET' },
    approve_chapter: { path: ':id/chapters/:chapter_id/approve' },
    bulk_publish:    { path: 'bulk-publish', recordLevel: false, rawPayload: true }
  }
}
```

---

## ActionDefinition Reference

```typescript
interface ActionDefinition {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  recordLevel?: boolean
  description?: string
  rawPayload?: boolean
}
```

### method

**Type:** `string` — **Optional** (defaults to `'POST'`)

The HTTP method used for this action. Any standard method is supported.

### path

**Type:** `string` — **Required**

URL path template with Rails-style named parameters. Relative paths are resolved against the model's base endpoint by `EndpointResolver.resolveAction()`.

Supports two kinds of placeholders:

- `:id` — substituted from `recordId` (the primary record parameter)
- `:param_name` — substituted from `pathParams` (additional named parameters)

```typescript
// Single record action
path: ':id/publish'

// Nested action with extra parameter
path: ':id/chapters/:chapter_id/approve'

// Collection action with parameters
path: 'reports/:report_type/:year/generate'

// Simple collection action
path: 'bulk-publish'
```

### Path Parameter Substitution

`EndpointResolver.resolveAction()` substitutes path parameters in this order:

1. `:id` is replaced with `recordId` (if present in both path and context)
2. All remaining `:param_name` placeholders are replaced from `pathParams`
3. If any placeholders remain unresolved, an error is thrown

```typescript
// recordId='42', pathParams={ chapter_id: '5' }
':id/chapters/:chapter_id/approve' → 'books/42/chapters/5/approve'

// No recordId, pathParams={ report_type: 'sales', year: '2026' }
'reports/:report_type/:year/generate' → 'books/reports/sales/2026/generate'

// recordId='42', no pathParams with :chapter_id
':id/chapters/:chapter_id/approve' → Error: "Unresolved path parameters: :chapter_id"
```

**Compound IDs:** When `recordId` contains `/` (e.g., `'titles/42/assets/7'`), it is treated as a compound ID. After `:id` substitution, the base endpoint is **not** prepended — the compound ID already encodes the full resource hierarchy.

```typescript
// recordId='titles/42/assets/7', path=':id/publish'
// → 'titles/42/assets/7/publish' (no base prepend)
```

### recordLevel

**Type:** `boolean` — **Optional** (defaults to `true`)

Indicates whether this action operates on a specific record. Used for documentation and tooling hints. Does not affect resolution — `:id` substitution only happens when `recordId` is actually provided.

### description

**Type:** `string` — **Optional**

Human-readable description. Included in the `model_action` tool description so LLMs understand what each action does.

### rawPayload

**Type:** `boolean` — **Optional** (defaults to `false`)

When `true`, `ModelService.action()` sends attributes as-is without convention wrapping. Useful for actions that accept a non-standard payload format.

```typescript
// rawPayload: false (default) → convention wraps payload
// POST /books/42/publish with { "book": { "publish_date": "2026-01-01" } }

// rawPayload: true → attributes sent directly
// POST /books/bulk-publish with { "ids": [1, 2, 3] }
```

---

## EndpointResolver

`EndpointResolver` consolidates URL building into a single class with layered resolution chains.

### CRUD Resolution Chain

**Collection operations** (list, create):

1. Per-action override (`endpoints.create` for create)
2. Collection override (`endpoints.collection`)
3. Parent path (explicit `parentPath` for nested collections)
4. Namespace + `pathForType` (default endpoint)

**Record operations** (find, update, delete):

1. Per-action override (`endpoints.update`, `endpoints.delete`) with `:id` substitution
2. Record override (`endpoints.record`) with `:id` substitution
3. Compound ID (if `recordId` contains `/`) — used as full path
4. Namespace + `pathForType` + `/recordId`

### Action Resolution Chain

`resolveAction()` resolves custom actions:

1. Look up `ActionDefinition` from `modelConfig.api.actions`
2. Substitute `:id` with `recordId`
3. Substitute remaining `:param_name` from `pathParams`
4. Validate no unresolved placeholders remain
5. Compound ID → skip base prepend; Simple/collection → prepend `pathForType`
6. Apply namespace

Returns `{ url: string, method: string }`.

### Namespace Resolution

Effective namespace: model-level > server-wide > none.

```typescript
const resolver = new EndpointResolver({ namespace: 'api/v1' })

// Server-wide:
resolver.resolveCollection({ model: 'book', modelConfig }) // → 'api/v1/books'

// Model override:
// modelConfig.api.namespace = 'api/v2'
resolver.resolveCollection({ model: 'book', modelConfig }) // → 'api/v2/books'

// Actions also respect namespace:
resolver.resolveAction({ model: 'book', modelConfig, action: 'publish', recordId: '42' })
// → { url: 'api/v1/books/42/publish', method: 'POST' }
```

**Note:** CRUD endpoint overrides bypass namespace (they are treated as full paths). Action paths do apply namespace after base prepending.

### Custom pathForType

Override in a subclass for APIs with different naming conventions:

```typescript
class DasherizedResolver extends EndpointResolver {
  override pathForType(model: string): string {
    return model.replace(/_/g, '-') + 's'
  }
}
```

---

## ModelService

`ModelService` composes EndpointResolver + Convention + ApiClient. It is the single orchestrator for all data operations — both CRUD and custom actions.

### CRUD Operations

```typescript
await modelService.create('book', { title: 'Test', author: 'Author' })
await modelService.find('book', '123')
await modelService.list('book', { status: 'active' }, { page: 2, perPage: 10 })
await modelService.update('book', '123', { title: 'Updated' })
await modelService.delete('book', '123')

// Nested resources:
await modelService.create('asset', { name: 'HD' }, { parentPath: 'titles/42/assets' })
await modelService.find('asset', 'titles/42/assets/7') // compound ID

// User impersonation:
await modelService.create('book', attrs, { userId: 'user-123' })
```

### Custom Actions

```typescript
// Simple record action (POST)
await modelService.action('book', 'publish', { recordId: '42' })
// → POST books/42/publish

// Record action with payload (convention-wrapped)
await modelService.action('book', 'archive', {
  recordId: '42',
  attributes: { reason: 'outdated' }
})
// → PATCH books/42/archive with { "book": { "reason": "outdated" } }

// GET action with query params
await modelService.action('book', 'export', {
  recordId: '42',
  params: { format: 'pdf' }
})
// → GET books/42/export?format=pdf

// Multi-param action (Rails-style)
await modelService.action('book', 'approve_chapter', {
  recordId: '42',
  pathParams: { chapter_id: '5' }
})
// → POST books/42/chapters/5/approve

// Collection-level action with raw payload
await modelService.action('book', 'bulk_publish', {
  attributes: { ids: [1, 2, 3] }
})
// → POST books/bulk-publish with { ids: [1, 2, 3] }

// Compound ID (nested resource action)
await modelService.action('asset', 'publish', {
  recordId: 'titles/42/assets/7'
})
// → POST titles/42/assets/7/publish

// With user impersonation
await modelService.action('book', 'publish', {
  recordId: '42',
  requestOptions: { userId: 'u1' }
})
```

### Domain Errors

| Error                        | When                                 | Properties                  |
| ---------------------------- | ------------------------------------ | --------------------------- |
| `UnknownModelError`          | Model name not in registry           | `availableModels: string[]` |
| `ModelReadOnlyError`         | Write CRUD on read-only model        | —                           |
| `MissingRequiredFieldsError` | Create missing required attrs        | `missingFields: string[]`   |
| `MissingParentError`         | Nested-only model without parentPath | —                           |
| `UnknownActionError`         | Action not declared on model         | —                           |

**Note:** `ModelReadOnlyError` only applies to CRUD write operations (create, update, delete). Custom actions use `_validateModel` — read-only models can still have custom actions (e.g., GET export).

---

## ModelActionTool

The `model_action` MCP tool exposes custom actions to LLMs.

**Input schema:**

| Parameter     | Type                     | Required | Description                           |
| ------------- | ------------------------ | -------- | ------------------------------------- |
| `model`       | enum                     | Yes      | Model name (only models with actions) |
| `action`      | string                   | Yes      | Action name as declared on the model  |
| `record_id`   | string                   | No       | Record ID (supports compound IDs)     |
| `attributes`  | object                   | No       | Payload attributes                    |
| `path_params` | `Record<string, string>` | No       | Named path parameters                 |
| `params`      | object                   | No       | Query parameters (for GET actions)    |
| `user_id`     | string                   | No       | User ID for impersonation             |

The tool description dynamically includes a summary of all available actions per model, showing action names, HTTP methods, and descriptions for LLM discoverability.

---

## Convention Integration

ModelService uses the model's convention for payload building in both CRUD and custom actions:

1. **CRUD** — `create()` and `update()` always wrap payloads via `convention.buildRequestPayload(model, attrs)`
2. **Custom actions** — `action()` wraps by default; set `rawPayload: true` to skip wrapping

The convention also handles:

- **Association values** — transforms `_id` fields to convention-specific formats (e.g., `_link` for HAL)
- **Response normalization** — `normalizeListResponse()` extracts records and pagination
- **Error parsing** — `parseErrorResponse()` extracts structured error messages from HTTP error responses

### Error Parsing

Each convention knows its API's error response shape. `BaseTool.formatError()` delegates to the convention's `parseErrorResponse()` to extract structured errors and format them as compact, LLM-optimized text.

The method receives an `ErrorResponse` object (`{ status?, data? }`) and returns a flat `string[]` of error messages:

```typescript
import type { ErrorResponse } from 'mcp-kit/prompts'

// Base implementation: extracts from response.data, JSON dump for objects
parseErrorResponse(response: ErrorResponse): string[] {
  const data = response.data
  if (data === undefined || data === null) return []
  if (typeof data === 'string') return [data]
  return [JSON.stringify(data, null, 2)]
}
```

**JSON API convention** handles Rails error shapes:

| API Response Shape                          | Parsed Output               |
| ------------------------------------------- | --------------------------- |
| `{ error: "Not found" }`                    | `["Not found"]`             |
| `{ errors: { title: ["can't be blank"] } }` | `["title: can't be blank"]` |
| `{ errors: ["msg1", "msg2"] }`              | `["msg1", "msg2"]`          |

**Custom conventions** should override to handle their API's specific error envelope. For example, a HAL convention might extract errors from `_embedded.errors` or a different structure.

The tool layer joins multiple errors with semicolons and appends the HTTP status inline:

```
title: can't be blank; status: is not included in the list (422)
```

This format is optimized for LLM consumption: `isError: true` already signals the error, so no "Error:" prefix or "Status:" label is needed.

---

## Compound IDs and Nested Resources

Nested resources are handled through **compound IDs** and `parentPath`:

```typescript
// Model configuration
class Asset extends BaseModel {
  static api = {
    endpoint: 'assets',
    parent: 'title',
    standalone: false,
    actions: {
      publish: { path: ':id/publish' }
    }
  }
}
```

**Collection operations** use `parentPath`:

```typescript
await modelService.list('asset', {}, {}, { parentPath: 'titles/42/assets' })
await modelService.create('asset', attrs, { parentPath: 'titles/42/assets' })
```

**Record operations** use compound IDs:

```typescript
await modelService.find('asset', 'titles/42/assets/7')
await modelService.update('asset', 'titles/42/assets/7', attrs)
await modelService.delete('asset', 'titles/42/assets/7')
```

**Custom actions** on nested resources:

```typescript
await modelService.action('asset', 'publish', { recordId: 'titles/42/assets/7' })
// → POST titles/42/assets/7/publish (compound ID — no base prepend)
```

The `compound-id` module provides utilities:

```typescript
import { buildCompoundId, buildCollectionPath, parseId } from 'mcp-kit/services'

buildCompoundId('titles', '42', 'assets', '7') // → 'titles/42/assets/7'
buildCollectionPath('titles', '42', 'assets') // → 'titles/42/assets'
parseId('titles/42/assets/7', 'assets') // → { isCompound: true, leafId: '7', ... }
```

---

## Examples

### Standard REST Model

```typescript
class Book extends BaseModel {
  static api = { endpoint: 'books' }
}
// list   → GET /books
// create → POST /books
// find   → GET /books/123
// update → PATCH /books/123
// delete → DELETE /books/123
```

### Non-Standard CRUD Paths

```typescript
class Book extends BaseModel {
  static api = {
    endpoint: 'books',
    endpoints: {
      collection: 'catalogue/book-items',
      create: 'books/draft',
      update: 'books/:id/revise',
      delete: 'books/:id/archive'
    }
  }
}
// list   → GET /catalogue/book-items
// create → POST /books/draft
// find   → GET /catalogue/book-items/123
// update → PATCH /books/123/revise
// delete → DELETE /books/123/archive
```

### Custom Actions (Publish, Archive, Export)

```typescript
class Book extends BaseModel {
  static api = {
    endpoint: 'books',
    convention: jsonApiConvention,
    actions: {
      publish: { path: ':id/publish', description: 'Publish a draft book' },
      archive: { path: ':id/archive', method: 'PATCH', description: 'Archive a book' },
      export: { path: ':id/export', method: 'GET', description: 'Export book data' }
    }
  }
}

await modelService.action('book', 'publish', { recordId: '42' })
// → POST /books/42/publish

await modelService.action('book', 'archive', {
  recordId: '42',
  attributes: { reason: 'outdated' }
})
// → PATCH /books/42/archive { "book": { "reason": "outdated" } }

await modelService.action('book', 'export', {
  recordId: '42',
  params: { format: 'pdf' }
})
// → GET /books/42/export?format=pdf
```

### Multi-Param Actions (Rails-Style)

```typescript
class Book extends BaseModel {
  static api = {
    endpoint: 'books',
    actions: {
      approve_chapter: {
        path: ':id/chapters/:chapter_id/approve',
        description: 'Approve a specific chapter'
      },
      generate_report: {
        path: 'reports/:report_type/:year/generate',
        method: 'GET',
        recordLevel: false,
        description: 'Generate a report'
      }
    }
  }
}

await modelService.action('book', 'approve_chapter', {
  recordId: '42',
  pathParams: { chapter_id: '5' }
})
// → POST /books/42/chapters/5/approve

await modelService.action('book', 'generate_report', {
  pathParams: { report_type: 'sales', year: '2026' }
})
// → GET /books/reports/sales/2026/generate
```

### Nested-Only Model with Custom Actions

```typescript
class Asset extends BaseModel {
  static api = {
    endpoint: 'assets',
    parent: 'title',
    standalone: false,
    actions: {
      publish: { path: ':id/publish', description: 'Publish an asset' },
      transcode: { path: ':id/transcode', method: 'POST', description: 'Start transcoding' }
    }
  }
}

// CRUD uses compound IDs / parentPath:
await modelService.find('asset', 'titles/42/assets/7')
await modelService.list('asset', {}, {}, { parentPath: 'titles/42/assets' })

// Actions use compound IDs:
await modelService.action('asset', 'publish', { recordId: 'titles/42/assets/7' })
// → POST /titles/42/assets/7/publish

await modelService.action('asset', 'transcode', {
  recordId: 'titles/42/assets/7',
  attributes: { format: 'h265', resolution: '4k' }
})
// → POST /titles/42/assets/7/transcode { "asset": { "format": "h265", "resolution": "4k" } }
```

### Read-Only Model with GET Actions

```typescript
class Report extends BaseModel {
  static api = {
    endpoint: 'reports',
    readOnly: true,
    actions: {
      download: { path: ':id/download', method: 'GET', description: 'Download report' },
      preview: { path: ':id/preview', method: 'GET', description: 'Preview report' }
    }
  }
}

// CRUD writes blocked:
await modelService.create('report', {}) // → throws ModelReadOnlyError

// Custom GET actions allowed:
await modelService.action('report', 'download', {
  recordId: '42',
  params: { format: 'csv' }
})
// → GET /reports/42/download?format=csv
```

### Collection-Level Action with Raw Payload

```typescript
class Book extends BaseModel {
  static api = {
    endpoint: 'books',
    actions: {
      bulk_publish: {
        path: 'bulk-publish',
        recordLevel: false,
        rawPayload: true,
        description: 'Publish multiple books at once'
      }
    }
  }
}

await modelService.action('book', 'bulk_publish', {
  attributes: { ids: [1, 2, 3], publish_date: '2026-01-01' }
})
// → POST /books/bulk-publish { "ids": [1, 2, 3], "publish_date": "2026-01-01" }
```
