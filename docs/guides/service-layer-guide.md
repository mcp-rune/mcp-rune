# Service Layer Guide

This guide covers the `ModelService` and `EndpointResolver` — a service layer that sits between MCP tools and the API client, providing flexible endpoint resolution, convention-based payloads, and typed domain errors.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [EndpointResolver](#endpointresolver)
  - [Resolution Chain](#resolution-chain)
  - [Namespace Configuration](#namespace-configuration)
  - [Per-Action Endpoint Overrides](#per-action-endpoint-overrides)
  - [Nested Routing](#nested-routing)
  - [Custom pathForType](#custom-pathfortype)
- [ModelService](#modelservice)
  - [Setup](#setup)
  - [CRUD Operations](#crud-operations)
  - [Domain Errors](#domain-errors)
- [Tool Integration](#tool-integration)
  - [Injecting ModelService](#injecting-modelservice)
  - [Backward Compatibility](#backward-compatibility)
- [ApiClient RequestOptions](#apiclient-requestoptions)
- [Design Boundaries](#design-boundaries)

---

## Overview

Prior to the service layer, each CRUD tool (create, find, update, delete) directly resolved endpoints from model config, built payloads via conventions, and called the API client. This scattered endpoint resolution logic across 7+ files and coupled tools to API routing concerns.

The service layer extracts these responsibilities into two focused classes:

- **`EndpointResolver`** — URL resolution with a layered chain (inspired by [Ember Data's Adapter pattern](https://guides.emberjs.com/release/models/customizing-adapters/))
- **`ModelService`** — CRUD operations composing EndpointResolver + Convention + ApiClient

Tools become thin MCP-protocol adapters: validate input, call the service, format the response.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  MCP Tool Layer                                  │
│  (input validation, response formatting,         │
│   vector storage, usage rules)                   │
└──────────────┬──────────────────┬───────────────┘
               │                  │
    ┌──────────▼──────┐  ┌───────▼────────┐
    │  ModelService    │  │  SearchClient   │
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

---

## EndpointResolver

`EndpointResolver` consolidates URL building logic into a single class with a layered resolution chain.

### Resolution Chain

When resolving a collection endpoint (list or create):

1. **Per-action override** — `api.endpoints.create` (highest priority)
2. **Collection override** — `api.endpoints.collection`
3. **Parent resource** — explicit `parentResource` (bulk operations)
4. **Nested routing** — `api.nested.pathTemplate` with `:parentKey` substitution
5. **Namespace + convention** — `(model namespace || server namespace) / endpoint`

When resolving a record endpoint (find, update, delete):

1. **Per-action override** — `api.endpoints.update`, `api.endpoints.delete`
2. **Record override** — `api.endpoints.record` with `:id` substitution
3. **Namespace + convention** — `namespace / endpoint / recordId`

Each level falls through to the next if not configured. Explicit overrides (per-action, collection, nested templates) bypass namespace — they are treated as full paths.

### Namespace Configuration

Namespaces prefix all model endpoints with an API path segment.

**Server-wide namespace** (applies to all models):

```typescript
const resolver = new EndpointResolver({ namespace: 'api/v1' })

// book.endpoint = 'books'
resolver.resolveCollection({ model: 'book', modelConfig }) // → 'api/v1/books'
resolver.resolveRecord({ model: 'book', modelConfig, recordId: '1' }) // → 'api/v1/books/1'
```

**Per-model override** (model-level takes priority):

```typescript
// Model config:
{ endpoint: 'books', api: { namespace: 'api/v2' } }

// Server namespace is 'api/v1', but this model uses 'api/v2':
resolver.resolveCollection(...) // → 'api/v2/books'
```

### Per-Action Endpoint Overrides

For APIs with non-standard paths, override specific actions on `ApiConfig`:

```typescript
class Book extends BaseModel {
  static endpoint = 'books'
  static api = {
    endpoints: {
      collection: 'catalogue/book-items', // list + create
      record: 'catalogue/book-items/:id', // find + update + delete
      create: 'books/draft', // create only (overrides collection)
      update: 'books/:id/revise', // update only (overrides record)
      delete: 'books/:id/archive' // delete only (overrides record)
    }
  }
}

// Resolution:
// list   → 'catalogue/book-items'
// create → 'books/draft'           (per-action > collection)
// find   → 'catalogue/book-items/123'
// update → 'books/123/revise'      (per-action > record)
// delete → 'books/123/archive'     (per-action > record)
```

### Nested Routing

Nested models use `pathTemplate` with `:parentKey` substitution (unchanged from before):

```typescript
class Scheduling extends BaseModel {
  static endpoint = 'schedulings'
  static api = {
    nested: {
      parent: 'book',
      nestedOnly: true,
      pathTemplate: 'books/:book_id/schedulings',
      parentKey: 'book_id'
    }
  }
}

// With attributes { book_id: '42' }:
resolver.resolveCollection(...) // → 'books/42/schedulings'

// Without book_id when nestedOnly → throws MissingParentError
```

### Custom pathForType

Override `pathForType` in a subclass for APIs that use different naming conventions:

```typescript
class DasherizedResolver extends EndpointResolver {
  override pathForType(model: string): string {
    return model.replace(/_/g, '-') + 's'
  }
}

const resolver = new DasherizedResolver({ namespace: 'api/v1' })
// model 'book_item', endpoint 'book_items'
resolver.resolveCollection(...) // → 'api/v1/book-items'
```

---

## ModelService

`ModelService` composes EndpointResolver + Convention + ApiClient to provide a clean CRUD interface.

### Setup

```typescript
import { ModelService } from 'mcp-kit/lib/mcp/services/index.js'

const modelService = new ModelService({
  apiClient, // Required — HTTP client implementing ApiClient
  models: modelsRegistry, // Required — model name → ModelConfig map
  namespace: 'api/v1', // Optional — server-wide namespace
  endpointResolver: resolver, // Optional — custom resolver (default created from namespace)
  logger // Optional — ToolLogger for debug output
})
```

### CRUD Operations

```typescript
// Create — validates required fields, resolves nested endpoint, builds convention payload
const data = await modelService.create('book', { title: 'Test', author: 'Author' })

// Find — resolves record endpoint
const book = await modelService.find('book', '123')

// List — merges filters with pagination
const results = await modelService.list('book', { status: 'active' }, { page: 2, perPage: 10 })

// Update — builds convention payload for partial update
const updated = await modelService.update('book', '123', { title: 'New Title' })

// Delete
await modelService.delete('book', '123')

// Nested resources
const reviews = await modelService.getNestedResources('book', '42', 'reviews', { page: 1 })

// With userId impersonation
const data = await modelService.create('book', attrs, { userId: 'user-123' })
```

All methods return raw API responses (`Record<string, unknown>`) — no MCP formatting.

### Domain Errors

ModelService throws typed errors that tools catch and format for the MCP protocol:

| Error                        | When                                | Properties                  |
| ---------------------------- | ----------------------------------- | --------------------------- |
| `UnknownModelError`          | Model name not in registry          | `availableModels: string[]` |
| `ModelReadOnlyError`         | Write operation on read-only model  | —                           |
| `MissingRequiredFieldsError` | Create missing required attributes  | `missingFields: string[]`   |
| `MissingParentError`         | Nested-only model without parent ID | —                           |

```typescript
import { MissingRequiredFieldsError } from 'mcp-kit/lib/mcp/services/index.js'

try {
  await modelService.create('book', { title: 'Test' }) // missing 'author'
} catch (error) {
  if (error instanceof MissingRequiredFieldsError) {
    return { content: [{ type: 'text', text: error.message }], isError: true }
  }
}
```

---

## Tool Integration

### Injecting ModelService

Add `modelService` to your tool registry's dependency construction:

```typescript
async _createAuthenticatedInstance(ToolClass, getAccessToken) {
  const token = await getAccessToken()
  const apiClient = createApiClient(token, { apiUrl })

  // Construct ModelService from apiClient + models
  const modelService = new ModelService({
    apiClient,
    models: this.models,
    namespace: 'api/v1'  // optional
  })

  return new ToolClass({
    apiClient,
    modelService,        // NEW — tools delegate CRUD here
    logger: this.logger,
    models: this.models,
    promptRegistry: this.promptRegistry,
    serverContext: this.serverContext,
    domainRegistry: this.domainRegistry
  })
}
```

### Backward Compatibility

`modelService` is **optional** in `ToolDependencies`. When not provided:

- CRUD tools fall back to direct `apiClient` calls (pre-service-layer behavior)
- No code changes required in existing tool registries
- Adopt incrementally by adding `modelService` when ready

Custom tools that call `this.apiClient.get()` directly for non-CRUD endpoints (e.g., `users/me`) continue to work unchanged — ModelService is for model CRUD operations only.

---

## ApiClient RequestOptions

All `ApiClient` methods now accept an optional third parameter for request options:

```typescript
interface RequestOptions {
  userId?: string
  [key: string]: unknown
}

interface ApiClient {
  get(url: string, params?: Record<string, unknown>, options?: RequestOptions): Promise<...>
  post(url: string, data?: Record<string, unknown>, options?: RequestOptions): Promise<...>
  patch(url: string, data?: Record<string, unknown>, options?: RequestOptions): Promise<...>
  delete(url: string, options?: RequestOptions): Promise<...>
}
```

This is backward-compatible — existing ApiClient implementations that only accept 2 parameters continue to work. The extra argument is silently ignored by JavaScript until the implementation is updated to handle it.

---

## Design Boundaries

ModelService is intentionally scoped to API data operations. It does **not** absorb:

| Concern                           | Stays in      | Why                                        |
| --------------------------------- | ------------- | ------------------------------------------ |
| MCP response formatting           | Tool layer    | `ToolResult`, `content[]` are MCP protocol |
| Vector storage (`storeOperation`) | Tool layer    | Cross-cutting, not CRUD                    |
| Usage rules / descriptions        | Tool layer    | LLM-facing metadata                        |
| Schema derivation                 | Prompt system | Prompt-specific concern                    |
| Filter validation                 | Tool layer    | MCP input validation                       |

The test: **would a non-MCP consumer use this?** If you imagine importing `ModelService` in a script to batch-create records without MCP, everything it does should still make sense.
