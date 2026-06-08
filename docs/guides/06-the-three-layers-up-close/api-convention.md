# API convention

A **convention** owns everything wire-format-specific about your API: how request payloads are wrapped, how association IDs translate into the form your backend expects, how list responses are unpacked into `{ records, pagination }`, and how response envelopes are stripped of protocol noise before reaching tools and prompts.

The previous two chapters covered `ModelService` (the default `DataLayer` implementation) and `ApiClient` (the HTTP seam it composes). This chapter covers the third collaborator — the convention — and the v0.85.0 change that moved the default-convention seam from `BaseModel` to the `DataLayer` factory.

mcp-rune ships two conventions in `src/mcp/api-conventions/`:

- **`jsonApiConvention`** — JSON:API wrapping (`{ data: { type, attributes, relationships } }`), used as the default.
- **`defaultConvention`** — re-exports `jsonApiConvention`. The framework's "use this if you don't know what you need" entry point.

You write a custom convention when your API:

- Is **HAL** (`_embedded`, `_links`).
- Uses **flat unwrapped payloads** and a hand-rolled pagination scheme (`{ items, page, total }`).
- Has an **idiosyncratic envelope** (Rails-style `{ data: [...], meta: {...} }`, or a wrapper your team invented years ago).

The seam isolates that idiosyncrasy. Tools, prompts, apps, and the form-app iframes never see your envelope — they see normalized records.

The same `belongsTo` and `hasMany` declarations produce different wire payloads depending on which convention is active:

<!-- illustration: api-convention#conv -->

```
                  Internal record
              ┌────────────────────────┐
              │ Book {                 │
              │   title: "Clean Code", │
              │   author: <Author#7>,  │  ← belongsTo
              │   tags:   [<Tag#1>,    │  ← hasMany
              │           <Tag#3>]     │
              │ }                      │
              └───────────┬────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
        HAL                       JSON:API
   ┌─────────────────────┐   ┌──────────────────────────────┐
   │  {                  │   │  {                           │
   │    title: "...",    │   │    data: {                   │
   │    author_link:     │   │      type: "books",          │
   │      "/authors/7",  │   │      attributes: {           │
   │    author_id: 7,    │   │        title: "..."          │
   │    tag_ids: [1, 3]  │   │      },                      │
   │  }                  │   │      relationships: {        │
   │                     │   │        author: { data: {     │
   │  belongsTo:         │   │          type: "authors",    │
   │   {rel}_link +      │   │          id: "7" } },        │
   │   {rel}_id          │   │        tags:   { data: [...] │
   │                     │   │      }                       │
   │  hasMany:           │   │    }                         │
   │   {singular}_ids[]  │   │  }                           │
   │                     │   │                              │
   └─────────────────────┘   └──────────────────────────────┘
```

Tools and prompts above the convention only see the _internal_ record — they never branch on HAL vs JSON:API. Adding a third convention (custom envelope) is a single class; nothing in the layer above changes.

## Table of Contents

