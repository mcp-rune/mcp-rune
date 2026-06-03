---
extension:
  kind: override
  what: Implement a custom DataLayer
---

# DataLayer Guide

`DataLayer` is the seam between mcp-rune's projection layer (polymorphic CRUD tools, prompt strategies, schema-driven apps, domain workflows) and any concrete data backend. It declares the operations the projection layer needs; the default implementation is `ModelService` wrapping an `ApiClient`, but you can swap in an in-memory stub, a fetch-only adapter, or a third-party library wrapper without changing tools, prompts, or apps.

The seam exists for two reasons:

1. The projection layer is what makes mcp-rune unique. The data layer overlaps heavily with mature client-side libraries (Warp Drive / Ember Data, Zodios, ts-rest, etc.). Naming the seam lets the ecosystem decide which adapter to use without forking the framework.
2. The pre-v0.49 framework leaked `apiClient` across tools and apps. Closing the leak — and exposing a single typed surface — makes the boundary auditable.

At a glance, the seam and what sits above and below it:

```
   ┌────────────────────────────────────────────────────┐
   │   Projection layer                                 │
   │     tools · prompts · apps · workflows             │
   └──────────────────────┬─────────────────────────────┘
                          │   reads/writes through ONLY
                          ▼
   ┌────────────────────────────────────────────────────┐
   │   DataLayer  (interface)                           │
   │     create · find · list · update · delete         │
   │     listNormalized · searchNormalized · ...        │
   │     dispatch / buildPayload  (escape hatches)      │
   └──────────────────────┬─────────────────────────────┘
                          │
                          ▼
   ┌────────────────────────────────────────────────────┐
   │   Default adapter: ModelService                    │
   │     ├─ ApiClient   (HTTP verbs against URLs)       │
   │     └─ Convention  (payload / association shape)   │
   └────────────────────────────────────────────────────┘
```

The projection layer never imports `ApiClient`, `SearchClient`, or a `Convention` directly — `DataLayer` is the only seam it crosses. Swap the adapter (in-memory stub, fetch-only, third-party wrapper) without touching anything above the line.

## Table of Contents

