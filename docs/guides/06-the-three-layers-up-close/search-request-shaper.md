> **Customization:** per-model via `searchConfig({ query: { shaper } })`; globally via `defaultShaper:` on `ToolRegistry` / `AppRegistry` (or `createDefaultAppRegistry`). Default spreads filters flat into the POST body. Subclass `SearchRequestShaper` for Ransack, Elasticsearch DSL, or any nested-filter API.

# Search request shaper

A **search request shaper** translates the MCP-generic search format (`{ query, filters, page, perPage }`) into the request shape your API expects. The default shaper spreads filters flat into the POST body — fine for hand-rolled REST APIs but wrong for Rails Ransack, Elasticsearch DSL, JSON:API filter syntax, or anything that requires nesting.

> **v0.77.0:** the `SearchAdapter` type was renamed to `SearchRequestShaper`. The shape is unchanged; the new name reflects the verb (shaping a request) rather than the architectural role ("adapter," which was already overloaded with `DataLayer` adapters).

You write a custom shaper when your API expects filters in a specific envelope and you want LLMs and forms to keep using the simple `filters: { author_id: 7, status: 'published' }` shape on the front end.

The shaper is purely about request shaping. Response normalization is the [convention's](./api-convention.md) job; URL composition is the `EndpointResolver`'s job.

## Table of Contents

- [The Class](#the-class)
- [`buildBody` vs `buildRequest` vs `_buildQueryParams`](#buildbody-vs-buildrequest-vs-_buildqueryparams)
- [Built-in Shapers](#built-in-shapers)
- [Worked Example: Rails Ransack Shaper](#worked-example-rails-ransack-shaper)
- [Worked Example: Elasticsearch DSL Shaper](#worked-example-elasticsearch-dsl-shaper)
- [Per-Model Registration](#per-model-registration)
- [Global Default Shaper](#global-default-shaper)
- [`SearchGroup`: Multi-Model Routing](#searchgroup-multi-model-routing)
- [Testing](#testing)

## The Class

`SearchRequestShaper` lives at `@mcp-rune/mcp-rune/api-extensions/search`. It exposes one method you'll override (`buildBody`) and two extension hooks (`buildRequest`, `_buildQueryParams`).

```ts file=src/search/my-shaper.ts
import { SearchRequestShaper } from '@mcp-rune/mcp-rune/api-extensions/search'

class MyShaper extends SearchRequestShaper {
  override buildBody(
    query: string | null,
    filters: Record<string, unknown> | undefined,
    pagination: { page: number; perPage: number },
    searchConfig: SearchConfig
  ): Record<string, unknown> {
    // shape the body
  }
}
```

```js file=src/search/my-shaper.js
import { SearchRequestShaper } from '@mcp-rune/mcp-rune/api-extensions/search'

class MyShaper extends SearchRequestShaper {
  buildBody(query, filters, pagination, searchConfig) {
    // shape the body
  }
}
```

The base implementation:

```
{ q: 'haskell', page: 1, per_page: 20, category_id: 4, status: 'active' }
```

Flat. That's the contract you usually want to break.

## `buildBody` vs `buildRequest` vs `_buildQueryParams`

The three hooks are concentric scopes — pick the **narrowest** one that does the job:

<!-- illustration: search-adapter#scope -->

```
   SearchService.search()
            │
            ▼
   ┌─────────────────────────────────────────────────────┐
   │  buildRequest()                          (rare)     │
   │   ┌──────────────────────────────────────────────┐  │
   │   │  buildBody()                  (95% of cases) │  │
   │   │   shape the POST body / filter envelope      │  │
   │   └──────────────────────────────────────────────┘  │
   │                                                     │
   │   ┌──────────────────────────────────────────────┐  │
   │   │  _buildQueryParams()               (edge)    │  │
   │   │   add expansion hints, sparse fieldsets,     │  │
   │   │   etc. as URL params                         │  │
   │   └──────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────┘
```

- Inner `buildBody()` — reshape the POST body. Almost all customizations sit here.
- Inner `_buildQueryParams()` — when extra metadata rides on the URL rather than the body.
- Outer `buildRequest()` — only when body and query params have to be derived together (the body depends on a value that also appears as a query param, or vice versa).

`buildRequest` is the top-level entry point `SearchService` calls. It returns `{ body, queryParams }` — a body POSTed to the endpoint and an optional query string appended to the URL.

```ts file=examples/search-shaper-guide-01.ts
buildRequest(query, filters, pagination, searchConfig) {
  return {
    body: this.buildBody(query, filters, pagination, searchConfig),
    queryParams: this._buildQueryParams(searchConfig)
  }
}
```

```js file=examples/search-shaper-guide-01.js
buildRequest(query, filters, pagination, searchConfig)
{
  return {
    body: this.buildBody(query, filters, pagination, searchConfig),
    queryParams: this._buildQueryParams(searchConfig)
  }
}
```

Override:

- **`buildBody`** when you need to reshape the POST body. This is 95% of customizations.
- **`_buildQueryParams`** when your API takes additional concerns (expansion hints, sparse fieldsets) as URL params rather than body params. The default supports `searchConfig.query.expand`.
- **`buildRequest`** itself only when body and query params have to be derived together (rare).

## Built-in Shapers

Two shapers ship with the framework:

- **`SearchRequestShaper`** — the default; spreads filters flat into the POST body alongside the query and pagination params.
- **`RailsSearchRequestShaper`** — for Rails-convention endpoints. It nests filters under a configurable `filtersParam` key — set server-wide via the constructor (`new RailsSearchRequestShaper({ filtersParam: 'filters' })`) or per model via `shaperConfig.filtersParam` — and flattens `{ from, to }` range values into the flat keys your API expects via per-model `shaperConfig.rangeMappings` (e.g., `duration_minutes: { from: 'min_duration', to: 'max_duration' }`).

`QueryConfig.shaperConfig` is the typed per-model knob bag for shaper-specific settings; per-model `shaperConfig` values take precedence over constructor defaults. The custom shapers in the worked examples below read their own knobs from the same bag.

## Worked Example: Rails Ransack Shaper

Rails Ransack expects filters under a `q` key with predicates encoded in the field name (`q[author_id_eq]=7`, `q[title_cont]=clean`):

```ts file=src/shapers/ransack-shaper.ts
// your-server/shapers/ransack-shaper.ts
import { SearchRequestShaper } from '@mcp-rune/mcp-rune/api-extensions/search'
import type { Pagination, SearchConfig } from '@mcp-rune/mcp-rune/api-extensions/search'

export class RansackShaper extends SearchRequestShaper {
  override buildBody(
    query: string | null,
    filters: Record<string, unknown> | undefined,
    { page, perPage }: Pagination,
    searchConfig: SearchConfig
  ): Record<string, unknown> {
    const body: Record<string, unknown> = { page, per_page: perPage }
    const q: Record<string, unknown> = {}

    if (query) {
      // Full-text search field, read from the model's shaperConfig knob bag
      const textField = (searchConfig?.query?.shaperConfig?.fullTextField as string) ?? 'name'
      q[`${textField}_cont`] = query
    }

    if (filters) {
      for (const [field, value] of Object.entries(filters)) {
        if (value === undefined || value === null) continue
        // Detect predicate from suffix if the LLM provided one, otherwise default to _eq
        const hasPredicate = /_(eq|cont|in|gteq|lteq|gt|lt|start|end)$/.test(field)
        const key = hasPredicate ? field : `${field}_eq`
        q[key] = value
      }
    }

    if (Object.keys(q).length > 0) body.q = q
    return body
  }
}

export const ransackShaper = new RansackShaper()
```

```js file=src/shapers/ransack-shaper.js
// your-server/shapers/ransack-shaper.js
import { SearchRequestShaper } from '@mcp-rune/mcp-rune/api-extensions/search'
export class RansackShaper extends SearchRequestShaper {
  buildBody(query, filters, { page, perPage }, searchConfig) {
    const body = { page, per_page: perPage }
    const q = {}
    if (query) {
      // Full-text search field, read from the model's shaperConfig knob bag
      const textField = searchConfig?.query?.shaperConfig?.fullTextField ?? 'name'
      q[`${textField}_cont`] = query
    }
    if (filters) {
      for (const [field, value] of Object.entries(filters)) {
        if (value === undefined || value === null) continue
        // Detect predicate from suffix if the LLM provided one, otherwise default to _eq
        const hasPredicate = /_(eq|cont|in|gteq|lteq|gt|lt|start|end)$/.test(field)
        const key = hasPredicate ? field : `${field}_eq`
        q[key] = value
      }
    }
    if (Object.keys(q).length > 0) body.q = q
    return body
  }
}

export const ransackShaper = new RansackShaper()
```

The LLM still calls `search` with `filters: { author_id: 7, status: 'published' }` — the shaper rewrites that into `q: { author_id_eq: 7, status_eq: 'published' }` on the wire. The full-text field comes from `query.shaperConfig` — the typed knob bag for shaper-specific settings — so a model declares `shaperConfig: { fullTextField: 'title' }` in its search config.

## Worked Example: Elasticsearch DSL Shaper

Elasticsearch expects a `query` object with `bool.must` arrays. The MCP-generic filter format maps cleanly:

```ts file=src/shapers/elastic-shaper.ts
import { SearchRequestShaper } from '@mcp-rune/mcp-rune/api-extensions/search'
import type { Pagination, SearchConfig } from '@mcp-rune/mcp-rune/api-extensions/search'

export class ElasticShaper extends SearchRequestShaper {
  override buildBody(
    query: string | null,
    filters: Record<string, unknown> | undefined,
    { page, perPage }: Pagination,
    searchConfig: SearchConfig
  ): Record<string, unknown> {
    const must: Record<string, unknown>[] = []

    if (query) {
      const fields = (searchConfig?.query?.shaperConfig?.searchFields as string[]) ?? ['_all']
      must.push({ multi_match: { query, fields, type: 'best_fields' } })
    }

    if (filters) {
      for (const [field, value] of Object.entries(filters)) {
        if (value === undefined || value === null) continue
        if (Array.isArray(value)) {
          must.push({ terms: { [field]: value } })
        } else {
          must.push({ term: { [field]: value } })
        }
      }
    }

    return {
      from: (page - 1) * perPage,
      size: perPage,
      query: must.length > 0 ? { bool: { must } } : { match_all: {} }
    }
  }
}

export const elasticShaper = new ElasticShaper()
```

```js file=src/shapers/elastic-shaper.js
import { SearchRequestShaper } from '@mcp-rune/mcp-rune/api-extensions/search'
export class ElasticShaper extends SearchRequestShaper {
  buildBody(query, filters, { page, perPage }, searchConfig) {
    const must = []
    if (query) {
      const fields = searchConfig?.query?.shaperConfig?.searchFields ?? ['_all']
      must.push({ multi_match: { query, fields, type: 'best_fields' } })
    }
    if (filters) {
      for (const [field, value] of Object.entries(filters)) {
        if (value === undefined || value === null) continue
        if (Array.isArray(value)) {
          must.push({ terms: { [field]: value } })
        } else {
          must.push({ term: { [field]: value } })
        }
      }
    }
    return {
      from: (page - 1) * perPage,
      size: perPage,
      query: must.length > 0 ? { bool: { must } } : { match_all: {} }
    }
  }
}

export const elasticShaper = new ElasticShaper()
```

`SearchService` POSTs this to your Elasticsearch endpoint. The response normalization (`hits.hits[]._source` → records) belongs in your [convention](./api-convention.md), not in the shaper. The `searchFields` list is read from the model's `query.shaperConfig` knob bag, same as the Ransack example above.

## Per-Model Registration

Attach a shaper to the model's search config:

```ts file=src/book.ts
import { ransackShaper } from './shapers/ransack-shaper'

class Book extends BaseModel {
  static singularName = 'book'
  static api = { endpoint: 'books' }

  static extensions = {
    search: {
      query: {
        endpoint: 'books/search',
        queryParam: 'q',
        shaperConfig: { fullTextField: 'title' },
        shaper: ransackShaper
      },
      filters: {
        author_id: { type: 'relation', relatedModel: 'author', description: 'Filter by author' },
        status: { type: 'enum', enumValues: ['draft', 'published'] }
      }
    }
  }
}
```

```js file=src/book.js
import { ransackShaper } from './shapers/ransack-shaper'
class Book extends BaseModel {
  static singularName = 'book'
  static api = { endpoint: 'books' }
  static extensions = {
    search: {
      query: {
        endpoint: 'books/search',
        queryParam: 'q',
        shaperConfig: { fullTextField: 'title' },
        shaper: ransackShaper
      },
      filters: {
        author_id: { type: 'relation', relatedModel: 'author', description: 'Filter by author' },
        status: { type: 'enum', enumValues: ['draft', 'published'] }
      }
    }
  }
}
```

The data layer picks the shaper from `Model.extensions.search.query.shaper` per call. Different models can use different shapers in the same server.

## Global Default Shaper

If most of your models share a shaper, declare the instance once and pass it to **both** registries — `search_records` (tools) and the MCP apps then shape requests identically. `ToolRegistry` and `AppRegistry` accept the same `defaultShaper` (and `searchGroups`) options; `createDefaultAppRegistry` forwards them to the `AppRegistry` it builds:

```ts file=src/registries/app-registry.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

import { ransackShaper } from '../shapers/ransack-shaper'

export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookshelf',
  defaultShaper: ransackShaper
})
```

```js file=src/registries/app-registry.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { ransackShaper } from '../shapers/ransack-shaper'
export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookshelf',
  defaultShaper: ransackShaper
})
```

```ts file=src/registries/tool-registry.ts
import { searchExtension } from '@mcp-rune/mcp-rune/api-extensions/search'
import { DATA_TOOL_CLASSES, ToolRegistry } from '@mcp-rune/mcp-rune/tools'

import { ransackShaper } from '../shapers/ransack-shaper'

export const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient,
  apiExtensions: { search: searchExtension() },
  // Same instance as the AppRegistry above — tools and apps shape requests identically
  defaultShaper: ransackShaper
})
```

```js file=src/registries/tool-registry.js
import { searchExtension } from '@mcp-rune/mcp-rune/api-extensions/search'
import { DATA_TOOL_CLASSES, ToolRegistry } from '@mcp-rune/mcp-rune/tools'
import { ransackShaper } from '../shapers/ransack-shaper'
export const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient,
  apiExtensions: { search: searchExtension() },
  // Same instance as the AppRegistry above — tools and apps shape requests identically
  defaultShaper: ransackShaper
})
```

Per-model `query.shaper` overrides the default — use the global as a baseline.

## `SearchGroup`: Multi-Model Routing

Some APIs have a single search endpoint that takes a `model` (or `type`) parameter:

```
POST /search { type: 'book', q: 'clean code', page: 1 }
```

`SearchGroup` lets you route multiple models to one endpoint:

```ts file=src/registries/app-registry.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

import { ransackShaper } from '../shapers/ransack-shaper'

export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'library',
  searchGroups: {
    catalog: {
      // Routing half — drives request shaping
      endpoint: 'search',
      modelsParam: 'type',
      shaper: ransackShaper,
      // Presentation half — drives the pick-model app UI
      label: 'Library Catalog',
      description: 'Books and authors in one search',
      typeField: 'type',
      models: ['book', 'author']
    }
  }
})
```

```js file=src/registries/app-registry.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { ransackShaper } from '../shapers/ransack-shaper'
export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'library',
  searchGroups: {
    catalog: {
      // Routing half — drives request shaping
      endpoint: 'search',
      modelsParam: 'type',
      shaper: ransackShaper,
      // Presentation half — drives the pick-model app UI
      label: 'Library Catalog',
      description: 'Books and authors in one search',
      typeField: 'type',
      models: ['book', 'author']
    }
  }
})
```

A `SearchGroup` carries two halves: the routing half (`endpoint`, `modelsParam`, `shaper`) drives `groupSearch` request shaping, and the presentation half (`label`, `description`, `typeField`, `models`) drives pickers that expose the group. `createDefaultAppRegistry` forwards the same group objects to the pick-model app, so one declaration serves both the tools and the apps.

Each model opts into a group:

```ts file=src/book.ts
class Book extends BaseModel {
  static extensions = {
    search: { query: { group: 'catalog' } }
  }
}
```

```js file=src/book.js
class Book extends BaseModel {
  static extensions = {
    search: { query: { group: 'catalog' } }
  }
}
```

The group's shaper handles body shaping; the group's endpoint receives the request. Models in the same group share the shaper and endpoint.

## Testing

Shapers are pure classes — no DOM, no framework dependencies. Unit-test `buildBody` directly:

```ts file=test/ransack-shaper.test.ts
import { describe, expect, it } from 'vitest'
import { RansackShaper } from '../src/shapers/ransack-shaper'

const shaper = new RansackShaper()
const searchConfig = { query: { shaperConfig: { fullTextField: 'title' } } }

describe('RansackShaper', () => {
  it('wraps filters under q with _eq predicate by default', () => {
    const body = shaper.buildBody(null, { author_id: 7 }, { page: 1, perPage: 10 }, searchConfig)
    expect(body).toEqual({ page: 1, per_page: 10, q: { author_id_eq: 7 } })
  })

  it('preserves an explicit predicate in the field name', () => {
    const body = shaper.buildBody(
      null,
      { title_cont: 'clean' },
      { page: 1, perPage: 10 },
      searchConfig
    )
    expect(body.q).toEqual({ title_cont: 'clean' })
  })

  it('maps full-text query through fullTextField with _cont', () => {
    const body = shaper.buildBody('haskell', undefined, { page: 1, perPage: 10 }, searchConfig)
    expect(body.q).toEqual({ title_cont: 'haskell' })
  })

  it('skips null and undefined filter values', () => {
    const body = shaper.buildBody(
      null,
      { author_id: null, status: 'published' },
      { page: 1, perPage: 10 },
      searchConfig
    )
    expect(body.q).toEqual({ status_eq: 'published' })
  })
})
```

```js file=test/ransack-shaper.test.js
import { describe, expect, it } from 'vitest'
import { RansackShaper } from '../src/shapers/ransack-shaper'
const shaper = new RansackShaper()
const searchConfig = { query: { shaperConfig: { fullTextField: 'title' } } }
describe('RansackShaper', () => {
  it('wraps filters under q with _eq predicate by default', () => {
    const body = shaper.buildBody(null, { author_id: 7 }, { page: 1, perPage: 10 }, searchConfig)
    expect(body).toEqual({ page: 1, per_page: 10, q: { author_id_eq: 7 } })
  })
  it('preserves an explicit predicate in the field name', () => {
    const body = shaper.buildBody(
      null,
      { title_cont: 'clean' },
      { page: 1, perPage: 10 },
      searchConfig
    )
    expect(body.q).toEqual({ title_cont: 'clean' })
  })
  it('maps full-text query through fullTextField with _cont', () => {
    const body = shaper.buildBody('haskell', undefined, { page: 1, perPage: 10 }, searchConfig)
    expect(body.q).toEqual({ title_cont: 'haskell' })
  })
  it('skips null and undefined filter values', () => {
    const body = shaper.buildBody(
      null,
      { author_id: null, status: 'published' },
      { page: 1, perPage: 10 },
      searchConfig
    )
    expect(body.q).toEqual({ status_eq: 'published' })
  })
})
```

Integration-test end-to-end through `SearchService` with a stub `DataLayer` — assertions check that the POSTed body matches what you'd expect for the LLM's input.

---

**Related guides:**

- [Search Filter Integration Guide](../06-the-three-layers-up-close/search-filters.md) — the MCP-side and Rails-side story for structured filters.
- [API Extensions](../10-extensions/api-extensions.md) — `searchExtension()` contributes the `search_records` and `get_filters_guide` tools; the registries construct `SearchService` via `createSearchService` and hide it behind `SearchEnabledDataLayer`.
- [Custom API Convention](./api-convention.md) — response shaping (where records and pagination come out) is the convention's job.
- [Model service](./model-service.md) — `SearchService` composition.