- [The Interface](#the-interface)
- [Method Roles](#method-roles)
- [Worked Example: HAL Convention](#worked-example-hal-convention)
- [Worked Example: Flat REST Convention](#worked-example-flat-rest-convention)
- [Wiring Per Model](#wiring-per-model)
- [Wiring Globally](#wiring-globally)
- [Testing a Convention](#testing-a-convention)
- [Where Conventions Sit](#where-conventions-sit)

## The Interface

```ts file=src/conventions/my-convention.ts
import {
  BaseConvention,
  type AssociationConfig,
  type BelongsToAssociation,
  type ErrorResponse,
  type FieldDefinition,
  type HasManyAssociation,
  type NormalizedListResponse
} from '@mcp-rune/mcp-rune/prompts'

class MyConvention extends BaseConvention {
  get name(): string { return 'my-convention' }

  resolveAssociationFields(
    relName: string,
    relConfig: BelongsToAssociation | HasManyAssociation,
    overrides?: Record<string, Partial<FieldDefinition>>
  ): Record<string, FieldDefinition>

  resolveAssociationValues(
    attrs: Record<string, unknown>,
    belongsTo?: Record<string, BelongsToAssociation>,
    apiBaseUrl?: string
  ): Record<string, unknown>

  buildRequestPayload(model: string, attrs: Record<string, unknown>): Record<string, unknown>

  normalizeListResponse(
    response: Record<string, unknown> | unknown[],
    options: { page: number; perPage: number }
  ): NormalizedListResponse

  cleanResponse(data: unknown): unknown
  parseErrorResponse(response: ErrorResponse): string[]
  flattenExpandedResources(...)
  extractNestedRecords(...)
}
```

```js file=src/conventions/my-convention.js
import { BaseConvention } from '@mcp-rune/mcp-rune/prompts'
class MyConvention extends BaseConvention {
  get name() {
    return 'my-convention'
  }
}
```

The first five are the must-implement methods. The bottom three have sensible defaults you can override when your wire format demands it.

## Method Roles

### `resolveAssociationFields(relName, relConfig, overrides?)`

Drives **schema derivation** (`schema-derivation.ts`). Given a model's association config, return the field definitions a deployer can use in prompts and forms.

- **JSON:API** convention emits one field per `belongsTo`: `{rel}_id` (the LLM and the form know to send IDs).
- **HAL** convention emits two: `{rel}_link` (the URL) and `{rel}_id` (the parsed ID for convenience), because HAL APIs need the link on submit.
- Either convention emits `{singular}_ids` (an array) per `hasMany`.

### `resolveAssociationValues(attrs, belongsTo?, apiBaseUrl?)`

Runs **at submit time** inside `ModelService` before payload construction. Translates the LLM/form's `_id` fields into the convention's wire fields.

- JSON:API: no-op (the API accepts `_id` directly).
- HAL: rewrites `title_id: 123` → `title_link: "https://api.example.com/titles/123"`.

### `buildRequestPayload(model, attrs)`

Wraps the attribute hash into the API's expected request body.

- JSON:API: `{ [model]: attrs }`.
- HAL: flat — the server wraps internally.

### `normalizeListResponse(response, { page, perPage })`

Unpacks a list response into `{ records, pagination }`. Pagination is `{ page, perPage, total, totalPages, hasMore }`. Tools and apps never see raw response envelopes.

### `cleanResponse(data)`

Strips protocol noise. HAL strips `_links` and `_embedded` (after expansion). JSON:API drops the `data.type` and unwraps `data.attributes`. Called at the `ApiClient` boundary so every consumer sees clean records.

### `parseErrorResponse(response)`

Turns a non-2xx response into a flat list of error message strings the framework can show in tool responses. Default implementation handles strings and JSON-dumps objects; override when your API has a structured error envelope worth flattening.

## Worked Example: HAL Convention

HAL wraps lists in `_embedded.{collection}` and pagination in `_links`. Associations are URLs, not IDs.

```ts file=src/conventions/hal-convention.ts
// your-server/conventions/hal-convention.ts
import {
  BaseConvention,
  type BelongsToAssociation,
  type HasManyAssociation,
  type FieldDefinition,
  type NormalizedListResponse
} from '@mcp-rune/mcp-rune/prompts'

export class HalConvention extends BaseConvention {
  get name() {
    return 'hal'
  }

  resolveAssociationFields(
    relName: string,
    relConfig: BelongsToAssociation | HasManyAssociation,
    overrides: Record<string, Partial<FieldDefinition>> = {}
  ): Record<string, FieldDefinition> {
    if ('many' in relConfig && relConfig.many) {
      const name = `${relName}_ids`
      return {
        [name]: {
          name,
          type: 'array',
          required: relConfig.required ?? false,
          description: relConfig.description ?? `IDs of related ${relName}`,
          items: { type: 'integer' },
          ...overrides[name]
        }
      }
    }
    const linkName = `${relName}_link`
    const idName = `${relName}_id`
    return {
      [linkName]: {
        name: linkName,
        type: 'string',
        format: 'url',
        required: relConfig.required ?? false,
        description: `HAL link to the related ${relConfig.target_model}`,
        ...overrides[linkName]
      },
      [idName]: {
        name: idName,
        type: 'integer',
        required: false,
        description: `Convenience: parsed ID of ${linkName}`,
        ...overrides[idName]
      }
    }
  }

  resolveAssociationValues(
    attrs: Record<string, unknown>,
    belongsTo: Record<string, BelongsToAssociation> = {},
    apiBaseUrl?: string
  ): Record<string, unknown> {
    const out = { ...attrs }
    for (const [relName, relConfig] of Object.entries(belongsTo)) {
      const idKey = `${relName}_id`
      const linkKey = `${relName}_link`
      if (out[idKey] !== undefined && out[linkKey] === undefined) {
        const collection = relConfig.endpoint ?? `${relConfig.target_model}s`
        out[linkKey] = `${apiBaseUrl}/${collection}/${out[idKey]}`
      }
      delete out[idKey]
    }
    return out
  }

  buildRequestPayload(_model: string, attrs: Record<string, unknown>): Record<string, unknown> {
    return attrs // HAL servers expect flat payloads
  }

  normalizeListResponse(
    response: Record<string, unknown> | unknown[],
    { page, perPage }: { page: number; perPage: number }
  ): NormalizedListResponse {
    if (Array.isArray(response)) {
      return {
        records: response as Record<string, unknown>[],
        pagination: { page, perPage, total: response.length, totalPages: 1, hasMore: false }
      }
    }
    const embedded = (response._embedded ?? {}) as Record<string, unknown>
    const collectionKey = Object.keys(embedded)[0]
    const records = (collectionKey ? embedded[collectionKey] : []) as Record<string, unknown>[]
    const total = (response.total as number | undefined) ?? records.length
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    return {
      records,
      pagination: { page, perPage, total, totalPages, hasMore: page < totalPages }
    }
  }

  cleanResponse(data: unknown): unknown {
    if (Array.isArray(data)) return data.map((d) => this.cleanResponse(d))
    if (data && typeof data === 'object') {
      const { _links, _embedded, ...rest } = data as Record<string, unknown>
      return rest
    }
    return data
  }

  parseErrorResponse(response: { status?: number; data?: unknown }): string[] {
    const data = response.data as Record<string, unknown> | undefined
    if (!data) return [`HTTP ${response.status ?? '???'}`]
    if (typeof data.message === 'string') return [data.message]
    if (Array.isArray(data.errors)) return data.errors.map((e) => String(e))
    return [JSON.stringify(data)]
  }
}

export const halConvention = new HalConvention()
```

```js file=src/conventions/hal-convention.js
// your-server/conventions/hal-convention.ts
import { BaseConvention } from '@mcp-rune/mcp-rune/prompts'
export class HalConvention extends BaseConvention {
  get name() {
    return 'hal'
  }
  resolveAssociationFields(relName, relConfig, overrides = {}) {
    if ('many' in relConfig && relConfig.many) {
      const name = `${relName}_ids`
      return {
        [name]: {
          name,
          type: 'array',
          required: relConfig.required ?? false,
          description: relConfig.description ?? `IDs of related ${relName}`,
          items: { type: 'integer' },
          ...overrides[name]
        }
      }
    }
    const linkName = `${relName}_link`
    const idName = `${relName}_id`
    return {
      [linkName]: {
        name: linkName,
        type: 'string',
        format: 'url',
        required: relConfig.required ?? false,
        description: `HAL link to the related ${relConfig.target_model}`,
        ...overrides[linkName]
      },
      [idName]: {
        name: idName,
        type: 'integer',
        required: false,
        description: `Convenience: parsed ID of ${linkName}`,
        ...overrides[idName]
      }
    }
  }
  resolveAssociationValues(attrs, belongsTo = {}, apiBaseUrl) {
    const out = { ...attrs }
    for (const [relName, relConfig] of Object.entries(belongsTo)) {
      const idKey = `${relName}_id`
      const linkKey = `${relName}_link`
      if (out[idKey] !== undefined && out[linkKey] === undefined) {
        const collection = relConfig.endpoint ?? `${relConfig.target_model}s`
        out[linkKey] = `${apiBaseUrl}/${collection}/${out[idKey]}`
      }
      delete out[idKey]
    }
    return out
  }
  buildRequestPayload(_model, attrs) {
    return attrs // HAL servers expect flat payloads
  }
  normalizeListResponse(response, { page, perPage }) {
    if (Array.isArray(response)) {
      return {
        records: response,
        pagination: { page, perPage, total: response.length, totalPages: 1, hasMore: false }
      }
    }
    const embedded = response._embedded ?? {}
    const collectionKey = Object.keys(embedded)[0]
    const records = collectionKey ? embedded[collectionKey] : []
    const total = response.total ?? records.length
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    return {
      records,
      pagination: { page, perPage, total, totalPages, hasMore: page < totalPages }
    }
  }
  cleanResponse(data) {
    if (Array.isArray(data)) return data.map((d) => this.cleanResponse(d))
    if (data && typeof data === 'object') {
      const { _links, _embedded, ...rest } = data
      return rest
    }
    return data
  }
  parseErrorResponse(response) {
    const data = response.data
    if (!data) return [`HTTP ${response.status ?? '???'}`]
    if (typeof data.message === 'string') return [data.message]
    if (Array.isArray(data.errors)) return data.errors.map((e) => String(e))
    return [JSON.stringify(data)]
  }
}
export const halConvention = new HalConvention()
```

## Worked Example: Flat REST Convention

For a hand-rolled REST API with `{ items: [...], page, total }` lists and unwrapped POST bodies:

```ts file=src/conventions/flat-rest-convention.ts
import { BaseConvention } from '@mcp-rune/mcp-rune/prompts'
import { jsonApiConvention } from '@mcp-rune/mcp-rune/prompts'

export class FlatRestConvention extends BaseConvention {
  get name() {
    return 'flat-rest'
  }

  // Associations behave like JSON:API: send IDs directly.
  resolveAssociationFields = jsonApiConvention.resolveAssociationFields.bind(jsonApiConvention)
  resolveAssociationValues = (attrs: Record<string, unknown>) => attrs

  buildRequestPayload(_model: string, attrs: Record<string, unknown>) {
    return attrs
  }

  normalizeListResponse(response: any, { page, perPage }: { page: number; perPage: number }) {
    const records = (response.items ?? []) as Record<string, unknown>[]
    const total = (response.total as number) ?? records.length
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    return {
      records,
      pagination: { page, perPage, total, totalPages, hasMore: page < totalPages }
    }
  }

  cleanResponse(data: unknown) {
    return data
  }
}

export const flatRestConvention = new FlatRestConvention()
```

```js file=src/conventions/flat-rest-convention.js
import { BaseConvention } from '@mcp-rune/mcp-rune/prompts'
import { jsonApiConvention } from '@mcp-rune/mcp-rune/prompts'

export class FlatRestConvention extends BaseConvention {
  get name() {
    return 'flat-rest'
  }

  // Associations behave like JSON:API: send IDs directly.
  resolveAssociationFields = jsonApiConvention.resolveAssociationFields.bind(jsonApiConvention)
  resolveAssociationValues = (attrs) => attrs

  buildRequestPayload(_model, attrs) {
    return attrs
  }

  normalizeListResponse(response, { page, perPage }) {
    const records = response.items ?? []
    const total = response.total ?? records.length
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    return {
      records,
      pagination: { page, perPage, total, totalPages, hasMore: page < totalPages }
    }
  }

  cleanResponse(data) {
    return data
  }
}

export const flatRestConvention = new FlatRestConvention()
```

You only override what differs. Reusing `jsonApiConvention.resolveAssociationFields` is fine — conventions are plain classes with no framework registration.

## Wiring Per Model

Attach the convention to a model so the framework picks it up everywhere — schema derivation, request building, list normalization:

```ts file=src/book.ts
import { BaseModel } from '@mcp-rune/mcp-rune'
import { halConvention } from './conventions/hal-convention'

class Book extends BaseModel {
  static singularName = 'book'

  static api = {
    endpoint: 'books',
    convention: halConvention
  }

  static attributes = {
    title: { type: 'string', required: true },
    isbn: { type: 'string', format: 'isbn' }
  }

  static associations = {
    belongsTo: {
      author: { target_model: 'author', endpoint: 'authors' }
    }
  }
}
```

```js file=src/book.js
import { BaseModel } from '@mcp-rune/mcp-rune'
import { halConvention } from './conventions/hal-convention'
class Book extends BaseModel {
  static singularName = 'book'
  static api = {
    endpoint: 'books',
    convention: halConvention
  }
  static attributes = {
    title: { type: 'string', required: true },
    isbn: { type: 'string', format: 'isbn' }
  }
  static associations = {
    belongsTo: {
      author: { target_model: 'author', endpoint: 'authors' }
    }
  }
}
```

Different models in the same server can use different conventions. The framework looks up `Model.api.convention` per call.

## Wiring Globally

If every model in your server uses the same custom convention, write a small base class and have your models extend it:

```ts file=src/models/base-hal-model.ts
class BaseHalModel extends BaseModel {
  static api = {
    endpoint: '',
    convention: halConvention
  }
}

class Book extends BaseHalModel {
  static api = { ...BaseHalModel.api, endpoint: 'books' }
  // …
}
```

```js file=src/models/base-hal-model.js
class BaseHalModel extends BaseModel {
  static api = {
    endpoint: '',
    convention: halConvention
  }
}
class Book extends BaseHalModel {
  static api = { ...BaseHalModel.api, endpoint: 'books' }
}
```

There's no `AppRegistry.defaultConvention` setting today — convention is a model-level property by design, because it tracks the API endpoint, not the deployment.

## Testing a Convention

Conventions are pure classes with no framework dependencies. Unit-test the methods directly:

```ts file=src/convention.ts
import { describe, expect, it } from 'vitest'
import { HalConvention } from '../src/conventions/hal-convention'

const convention = new HalConvention()

describe('HalConvention', () => {
  it('normalizes a HAL list with _embedded', () => {
    const response = {
      _embedded: {
        books: [
          { id: 1, title: 'A' },
          { id: 2, title: 'B' }
        ]
      },
      total: 42,
      _links: { next: { href: '…' } }
    }
    const out = convention.normalizeListResponse(response, { page: 1, perPage: 10 })
    expect(out.records).toHaveLength(2)
    expect(out.pagination.total).toBe(42)
    expect(out.pagination.hasMore).toBe(true)
  })

  it('rewrites belongsTo _id into _link on submit', () => {
    const out = convention.resolveAssociationValues(
      { title: 'A', author_id: 7 },
      { author: { target_model: 'author', endpoint: 'authors' } },
      'https://api.example.com'
    )
    expect(out).toEqual({ title: 'A', author_link: 'https://api.example.com/authors/7' })
  })

  it('strips _links and _embedded from clean response', () => {
    const out = convention.cleanResponse({ id: 1, title: 'A', _links: {}, _embedded: {} })
    expect(out).toEqual({ id: 1, title: 'A' })
  })
})
```

```js file=src/convention.js
import { describe, expect, it } from 'vitest'
import { HalConvention } from '../src/conventions/hal-convention'
const convention = new HalConvention()
describe('HalConvention', () => {
  it('normalizes a HAL list with _embedded', () => {
    const response = {
      _embedded: {
        books: [
          { id: 1, title: 'A' },
          { id: 2, title: 'B' }
        ]
      },
      total: 42,
      _links: { next: { href: '…' } }
    }
    const out = convention.normalizeListResponse(response, { page: 1, perPage: 10 })
    expect(out.records).toHaveLength(2)
    expect(out.pagination.total).toBe(42)
    expect(out.pagination.hasMore).toBe(true)
  })
  it('rewrites belongsTo _id into _link on submit', () => {
    const out = convention.resolveAssociationValues(
      { title: 'A', author_id: 7 },
      { author: { target_model: 'author', endpoint: 'authors' } },
      'https://api.example.com'
    )
    expect(out).toEqual({ title: 'A', author_link: 'https://api.example.com/authors/7' })
  })
  it('strips _links and _embedded from clean response', () => {
    const out = convention.cleanResponse({ id: 1, title: 'A', _links: {}, _embedded: {} })
    expect(out).toEqual({ id: 1, title: 'A' })
  })
})
```

Integration-test the end-to-end pipeline through `ModelService`:

```ts file=src/clients/api-client.ts
const apiClient = createInMemoryClient(/* … */)
const service = new ModelService(apiClient, models, { convention: halConvention })
const result = await service.list('book', {})
// Assert records came back normalized, no _links etc.
```

```js file=src/clients/api-client.js
const apiClient = createInMemoryClient(/* … */)
const service = new ModelService(apiClient, models, { convention: halConvention })
const result = await service.list('book', {})
// Assert records came back normalized, no _links etc.
```

## Where Conventions Sit

```
Tools / Prompts / Apps
        ↓
   DataLayer (interface)
        ↓
   ModelService (default adapter)
        ↓
   ApiClient (HTTP)
        ↑ ↓
  BaseConvention (your code)
```

Conventions are **inside `ModelService`**, not inside `ApiClient`. The client knows nothing about HAL or JSON:API; it just does HTTP. The convention sits between the client's raw response and the projection layer's normalized record stream.

This split is deliberate. You can swap the [`ApiClient`](./api-client.md) (e.g., to a fetch-based one) without touching your convention. You can write a new convention without touching your client. Compose freely.

---

**Related guides:**

- [API Configuration Guide](../01-getting-started/api-config.md) — how `Model.api` is shaped, including the `convention` field.
- [DataLayer Guide](./data-layer.md) — the layer above conventions.
- [Custom API Client](./api-client.md) — the layer below.
- [Model service](./model-service.md) — how `ModelService` composes convention + endpoint resolver + client.
