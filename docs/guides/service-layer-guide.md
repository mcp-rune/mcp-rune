---
extension:
  kind: hook
  what: Request interceptors · domain error mapping
---

# Service Layer Guide

This guide covers the two services that sit between MCP tools and the API: `ModelService` for CRUD operations, and `SearchService` for search, lookup, and listing. Both compose lower-level primitives (EndpointResolver, Convention, SearchAdapter) into clean interfaces.

> **`ModelService` is the default adapter for the `DataLayer` seam introduced in v0.49.0.** The projection layer (tools, prompts, apps) talks to a `DataLayer` interface (`@mcp-rune/mcp-rune/core`); `ModelService implements DataLayer`. Integrators can swap in an alternative adapter — in-memory stub, third-party library wrapper — via the `dataLayer` factory option on `ToolRegistry` and `AppRegistry`. The CRUD surface and method signatures are unchanged; this guide describes the default adapter's behavior. See the changelog entry for v0.49.0 for migration notes (`BaseTool.apiClient` removed; tools now consume `this.dataLayer`).
>
> **`ModelService.action()` moved to the [`custom-actions` ApiExtension](./api-extensions.md) in v0.44.0.** It's still callable on the same instance — but only when `customActionsExtension()` is registered on `ToolRegistry`, which contributes it as a mixin. The signature and behavior are unchanged.
>
> **`SearchService`, `SearchAdapter`, `RailsSearchAdapter`, and their types moved to the [`search` ApiExtension](./api-extensions.md) in v0.47.0** (`@mcp-rune/mcp-rune/api-extensions/search`). The new `createSearchService(dataLayer, context)` factory (v0.49.0) is the recommended construction site for all three consumer clusters — it accepts a `DataLayer` so search composes with any adapter.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [EndpointResolver](#endpointresolver)
  - [Resolution Chain](#resolution-chain)
  - [Namespace Configuration](#namespace-configuration)
  - [Per-Action Endpoint Overrides](#per-action-endpoint-overrides)
  - [Compound IDs and Nested Resources](#compound-ids-and-nested-resources)
  - [Custom pathForType](#custom-pathfortype)
- [ModelService](#modelservice)
  - [Setup](#setup)
  - [CRUD Operations](#crud-operations)
  - [Domain Errors](#domain-errors)
- [SearchService](#searchservice)
  - [Setup](#setup-1)
  - [Search Resolution Chain](#search-resolution-chain)
  - [Lookup Resolution Chain](#lookup-resolution-chain)
  - [Group Search](#group-search)
  - [List (Always Available)](#list-always-available)
  - [Search Adapters](#search-adapters)
  - [Static Capability Queries](#static-capability-queries)
- [Tool Integration](#tool-integration)
  - [Injecting Services](#injecting-services)
- [ApiClient RequestOptions](#apiclient-requestoptions)
- [Design Boundaries](#design-boundaries)

---

## Overview

The service layer provides two focused services that encapsulate all API communication:

| Service             | Purpose                                                                       | Consumers                                                                                 | Composes                                  |
| ------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| **`ModelService`**  | CRUD operations + custom actions (create, find, list, update, delete, action) | CRUD tools, bulk tools, model_action tool                                                 | EndpointResolver + Convention + ApiClient |
| **`SearchService`** | Search, lookup, group search, listing                                         | search_records tool, analysis_ingest, MCP Apps (list, search, autocomplete, multi-select) | SearchAdapter + Convention + ApiClient    |

Both services follow the same pattern: wrap `ApiClient` with domain logic, resolve endpoints from model config, normalize requests/responses, and return clean results. Tools delegate data operations to these services and focus on MCP-specific concerns (input validation, response formatting, vector storage).

Supporting classes:

- **`EndpointResolver`** — layered URL resolution chain for CRUD (inspired by [Ember Data's Adapter pattern](https://guides.emberjs.com/release/models/customizing-adapters/))
- **`SearchAdapter`** / **`RailsSearchAdapter`** — pluggable request body builders for search endpoints

## Architecture

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

---

## EndpointResolver

`EndpointResolver` consolidates URL building logic into a single class with layered resolution chains for CRUD and custom actions. For the complete `ApiConfig` reference including custom actions (`ActionDefinition`), path parameter substitution, and compound ID interaction, see the [API Configuration Guide](api-config-guide.md).

### Resolution Chain

When resolving a collection endpoint (list or create):

1. **Per-action override** — `api.endpoints.create` (highest priority)
2. **Collection override** — `api.endpoints.collection`
3. **Parent path** — explicit `parentPath` for nested collection operations
4. **Namespace + convention** — `(model namespace || server namespace) / endpoint`

When resolving a record endpoint (find, update, delete):

1. **Per-action override** — `api.endpoints.update`, `api.endpoints.delete`
2. **Record override** — `api.endpoints.record` with `:id` substitution
3. **Compound ID** — if `recordId` contains `/`, it is used as the full path
4. **Namespace + convention** — `namespace / endpoint / recordId`

Each level falls through to the next if not configured. Explicit overrides (per-action, collection) bypass namespace — they are treated as full paths.

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
  static api = {
    endpoint: 'books',
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

### Compound IDs and Nested Resources

Nested resources are handled through **compound IDs** and the `parentPath` parameter, eliminating the need for separate nested routing configuration:

```typescript
class Asset extends BaseModel {
  static api = {
    endpoint: 'assets',
    parent: 'title', // Parent model name(s)
    standalone: false // No standalone endpoint (nested-only)
  }
}

// Record operations use compound IDs (the ID encodes the full path):
resolver.resolveRecord({ model: 'asset', modelConfig, recordId: 'titles/42/assets/7' })
// → 'titles/42/assets/7'

// Collection operations use parentPath:
resolver.resolveCollection({ model: 'asset', modelConfig, parentPath: 'titles/42/assets' })
// → 'titles/42/assets'

// Nested-only model without parentPath → throws MissingParentError
```

The `compound-id` module provides utilities for building these paths:

```typescript
import {
  buildCompoundId,
  buildCollectionPath,
  parseId
} from '@mcp-rune/mcp-rune/lib/mcp/services/index.js'

buildCompoundId('titles', '42', 'assets', '7') // → 'titles/42/assets/7'
buildCollectionPath('titles', '42', 'assets') // → 'titles/42/assets'
parseId('titles/42/assets/7', 'assets') // → { isCompound: true, leafId: '7', ... }
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
import { ModelService } from '@mcp-rune/mcp-rune/lib/mcp/services/index.js'

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
// Create — validates required fields, resolves endpoint, builds convention payload
const data = await modelService.create('book', { title: 'Test', author: 'Author' })

// Create nested — use parentPath for nested-only models
const asset = await modelService.create('asset', { name: 'HD' }, { parentPath: 'titles/42/assets' })

// Find — resolves record endpoint (supports compound IDs)
const book = await modelService.find('book', '123')
const nested = await modelService.find('asset', 'titles/42/assets/7')

// List — merges filters with pagination
const results = await modelService.list('book', { status: 'active' }, { page: 2, perPage: 10 })

// List nested — use parentPath for nested collections
const assets = await modelService.list('asset', {}, {}, { parentPath: 'titles/42/assets' })

// Update — builds convention payload (supports compound IDs)
const updated = await modelService.update('book', '123', { title: 'New Title' })

// Delete (supports compound IDs)
await modelService.delete('book', '123')

// With userId impersonation
const impersonated = await modelService.create('book', attrs, { userId: 'user-123' })

// Custom action — any HTTP method, any URL pattern
await modelService.action('book', 'publish', { recordId: '42' })
// → POST /books/42/publish

await modelService.action('book', 'approve_chapter', {
  recordId: '42',
  pathParams: { chapter_id: '5' }
})
// → POST /books/42/chapters/5/approve

await modelService.action('book', 'export', {
  recordId: '42',
  params: { format: 'pdf' }
})
// → GET /books/42/export?format=pdf
```

All methods return raw API responses (`Record<string, unknown>`) — no MCP formatting.

For the complete reference on custom actions, `ActionDefinition`, path parameter substitution, and `rawPayload`, see the [API Configuration Guide](api-config-guide.md).

### Domain Errors

ModelService throws typed errors that tools catch and format for the MCP protocol:

| Error                        | When                                   | Properties                  |
| ---------------------------- | -------------------------------------- | --------------------------- |
| `UnknownModelError`          | Model name not in registry             | `availableModels: string[]` |
| `ModelReadOnlyError`         | Write operation on read-only model     | —                           |
| `MissingRequiredFieldsError` | Create missing required attributes     | `missingFields: string[]`   |
| `MissingParentError`         | Nested-only model without `parentPath` | —                           |
| `UnknownActionError`         | Custom action not declared on model    | —                           |

```typescript
import { MissingRequiredFieldsError } from '@mcp-rune/mcp-rune/lib/mcp/services/index.js'

try {
  await modelService.create('book', { title: 'Test' }) // missing 'author'
} catch (error) {
  if (error instanceof MissingRequiredFieldsError) {
    return { content: [{ type: 'text', text: error.message }], isError: true }
  }
}
```

---

## SearchService

`SearchService` provides a normalized search interface for tools and apps. It wraps the API client with a 3-tier endpoint resolution chain for search and a separate chain for lookup (typeahead/autocomplete).

### Setup

The recommended construction site is the shared `createSearchService` factory:

```typescript
import { createSearchService, RailsSearchAdapter } from '@mcp-rune/mcp-rune/api-extensions/search'

const searchService = createSearchService(apiClient, {
  searchGroups: {
    // Optional — named group search endpoints
    catalogue: {
      endpoint: 'catalogue/search',
      modelsParam: 'models',
      queryParam: 'q'
    }
  },
  defaultAdapter: new RailsSearchAdapter({ filtersParam: 'filters' }) // Optional — server-wide adapter
})
```

Direct `new SearchService(apiClient, { ... })` is still supported for advanced use, but the factory is the single source of truth used by `SearchRecordsTool`, `apps/registry`, and `analysis-ingest-tool` — using it everywhere means future constructor changes ripple through one edit.

### Search Resolution Chain

`searchService.search(ModelClass, query, { page, perPage, filters })` resolves the search endpoint using a 3-tier chain. Internally it reads the model's search config through `getSearchConfig(ModelClass)` — the structural reader that works on `ModelConfig`, `AppModelClass`, and `SearchModelClass` uniformly:

1. **Direct endpoint** — `searchCfg.query.endpoint` exists → POST/GET to that endpoint
2. **Group search** — `searchCfg.query.group` exists → POST to shared group endpoint, scoped to this model's type
3. **List fallback** — neither configured → GET listing with first lookup field as filter

```typescript
import { searchConfig } from '@mcp-rune/mcp-rune/api-extensions/search'

// Path 1: Direct search endpoint
class Activity extends BaseModel {
  static api = { endpoint: 'activities' }
  static extensions = {
    search: searchConfig({
      query: { endpoint: 'activities/search', method: 'POST', queryParam: 'q' },
      filters: { theme_id: { type: 'relation' } },
      lookup: { fields: ['title'] }
    })
  }
}
const results = await searchService.search(Activity, 'React', {
  page: 1,
  perPage: 20,
  filters: { theme_id: '5' }
})
// → POST /activities/search { q: "React", theme_id: "5", page: 1, per_page: 20 }

// Path 2: Group search (multiple models share one search endpoint)
class Title extends BaseModel {
  static api = { endpoint: 'titles' }
  static extensions = {
    search: searchConfig({
      query: { group: 'catalogue', modelName: ['episode', 'feature'] },
      lookup: { fields: ['external_id'] }
    })
  }
}
const results = await searchService.search(Title, 'drama')
// → POST /catalogue/search { q: "drama", models: ["episode", "feature"], page: 1, per_page: 20 }

// Path 3: List fallback (no query config)
class Platform extends BaseModel {
  static api = { endpoint: 'platforms' }
  static extensions = {
    search: searchConfig({ lookup: { fields: ['name'] } })
  }
}
const results = await searchService.search(Platform, 'Netflix')
// → GET /platforms?name=Netflix&page=1&per_page=20
```

### Lookup Resolution Chain

`searchService.lookup(ModelClass, query, { perPage })` resolves typeahead/autocomplete with its own 3-tier chain:

1. **Dedicated lookup endpoint** — `searchCfg.lookup.endpoint` exists → GET to that endpoint
2. **Search fallback** — `searchCfg.query` exists → delegates to `search()`
3. **List fallback** — neither configured → GET listing with first lookup field

```typescript
// Path 1: Dedicated lookup endpoint
class Brand extends BaseModel {
  static api = { endpoint: 'brands' }
  static extensions = {
    search: searchConfig({
      query: { group: 'catalogue' },
      lookup: { endpoint: 'brands/autocomplete', fields: ['external_id'] }
    })
  }
}
const results = await searchService.lookup(Brand, 'BBC')
// → GET /brands/autocomplete?external_id=BBC&per_page=10

// Path 2: Falls through to search()
class Activity extends BaseModel {
  static extensions = {
    search: searchConfig({
      query: { endpoint: 'activities/search', method: 'POST', queryParam: 'q' },
      lookup: { fields: ['title'] }
    })
  }
}
const results = await searchService.lookup(Activity, 'Haskell')
// → POST /activities/search { q: "Haskell", page: 1, per_page: 10 }
```

### Group Search

Multi-model search across a named endpoint:

```typescript
const results = await searchService.groupSearch('catalogue', 'drama', {
  page: 1,
  perPage: 20,
  models: ['episode', 'feature'], // scope to specific model types
  filters: { status: 'published' }
})
// → POST /catalogue/search { q: "drama", models: [...], status: "published", page: 1, per_page: 20 }
```

### List (Always Available)

Paginated listing via GET — always works regardless of search configuration:

```typescript
const results = await searchService.list(BookModel, {
  page: 2,
  perPage: 50,
  status: 'reading',
  sort: 'title'
})
// → GET /books?page=2&per_page=50&status=reading&sort=title
```

List uses the model's Convention to normalize the response into `{ records, pagination }`.

### Search Adapters

Request bodies are built by pluggable adapters. The adapter is selected at three levels (highest priority first):

1. **Per-model** — `searchCfg.query.adapter` (i.e. the `adapter` field inside `searchConfig({...}).query`)
2. **Per-group** — `searchGroup.adapter`
3. **Server-wide** — `defaultAdapter` in the SearchService constructor

The base `SearchAdapter` spreads filters flat into the body. For Rails APIs that nest filters, use `RailsSearchAdapter`:

```typescript
import { RailsSearchAdapter } from '@mcp-rune/mcp-rune/api-extensions/search'

// Nests filters under a key + flattens range mappings
const adapter = new RailsSearchAdapter({ filtersParam: 'filters' })

// Input:  { duration_minutes: { from: 40, to: 120 } }
// Output: { filters: { min_duration: 40, max_duration: 120 } }
//   (via adapterConfig.rangeMappings on the model's search.query)
```

See the [Search & Filter Integration Guide](search-filter-integration-guide.md) for the full Rails integration walkthrough.

### Static Capability Queries

Query a model's search/lookup capability without instantiating a service:

```typescript
SearchService.getSearchCapability(BookModel) // → 'direct' | 'group' | 'list-only'
SearchService.getLookupCapability(BookModel) // → 'dedicated' | 'search-fallback' | 'list-fallback'
SearchService.getSearchGroup(BookModel) // → 'catalogue' | null
```

### Response Shape

All SearchService methods return a normalized `SearchResult`:

```typescript
interface SearchResult {
  records: Record<string, unknown>[]
  pagination: {
    page: number
    per_page: number
    total: number
    total_pages?: number
  }
}
```

---

## Tool Integration

### Injecting Services

Construct both services in your tool registry and pass them as dependencies:

```typescript
import { ModelService } from '@mcp-rune/mcp-rune/lib/mcp/services/index.js'
import {
  createSearchService,
  RailsSearchAdapter
} from '@mcp-rune/mcp-rune/api-extensions/search'

async _createAuthenticatedInstance(ToolClass, getAccessToken) {
  const token = await getAccessToken()
  const apiClient = createApiClient(token, { apiUrl })

  // Construct services from shared apiClient + models
  const modelService = new ModelService({
    apiClient,
    models: this.models,
    namespace: 'api/v1'
  })

  const searchService = createSearchService(apiClient, {
    searchGroups: this.serverContext.searchGroups,
    defaultAdapter: new RailsSearchAdapter({ filtersParam: 'filters' })
  })

  return new ToolClass({
    apiClient,
    modelService,        // CRUD tools delegate here
    // searchService — passed via serverContext for search tools/apps
    logger: this.logger,
    models: this.models,
    promptRegistry: this.promptRegistry,
    serverContext: { ...this.serverContext, searchService },
    domainRegistry: this.domainRegistry
  })
}
```

### Which service for which tool?

| Tool                                  | Service               | Why                                       |
| ------------------------------------- | --------------------- | ----------------------------------------- |
| `create_model`                        | ModelService          | Convention payload + endpoint resolution  |
| `find_records`                        | ModelService          | Record/list endpoint resolution           |
| `update_model`                        | ModelService          | Convention payload + record endpoint      |
| `delete_model`                        | ModelService          | Record endpoint resolution                |
| `model_action`                        | ModelService          | Custom actions with any HTTP method + URL |
| `bulk_action_models`                  | ModelService (future) | Batch CRUD operations                     |
| `search_records`                      | SearchService         | 3-tier search resolution + adapters       |
| `analysis_ingest`                     | SearchService         | Filtered multi-page ingestion             |
| MCP Apps (list, search, autocomplete) | SearchService         | Listing, search, lookup for UI rendering  |

### How ModelService is resolved

CRUD tools access `ModelService` via `this.requireModelService()`. `BaseTool` lazily constructs a `ModelService` from `apiClient` + `models` when one wasn't explicitly injected. This means:

- If you inject `modelService` explicitly, tools use that instance (with your custom namespace, resolver, etc.)
- If you only inject `apiClient` + `models`, tools auto-construct a default `ModelService`
- Custom tools that call `this.apiClient.get()` directly for non-model endpoints (e.g., `users/me`) are unaffected — `ModelService` is for model CRUD operations only

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

Both services are intentionally scoped to API data operations. They do **not** absorb:

| Concern                           | Stays in      | Why                                        |
| --------------------------------- | ------------- | ------------------------------------------ |
| MCP response formatting           | Tool layer    | `ToolResult`, `content[]` are MCP protocol |
| Vector storage (`storeOperation`) | Tool layer    | Cross-cutting, not data operations         |
| Usage rules / descriptions        | Tool layer    | LLM-facing metadata                        |
| Schema derivation                 | Prompt system | Prompt-specific concern                    |
| Filter validation                 | Tool layer    | MCP input validation                       |

### Why two services, not one?

ModelService and SearchService serve different purposes with different resolution strategies:

| Aspect              | ModelService                              | SearchService                                 |
| ------------------- | ----------------------------------------- | --------------------------------------------- |
| Operations          | CRUD (create, find, list, update, delete) | search, lookup, groupSearch, list             |
| Input               | Model name + attributes/ID                | ModelClass + query string + filters           |
| Endpoint resolution | EndpointResolver (5-level layered chain)  | Own 3-tier chain (direct → group → list)      |
| Request building    | Convention (`buildRequestPayload`)        | SearchAdapter (`buildBody`)                   |
| Response            | Raw API response                          | Normalized `{ records, pagination }`          |
| Consumers           | CRUD tools                                | Search tool, analysis_ingest, 5 MCP app types |

Merging them would force the apps layer to depend on CRUD concerns it doesn't need, and the fundamentally different resolution strategies would compete within a single class.

### The litmus test

**Would a non-MCP consumer use this?** If you imagine importing `ModelService` in a script to batch-create records, or `SearchService` to query an API from a CLI tool — everything they do should still make sense without any MCP protocol knowledge.