- [The Interface](#the-interface)
- [The Projection-Layer Rule](#the-projection-layer-rule)
- [The Default Adapter](#the-default-adapter)
  - [Adding search to the default adapter](#adding-search-to-the-default-adapter)
- [Swapping the Adapter](#swapping-the-adapter)
- [Using DataLayer in a Custom Tool](#using-datalayer-in-a-custom-tool)
- [In-Memory Stub for Tests](#in-memory-stub-for-tests)
- [Writing Your Own Adapter](#writing-your-own-adapter)
- [Why Conventions Stay Below the Seam](#why-conventions-stay-below-the-seam)

## The Interface

```ts file=src/layers/data-layer.ts
import type { DataLayer } from '@mcp-rune/mcp-rune/core'

interface DataLayer {
  // CRUD
  create(model, attributes, options?)
  find(model, recordId, options?)
  list(model, filters?, pagination?, options?)
  update(model, recordId, attributes, options?)
  delete(model, recordId, options?)

  // Normalized read surface — the projection layer consumes these for reads
  listNormalized(model, filters?, pagination?, options?)
  searchNormalized(model, query?, filters?, pagination?, options?)
  lookupNormalized(model, query, options?)
  groupSearchNormalized(group, query, options?)

  // Escape hatches
  dispatch(method, url, payload?, params?, options?)
  buildPayload(model, modelConfig, attrs)

  readonly models: ModelsRegistry
  readonly endpointResolver: EndpointResolver // unstable; for custom-actions
}
```

```js file=src/layers/data-layer.js
/**
 * The seam between the projection layer (polymorphic CRUD tools, prompt
 * strategies, schema-driven apps) and any concrete data backend. Reads
 * flow through the four `*Normalized` methods; writes through CRUD.
 *
 * @typedef {Object} DataLayer
 * @property {(model: string, attributes: Object, options?: Object) => Promise<Object>} create
 * @property {(model: string, recordId: string, options?: Object) => Promise<Object>} find
 * @property {(model: string, filters?: Object, pagination?: Object, options?: Object) => Promise<Object>} list
 * @property {(model: string, recordId: string, attributes: Object, options?: Object) => Promise<Object>} update
 * @property {(model: string, recordId: string, options?: Object) => Promise<Object>} delete
 * @property {(model: string, filters?: Object, pagination?: Object, options?: Object) => Promise<NormalizedListResponse>} listNormalized
 * @property {(model: string, query?: string, filters?: Object, pagination?: Object, options?: Object) => Promise<NormalizedListResponse>} searchNormalized
 * @property {(model: string, query: string, options?: { perPage?: number }) => Promise<NormalizedListResponse>} lookupNormalized
 * @property {(group: string, query: string, options?: { perPage?: number, models?: string[] }) => Promise<NormalizedListResponse>} groupSearchNormalized
 * @property {(method: string, url: string, payload?: Object, params?: Object, options?: Object) => Promise<Object>} dispatch
 * @property {(model: string, modelConfig: Object, attrs: Object) => Object} buildPayload
 * @property {ModelsRegistry} models
 * @property {EndpointResolver} endpointResolver  unstable; for custom-actions
 */
```

Every CRUD method returns `Promise<Record<string, unknown>>`; the four `*Normalized` methods return `Promise<NormalizedListResponse>` (`{ records, pagination }`). Adapters are responsible for their own response normalization upstream of this boundary; the projection layer treats payloads as opaque.

The read surface splits by intent: `listNormalized` for "give me a page", `searchNormalized` for "find records matching a text query and/or filters", `lookupNormalized` for "single-model typeahead", `groupSearchNormalized` for "multi-model typeahead across a configured group". Base adapters without a search backend may delegate the latter three to `listNormalized`; the [`SearchEnabledDataLayer`](#adding-search-to-the-default-adapter) decorator is what actually implements text-search routing.

## The Projection-Layer Rule

> **Apps, tools, prompts, and domain workflows consume only the `DataLayer` interface.** They must never import `SearchService`, `ApiClient`, or `ModelService` directly. When the projection layer needs a capability the interface doesn't expose, the right move is to extend `DataLayer` with a method and implement it in adapters (or in a decorator like [`SearchEnabledDataLayer`](#adding-search-to-the-default-adapter)) — not to reach around the seam.

This is the load-bearing contract that lets alternative adapters slot in. Three things hold the rule up:

- **`AppRegistry.registerTools`** wraps the configured DataLayer factory output in `SearchEnabledDataLayer` and exposes only `context.dataLayer` to app handlers. There is no `context.searchClient`. Apps cannot violate the rule because the seam doesn't expose it.
- **`BaseTool.requireDataLayer()`** is the only sanctioned way for tools to read the seam. It throws if the tool ran without authentication; it never hands back an `ApiClient`.
- **`InMemoryDataLayer`** has no HTTP transport and no search engine. Code paths that reach past the interface (e.g., importing `ModelService` to coerce a method) fail loudly when run against the stub, surfacing the leak at test time rather than in production.

Why the rule pays off:

- **Adapter interchangeability.** The same projection-layer code runs against `ModelService` (HTTP), `InMemoryDataLayer` (tests), and any future library-backed adapter (Zodios, fetch-only, GraphQL).
- **One auditable surface.** "What can a tool ask the data layer to do?" is answered by reading one TypeScript file.
- **Honest extensions.** The pattern for extending the seam is documented and copy-paste-able — the `search` ApiExtension is the worked example.

## The Default Adapter

`ModelService` (`@mcp-rune/mcp-rune/model-service`) implements `DataLayer` by composing:

- `ApiClient` for HTTP transport
- `EndpointResolver` for URL composition (per-action override → collection override → parent path → namespace → base)
- `BaseConvention` for payload wrapping and association resolution (JSON:API, HAL, custom)

If you don't configure anything, `ToolRegistry` and `AppRegistry` instantiate `ModelService` automatically and apply any `ApiExtension` mixins (`custom-actions`, etc.).

### Adding search to the default adapter

Plain `ModelService` has no notion of search endpoints — it delegates `searchNormalized` and `lookupNormalized` to `listNormalized` and throws on `groupSearchNormalized`. The `search` ApiExtension ships a decorator that wraps any `DataLayer` and routes the three search-related methods through `SearchService`:

```ts file=src/registry.ts
import { withSearchEnabledDataLayer } from '@mcp-rune/mcp-rune/api-extensions/search'

const base = new ModelService({ apiClient, models, namespace })
const dataLayer = withSearchEnabledDataLayer(base, { searchGroups, defaultAdapter })
```

```js file=src/registry.js
import { withSearchEnabledDataLayer } from '@mcp-rune/mcp-rune/api-extensions/search'

const base = new ModelService({ apiClient, models, namespace })
const dataLayer = withSearchEnabledDataLayer(base, { searchGroups, defaultAdapter })
```

`AppRegistry.registerTools` does this automatically — every app handler receives a `dataLayer` already wrapped. `ToolRegistry` does not auto-wrap today; tools that need text search call `withSearchEnabledDataLayer` explicitly.

The decorator is a thin proxy: every CRUD method forwards to the base adapter; the three search methods route through `SearchService.search` / `.lookup` / `.groupSearch`. Apps cannot tell whether they're talking to a raw `ModelService` or the search-enabled wrapper — they call `dataLayer.searchNormalized` either way.

## Swapping the Adapter

Both `ToolRegistry` and `AppRegistry` accept a `dataLayer` factory option:

```ts file=src/registry.ts
import { createInMemoryDataLayer } from '@mcp-rune/mcp-rune/core'

const registry = new ToolRegistry({
  toolClasses: { ...DATA_TOOL_CLASSES, custom_tool: MyTool },
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  dataLayer: createInMemoryDataLayer({
    fixtures: {
      book: {
        '1': { id: '1', title: 'Clean Code', author: 'Bob Martin' }
      }
    }
  })
})
```

```js file=src/registry.js
import { createInMemoryDataLayer } from '@mcp-rune/mcp-rune/core'

const registry = new ToolRegistry({
  toolClasses: { ...DATA_TOOL_CLASSES, custom_tool: MyTool },
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  dataLayer: createInMemoryDataLayer({
    fixtures: {
      book: {
        1: { id: '1', title: 'Clean Code', author: 'Bob Martin' }
      }
    }
  })
})
```

The factory signature is:

```ts file=src/data-layer-factory.ts
type DataLayerFactory = (ctx: {
  apiClient?: ApiClient
  models: ModelsRegistry
  namespace?: string
  logger?: ToolLogger
}) => DataLayer
```

```js file=src/data-layer-factory.js
/**
 * The factory ToolRegistry / AppRegistry call to build a DataLayer.
 * `apiClient` is populated whenever `createApiClient` is configured;
 * adapters that don't need HTTP can ignore it.
 *
 * @typedef {Object} DataLayerFactoryCtx
 * @property {ApiClient} [apiClient]
 * @property {ModelsRegistry} models
 * @property {string} [namespace]
 * @property {ToolLogger} [logger]
 *
 * @typedef {(ctx: DataLayerFactoryCtx) => DataLayer} DataLayerFactory
 */
```

`apiClient` is passed by the registry whenever `createApiClient` is configured. Adapters that don't need HTTP (in-memory stub, library-backed wrappers) can ignore it.

## Using DataLayer in a Custom Tool

```ts file=src/tools/archive-project-tool.ts
import { BaseTool, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'

export class ArchiveProjectTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.CUSTOM
  }

  override get name() {
    return 'archive_project'
  }

  override async execute({ project_id }: { project_id: string }) {
    const dataLayer = this.requireDataLayer()
    return dataLayer.dispatch('POST', `/projects/${project_id}/archive`)
  }
}
```

```js file=src/tools/archive-project-tool.js
import { BaseTool, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'

export class ArchiveProjectTool extends BaseTool {
  static get category() {
    return TOOL_CATEGORIES.CUSTOM
  }

  get name() {
    return 'archive_project'
  }

  async execute({ project_id }) {
    const dataLayer = this.requireDataLayer()
    return dataLayer.dispatch('POST', `/projects/${project_id}/archive`)
  }
}
```

`requireDataLayer()` returns the bound `DataLayer` and throws `Error('Not authenticated. Please authenticate first.')` if the tool ran without authentication. For typed CRUD, prefer the named methods over `dispatch`:

```ts file=src/book.ts
const book = await this.requireDataLayer().find('book', '42')
const books = await this.requireDataLayer().list(
  'book',
  { status: 'unread' },
  { page: 1, perPage: 20 }
)
```

```js file=src/book.js
const book = await this.requireDataLayer().find('book', '42')
const books = await this.requireDataLayer().list(
  'book',
  { status: 'unread' },
  { page: 1, perPage: 20 }
)
```

## In-Memory Stub for Tests

`InMemoryDataLayer` (also exported from `@mcp-rune/mcp-rune/core`) is the reference adapter for offline tool tests:

```ts file=src/__tests__/find-tool.test.ts
import { InMemoryDataLayer } from '@mcp-rune/mcp-rune/core'

const dataLayer = new InMemoryDataLayer({
  models: { book: { api: { endpoint: 'books' } } },
  fixtures: { book: { '1': { id: '1', title: 'Clean Code' } } }
})

const tool = new FindRecordsTool({ dataLayer, models: dataLayer.models })
const result = await tool.execute({ model: 'book', record_id: '1' })
```

```js file=src/__tests__/find-tool.test.js
import { InMemoryDataLayer } from '@mcp-rune/mcp-rune/core'

const dataLayer = new InMemoryDataLayer({
  models: { book: { api: { endpoint: 'books' } } },
  fixtures: { book: { 1: { id: '1', title: 'Clean Code' } } }
})

const tool = new FindRecordsTool({ dataLayer, models: dataLayer.models })
const result = await tool.execute({ model: 'book', record_id: '1' })
```

The stub is deliberately convention-free — it does not implement HAL `_link` decoration or any other API-specific shape. Use it to verify projection-layer behavior, not to mock a particular backend.

## Writing Your Own Adapter

An adapter is any class or object that satisfies the `DataLayer` interface. Minimal example wrapping a fetch-based REST client:

```ts file=src/adapters/fetch-data-layer.ts
import type { DataLayer, NormalizedListResponse } from '@mcp-rune/mcp-rune/core'
import type { ModelsRegistry } from '@mcp-rune/mcp-rune/tools'
import { EndpointResolver } from '@mcp-rune/mcp-rune/model-service'

export class FetchDataLayer implements DataLayer {
  readonly models: ModelsRegistry
  readonly endpointResolver = new EndpointResolver()

  constructor(
    public baseUrl: string,
    models: ModelsRegistry
  ) {
    this.models = models
  }

  async create(model, attributes) {
    const endpoint = this.models[model]!.api.endpoint
    const res = await fetch(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attributes)
    })
    return res.json()
  }

  // ... find / list / update / delete / dispatch / buildPayload

  async listNormalized(model, filters, pagination): Promise<NormalizedListResponse> {
    const raw = await this.list(model, filters, pagination)
    return { records: raw.data ?? [], pagination: raw.meta ?? { page: 1, per_page: 20, total: 0 } }
  }

  // No text-search backend on this adapter — wrap with `withSearchEnabledDataLayer`
  // if you want `dataLayer.searchNormalized` to honor a query.
  async searchNormalized(model, _query, filters, pagination) {
    return this.listNormalized(model, filters, pagination)
  }

  async lookupNormalized(model, _query, options) {
    return this.listNormalized(model, undefined, { page: 1, perPage: options?.perPage ?? 10 })
  }

  async groupSearchNormalized(_group, _query, _options): Promise<NormalizedListResponse> {
    throw new Error('Group search requires the search ApiExtension')
  }
}
```

```js file=src/adapters/fetch-data-layer.js
import { EndpointResolver } from '@mcp-rune/mcp-rune/model-service'

export class FetchDataLayer {
  endpointResolver = new EndpointResolver()

  constructor(baseUrl, models) {
    this.baseUrl = baseUrl
    this.models = models
  }

  async create(model, attributes) {
    const endpoint = this.models[model].api.endpoint
    const res = await fetch(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attributes)
    })
    return res.json()
  }

  // ... find / list / update / delete / dispatch / buildPayload

  async listNormalized(model, filters, pagination) {
    const raw = await this.list(model, filters, pagination)
    return { records: raw.data ?? [], pagination: raw.meta ?? { page: 1, per_page: 20, total: 0 } }
  }

  async searchNormalized(model, _query, filters, pagination) {
    return this.listNormalized(model, filters, pagination)
  }

  async lookupNormalized(model, _query, options) {
    return this.listNormalized(model, undefined, { page: 1, perPage: options?.perPage ?? 10 })
  }

  async groupSearchNormalized(_group, _query, _options) {
    throw new Error('Group search requires the search ApiExtension')
  }
}
```

Adapters that already speak HTTP can usually subclass `ModelService` and override the convention or endpoint-resolution behavior instead of reimplementing the whole interface. To add text search, compose with `withSearchEnabledDataLayer` rather than reimplementing the routing chain.

## Why Conventions Stay Below the Seam

The `BaseConvention` interface (`JsonApiConvention`, `HalConvention`, custom) is **not** part of `DataLayer`. Conventions are consumed by:

- The default `ModelService.buildPayload` (internal to the default adapter)
- Prompt and app schema generators that read `modelConfig.api.convention` as static metadata for deriving form schemas and field documentation

A non-HTTP adapter (in-memory stub, GraphQL-backed adapter) has no use for HAL link generation but still needs to satisfy the projection layer's static introspection. Keeping conventions out of the runtime seam preserves that asymmetry.
