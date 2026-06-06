# Custom Search Adapter Guide

A **search adapter** translates the MCP-generic search format (`{ query, filters, page, perPage }`) into the request shape your API expects. The default adapter (`SearchAdapter`) spreads filters flat into the POST body — fine for hand-rolled REST APIs but wrong for Rails Ransack, Elasticsearch DSL, JSON:API filter syntax, or anything that requires nesting.

You write a custom adapter when your API expects filters in a specific envelope and you want LLMs and forms to keep using the simple `filters: { author_id: 7, status: 'published' }` shape on the front end.

The adapter is purely about request shaping. Response normalization is the [convention's](./api-convention.md) job; URL composition is the `EndpointResolver`'s job.

## Table of Contents

- [The Class](#the-class)
- [`buildBody` vs `buildRequest` vs `_buildQueryParams`](#buildbody-vs-buildrequest-vs-_buildqueryparams)
- [Worked Example: Rails Ransack Adapter](#worked-example-rails-ransack-adapter)
- [Worked Example: Elasticsearch DSL Adapter](#worked-example-elasticsearch-dsl-adapter)
- [Per-Model Registration](#per-model-registration)
- [Global Default Adapter](#global-default-adapter)
- [`SearchGroup`: Multi-Model Routing](#searchgroup-multi-model-routing)
- [Testing](#testing)

## The Class

`SearchAdapter` lives at `@mcp-rune/mcp-rune/api-extensions/search`. It exposes one method you'll override (`buildBody`) and two extension hooks (`buildRequest`, `_buildQueryParams`).

```ts file=src/search/my-adapter.ts
import { SearchAdapter } from '@mcp-rune/mcp-rune/api-extensions/search'

class MyAdapter extends SearchAdapter {
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

```js file=src/search/my-adapter.js
import { SearchAdapter } from '@mcp-rune/mcp-rune/api-extensions/search'

class MyAdapter extends SearchAdapter {
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

```ts file=examples/search-adapter-guide-01.ts
buildRequest(query, filters, pagination, searchConfig) {
  return {
    body: this.buildBody(query, filters, pagination, searchConfig),
    queryParams: this._buildQueryParams(searchConfig)
  }
}
```

```js file=examples/search-adapter-guide-01.js
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

## Worked Example: Rails Ransack Adapter

Rails Ransack expects filters under a `q` key with predicates encoded in the field name (`q[author_id_eq]=7`, `q[title_cont]=clean`):

```ts file=src/adapters/ransack-adapter.ts
// your-server/search/ransack-adapter.ts
import { SearchAdapter } from '@mcp-rune/mcp-rune/api-extensions/search'
import type { Pagination, SearchConfig } from '@mcp-rune/mcp-rune/api-extensions/search'

export class RansackAdapter extends SearchAdapter {
  override buildBody(
    query: string | null,
    filters: Record<string, unknown> | undefined,
    { page, perPage }: Pagination,
    searchConfig: SearchConfig
  ): Record<string, unknown> {
    const body: Record<string, unknown> = { page, per_page: perPage }
    const q: Record<string, unknown> = {}

    if (query) {
      // Full-text search field configured on the model
      const textField = searchConfig?.query?.fullTextField ?? 'name'
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
```

```js file=src/adapters/ransack-adapter.js
// your-server/search/ransack-adapter.ts
import { SearchAdapter } from '@mcp-rune/mcp-rune/api-extensions/search'
export class RansackAdapter extends SearchAdapter {
  buildBody(query, filters, { page, perPage }, searchConfig) {
    const body = { page, per_page: perPage }
    const q = {}
    if (query) {
      // Full-text search field configured on the model
      const textField = searchConfig?.query?.fullTextField ?? 'name'
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
```

The LLM still calls `search` with `filters: { author_id: 7, status: 'published' }` — the adapter rewrites that into `q: { author_id_eq: 7, status_eq: 'published' }` on the wire.

## Worked Example: Elasticsearch DSL Adapter

Elasticsearch expects a `query` object with `bool.must` arrays. The MCP-generic filter format maps cleanly:

```ts file=src/adapters/elastic-adapter.ts
import { SearchAdapter } from '@mcp-rune/mcp-rune/api-extensions/search'
import type { Pagination, SearchConfig } from '@mcp-rune/mcp-rune/api-extensions/search'

export class ElasticAdapter extends SearchAdapter {
  override buildBody(
    query: string | null,
    filters: Record<string, unknown> | undefined,
    { page, perPage }: Pagination,
    searchConfig: SearchConfig
  ): Record<string, unknown> {
    const must: Record<string, unknown>[] = []

    if (query) {
      const fields = searchConfig?.query?.searchFields ?? ['_all']
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
```

```js file=src/adapters/elastic-adapter.js
import { SearchAdapter } from '@mcp-rune/mcp-rune/api-extensions/search'
export class ElasticAdapter extends SearchAdapter {
  buildBody(query, filters, { page, perPage }, searchConfig) {
    const must = []
    if (query) {
      const fields = searchConfig?.query?.searchFields ?? ['_all']
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
```

`SearchService` POSTs this to your Elasticsearch endpoint. The response normalization (`hits.hits[]._source` → records) belongs in your [convention](./api-convention.md), not in the adapter.

## Per-Model Registration

Attach an adapter to the model's search config:

```ts file=src/book.ts
import { ransackAdapter } from './search/ransack-adapter'

class Book extends BaseModel {
  static singularName = 'book'
  static api = { endpoint: 'books' }

  static extensions = {
    search: {
      query: {
        endpoint: 'books/search',
        queryParam: 'q',
        searchFields: ['title', 'author_name'],
        adapter: ransackAdapter
      },
      filters: {
        author_id: { type: 'integer', description: 'Filter by author' },
        status: { type: 'enum', enumValues: ['draft', 'published'] }
      }
    }
  }
}
```

```js file=src/book.js
import { ransackAdapter } from './search/ransack-adapter'
class Book extends BaseModel {
  static singularName = 'book'
  static api = { endpoint: 'books' }
  static extensions = {
    search: {
      query: {
        endpoint: 'books/search',
        queryParam: 'q',
        searchFields: ['title', 'author_name'],
        adapter: ransackAdapter
      },
      filters: {
        author_id: { type: 'integer', description: 'Filter by author' },
        status: { type: 'enum', enumValues: ['draft', 'published'] }
      }
    }
  }
}
```

The `search` extension picks the adapter from `Model.extensions.search.query.adapter` per call. Different models can use different adapters in the same server.

## Global Default Adapter

If most of your models share an adapter, set it once on `AppRegistry` (or pass it to `createDefaultAppRegistry`):

```ts file=src/registries/app-registry.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { ransackAdapter } from './search/ransack-adapter'

export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookshelf',
  defaultAdapter: ransackAdapter
})
```

```js file=src/registries/app-registry.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { ransackAdapter } from './search/ransack-adapter'
export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookshelf',
  defaultAdapter: ransackAdapter
})
```

Per-model `query.adapter` overrides the default — use the global as a baseline.

## `SearchGroup`: Multi-Model Routing

Some APIs have a single search endpoint that takes a `model` (or `type`) parameter:

```
POST /search { type: 'book', q: 'clean code', page: 1 }
```

`SearchGroup` lets you route multiple models to one endpoint:

```ts file=src/registries/app-registry.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'library',
  searchGroups: {
    catalog: {
      endpoint: 'search',
      modelsParam: 'type',
      adapter: ransackAdapter
    }
  }
})
```

```js file=src/registries/app-registry.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'library',
  searchGroups: {
    catalog: {
      endpoint: 'search',
      modelsParam: 'type',
      adapter: ransackAdapter
    }
  }
})
```

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

The group's adapter handles body shaping; the group's endpoint receives the request. Models in the same group share the adapter and endpoint.

## Testing

Adapters are pure classes — no DOM, no framework dependencies. Unit-test `buildBody` directly:

```ts file=src/adapter.ts
import { describe, expect, it } from 'vitest'
import { RansackAdapter } from '../src/search/ransack-adapter'

const adapter = new RansackAdapter()
const searchConfig = { query: { fullTextField: 'title' } }

describe('RansackAdapter', () => {
  it('wraps filters under q with _eq predicate by default', () => {
    const body = adapter.buildBody(null, { author_id: 7 }, { page: 1, perPage: 10 }, searchConfig)
    expect(body).toEqual({ page: 1, per_page: 10, q: { author_id_eq: 7 } })
  })

  it('preserves an explicit predicate in the field name', () => {
    const body = adapter.buildBody(
      null,
      { title_cont: 'clean' },
      { page: 1, perPage: 10 },
      searchConfig
    )
    expect(body.q).toEqual({ title_cont: 'clean' })
  })

  it('maps full-text query through fullTextField with _cont', () => {
    const body = adapter.buildBody('haskell', undefined, { page: 1, perPage: 10 }, searchConfig)
    expect(body.q).toEqual({ title_cont: 'haskell' })
  })

  it('skips null and undefined filter values', () => {
    const body = adapter.buildBody(
      null,
      { author_id: null, status: 'published' },
      { page: 1, perPage: 10 },
      searchConfig
    )
    expect(body.q).toEqual({ status_eq: 'published' })
  })
})
```

```js file=src/adapter.js
import { describe, expect, it } from 'vitest'
import { RansackAdapter } from '../src/search/ransack-adapter'
const adapter = new RansackAdapter()
const searchConfig = { query: { fullTextField: 'title' } }
describe('RansackAdapter', () => {
  it('wraps filters under q with _eq predicate by default', () => {
    const body = adapter.buildBody(null, { author_id: 7 }, { page: 1, perPage: 10 }, searchConfig)
    expect(body).toEqual({ page: 1, per_page: 10, q: { author_id_eq: 7 } })
  })
  it('preserves an explicit predicate in the field name', () => {
    const body = adapter.buildBody(
      null,
      { title_cont: 'clean' },
      { page: 1, perPage: 10 },
      searchConfig
    )
    expect(body.q).toEqual({ title_cont: 'clean' })
  })
  it('maps full-text query through fullTextField with _cont', () => {
    const body = adapter.buildBody('haskell', undefined, { page: 1, perPage: 10 }, searchConfig)
    expect(body.q).toEqual({ title_cont: 'haskell' })
  })
  it('skips null and undefined filter values', () => {
    const body = adapter.buildBody(
      null,
      { author_id: null, status: 'published' },
      { page: 1, perPage: 10 },
      searchConfig
    )
    expect(body.q).toEqual({ status_eq: 'published' })
  })
})
```

Integration-test end-to-end through `SearchService` with a stub `ApiClient` — assertions check that the POSTed body matches what you'd expect for the LLM's input.

---

**Related guides:**

- [Search Filter Integration Guide](../04-apps-search-forms/search-filters.md) — the MCP-side and Rails-side story for structured filters.
- [API Extensions](../09-extensions/api-extensions.md) — `searchExtension` registers `SearchService` as a `ModelService` mixin.
- [Custom API Convention](./api-convention.md) — response shaping (where records and pagination come out) is the convention's job.
- [Service Layer Guide](../03-tools-and-services/service-layer.md) — `SearchService` composition.
