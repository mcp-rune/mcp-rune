# DataLayer Guide

`DataLayer` is the seam between mcp-rune's projection layer (polymorphic CRUD tools, prompt strategies, schema-driven apps, domain workflows) and any concrete data backend. It declares the operations the projection layer needs; the default implementation is `ModelService` wrapping an `ApiClient`, but you can swap in an in-memory stub, a fetch-only adapter, or a third-party library wrapper without changing tools, prompts, or apps.

The seam exists for two reasons:

1. The projection layer is what makes mcp-rune unique. The data layer overlaps heavily with mature client-side libraries (Warp Drive / Ember Data, Zodios, ts-rest, etc.). Naming the seam lets the ecosystem decide which adapter to use without forking the framework.
2. The pre-v0.49 framework leaked `apiClient` across tools and apps. Closing the leak — and exposing a single typed surface — makes the boundary auditable.

## Table of Contents

- [The Interface](#the-interface)
- [The Default Adapter](#the-default-adapter)
- [Swapping the Adapter](#swapping-the-adapter)
- [Using DataLayer in a Custom Tool](#using-datalayer-in-a-custom-tool)
- [In-Memory Stub for Tests](#in-memory-stub-for-tests)
- [Writing Your Own Adapter](#writing-your-own-adapter)
- [Why Conventions Stay Below the Seam](#why-conventions-stay-below-the-seam)

## The Interface

```ts
import type { DataLayer } from '@mcp-rune/mcp-rune/core'

interface DataLayer {
  create(model, attributes, options?)
  find(model, recordId, options?)
  list(model, filters?, pagination?, options?)
  update(model, recordId, attributes, options?)
  delete(model, recordId, options?)
  dispatch(method, url, payload?, params?, options?)
  buildPayload(model, modelConfig, attrs)
  readonly models: ModelsRegistry
  readonly endpointResolver: EndpointResolver // unstable; for custom-actions
}
```

Every method returns `Promise<Record<string, unknown>>`. Adapters are responsible for their own response normalization upstream of this boundary; the projection layer treats payloads as opaque.

## The Default Adapter

`ModelService` (`@mcp-rune/mcp-rune/lib/mcp/services`) implements `DataLayer` by composing:

- `ApiClient` for HTTP transport
- `EndpointResolver` for URL composition (per-action override → collection override → parent path → namespace → base)
- `BaseConvention` for payload wrapping and association resolution (JSON:API, HAL, custom)

If you don't configure anything, `ToolRegistry` and `AppRegistry` instantiate `ModelService` automatically and apply any `ApiExtension` mixins (`custom-actions`, etc.).

## Swapping the Adapter

Both `ToolRegistry` and `AppRegistry` accept a `dataLayer` factory option:

```ts
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

The factory signature is:

```ts
type DataLayerFactory = (ctx: {
  apiClient?: ApiClient
  models: ModelsRegistry
  namespace?: string
  logger?: ToolLogger
}) => DataLayer
```

`apiClient` is passed by the registry whenever `createApiClient` is configured. Adapters that don't need HTTP (in-memory stub, library-backed wrappers) can ignore it.

## Using DataLayer in a Custom Tool

```ts
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

`requireDataLayer()` returns the bound `DataLayer` and throws `Error('Not authenticated. Please authenticate first.')` if the tool ran without authentication. For typed CRUD, prefer the named methods over `dispatch`:

```ts
const book = await this.requireDataLayer().find('book', '42')
const books = await this.requireDataLayer().list(
  'book',
  { status: 'unread' },
  { page: 1, perPage: 20 }
)
```

## In-Memory Stub for Tests

`InMemoryDataLayer` (also exported from `@mcp-rune/mcp-rune/core`) is the reference adapter for offline tool tests:

```ts
import { InMemoryDataLayer } from '@mcp-rune/mcp-rune/core'

const dataLayer = new InMemoryDataLayer({
  models: { book: { api: { endpoint: 'books' } } },
  fixtures: { book: { '1': { id: '1', title: 'Clean Code' } } }
})

const tool = new FindRecordsTool({ dataLayer, models: dataLayer.models })
const result = await tool.execute({ model: 'book', record_id: '1' })
```

The stub is deliberately convention-free — it does not implement HAL `_link` decoration or any other API-specific shape. Use it to verify projection-layer behavior, not to mock a particular backend.

## Writing Your Own Adapter

An adapter is any class or object that satisfies the `DataLayer` interface. Minimal example wrapping a fetch-based REST client:

```ts
import type { DataLayer, ModelsRegistry } from '@mcp-rune/mcp-rune/core'
import { EndpointResolver } from '@mcp-rune/mcp-rune/lib/mcp/services/index.js'

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
}
```

Adapters that already speak HTTP can usually subclass `ModelService` and override the convention or endpoint-resolution behavior instead of reimplementing the whole interface.

## Why Conventions Stay Below the Seam

The `BaseConvention` interface (`JsonApiConvention`, `HalConvention`, custom) is **not** part of `DataLayer`. Conventions are consumed by:

- The default `ModelService.buildPayload` (internal to the default adapter)
- Prompt and app schema generators that read `modelConfig.api.convention` as static metadata for deriving form schemas and field documentation

A non-HTTP adapter (in-memory stub, GraphQL-backed adapter) has no use for HAL link generation but still needs to satisfy the projection layer's static introspection. Keeping conventions out of the runtime seam preserves that asymmetry.
