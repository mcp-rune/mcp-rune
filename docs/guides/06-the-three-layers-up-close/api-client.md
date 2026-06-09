> **Customization:** pass your own `ApiClient` via `createApiClient:` on `ToolRegistry` / `AppRegistry`.
> The default is the bundled axios-based client. Sits below `DataLayer`; projection-layer code never sees it directly.

# API client

`ApiClient` is the universal CRUD HTTP contract `ModelService` (the [previous chapter](./model-service.md)) depends on. It sits one layer below the [`DataLayer`](./data-layer.md) seam — projection-layer code never imports it directly; only `ModelService` does. `DataLayer` is "data operations against models"; `ApiClient` is "HTTP verbs against URLs." Most deployers never need to write their own — they pass the bundled axios-based client. You write a custom one when:

- Your backend uses a transport that isn't HTTP (gRPC bridge, message queue).
- You need request-level instrumentation that wrappers can't reach (per-tenant header injection, request signing, mTLS).
- You want a fast in-process stub for integration tests without spinning a real server.
- You need streaming/chunked responses that the default client doesn't expose.

This guide covers writing one, plugging it in, and testing it.

The lifecycle is per-request — never reuse a client across users:

<!-- illustration: api-client#lifecycle -->

```
   ┌─────────────────┐                ┌─────────────────┐
   │  Incoming MCP   │                │  OAuthService   │
   │  tool request   │                │  (per session)  │
   └────────┬────────┘                └────────┬────────┘
            │                                  │
            │   sessionId                      │
            └─────────────────┬────────────────┘
                              │
                              ▼
              ┌──────────────────────────────┐
              │  getValidAccessToken(sessId) │
              │   → token                    │
              │   (auto-refresh, 5min        │
              │    buffer)                   │
              └──────────────┬───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │  createApiClient(token,      │
              │                  { apiUrl }) │
              │   → ApiClient instance       │
              └──────────────┬───────────────┘
                             │  (lifetime = ONE request)
                             ▼
              ┌──────────────────────────────┐
              │  Tool / App handler          │
              │  apiClient.get / post / ...  │
              └──────────────────────────────┘
```

The factory shape — `createApiClient(token, { apiUrl })` — is the only contract the framework cares about. The implementation can be axios, fetch, gRPC bridge, or an in-memory stub for tests. The framework calls this factory **once per request**, so the token stays bound to a single user's call and never bleeds between concurrent sessions.

## Table of Contents

- [The Interface](#the-interface)
- [The `createApiClient` Factory](#the-createapiclient-factory)
- [Where It Plugs In](#where-it-plugs-in)
- [Worked Example: Fetch-Based Client](#worked-example-fetch-based-client)
- [Composing with `OAuthService`](#composing-with-oauthservice)
- [In-Memory Stub for Tests](#in-memory-stub-for-tests)
- [`SearchApiClient`: The Read-Only Subset](#searchapiclient-the-read-only-subset)
- [Don't Reach Past the Interface](#dont-reach-past-the-interface)

## The Interface

```ts file=src/request-options.ts
import type { ApiClient, RequestOptions } from '@mcp-rune/mcp-rune/core'

interface RequestOptions {
  userId?: string
  [key: string]: unknown
}

interface ApiClient {
  baseUrl?: string
  get(
    url: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>
  post(
    url: string,
    data?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>
  put(
    url: string,
    data?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>
  patch(
    url: string,
    data?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>
  delete(url: string, options?: RequestOptions): Promise<Record<string, unknown>>
}
```

```js file=src/request-options.js
/**
 * Optional per-request context. Tools receive a fresh client per request;
 * `userId` is populated by mcp-rune when impersonating during an OAuth
 * flow. Additional keys are passed through to your transport.
 *
 * @typedef {Object} RequestOptions
 * @property {string} [userId]
 */

/**
 * Universal CRUD HTTP contract. Every authenticated tool, every MCP App,
 * and ModelService itself depend on a JS object exposing these methods.
 * Implementations should throw on non-2xx responses.
 *
 * @typedef {Object} ApiClient
 * @property {string} [baseUrl]
 * @property {(url: string, params?: Object, options?: RequestOptions) => Promise<Object>} get
 * @property {(url: string, data?: Object, options?: RequestOptions) => Promise<Object>} post
 * @property {(url: string, data?: Object, options?: RequestOptions) => Promise<Object>} put
 * @property {(url: string, data?: Object, options?: RequestOptions) => Promise<Object>} patch
 * @property {(url: string, options?: RequestOptions) => Promise<Object>} delete
 */
```

Five methods, all returning `Promise<Record<string, unknown>>`. The framework treats payloads as opaque — response normalization is the [convention's](./api-convention.md) job, not the client's. Your `ApiClient` is allowed to throw on non-2xx responses (the framework expects this), but everything else passes through.

`RequestOptions` is intentionally open. mcp-rune populates `userId` when impersonating a user (OAuth flow); custom apps can pass any other keys and your client can pluck what it needs.

## The `createApiClient` Factory

The framework never holds onto a single `ApiClient` instance. Tools that require authentication receive a fresh one **per request**, produced by a factory you provide:

```ts file=src/api-client-factory.ts
import type { ApiClientFactory } from '@mcp-rune/mcp-rune/tools'

type ApiClientFactory = (token: string) => ApiClient
```

```js file=src/api-client-factory.js
/**
 * A factory the framework calls per request to produce a fresh ApiClient.
 * The token argument is the OAuth access token (or whatever your
 * `getAccessToken` callback returns).
 *
 * @typedef {(token: string) => ApiClient} ApiClientFactory
 */
```

The token is the OAuth access token (when OAuth is enabled) or whatever scheme your `getAccessToken` callback returns. Your factory is responsible for injecting auth headers, the base URL, and any per-request transport setup.

## Where It Plugs In

`ToolRegistry` and `AppRegistry` both accept the factory:

```ts file=src/registries/tool-registry.ts
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'

const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => myCustomClient(token, { apiUrl })
})
```

```js file=src/registries/tool-registry.js
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => myCustomClient(token, { apiUrl })
})
```

```ts file=src/registries/app-registry.ts
import { AppRegistry } from '@mcp-rune/mcp-rune/apps'

const appRegistry = new AppRegistry(apps, {
  apiUrl,
  createApiClient: (token) => myCustomClient(token, { apiUrl })
})
```

```js file=src/registries/app-registry.js
import { AppRegistry } from '@mcp-rune/mcp-rune/apps'
const appRegistry = new AppRegistry(apps, {
  apiUrl,
  createApiClient: (token) => myCustomClient(token, { apiUrl })
})
```

Same factory, both registries. Tools call the factory when they receive a tool invocation; apps call it when they handle their tool invocation.

If you're using [`createDefaultAppRegistry`](../05-apps/mcp-apps.md), pass `createApiClient` as one of its options — it threads through to both internal registries.

## Worked Example: Fetch-Based Client

A minimal `fetch` implementation with bearer-token auth and a tenant header:

```ts file=your-server/api-client.ts
import type { ApiClient, RequestOptions } from '@mcp-rune/mcp-rune/core'

interface FetchClientOpts {
  apiUrl: string
  tenant?: string
}

export function createFetchClient(token: string, opts: FetchClientOpts): ApiClient {
  const baseUrl = opts.apiUrl.replace(/\/$/, '')

  function headers(options?: RequestOptions): HeadersInit {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    }
    if (opts.tenant) h['X-Tenant'] = opts.tenant
    if (options?.userId) h['X-Impersonate-User'] = String(options.userId)
    return h
  }

  function buildQuery(params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) return ''
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      qs.set(k, String(v))
    }
    const s = qs.toString()
    return s ? `?${s}` : ''
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const url = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`
    const res = await fetch(url, {
      method,
      headers: headers(options),
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${method} ${url} failed: ${res.status} ${res.statusText} ${text}`)
    }
    if (res.status === 204) return {} as T
    return res.json() as Promise<T>
  }

  return {
    baseUrl,
    get: (url, params, options) =>
      request('GET', `${url}${buildQuery(params)}`, undefined, options),
    post: (url, data, options) => request('POST', url, data, options),
    put: (url, data, options) => request('PUT', url, data, options),
    patch: (url, data, options) => request('PATCH', url, data, options),
    delete: (url, options) => request('DELETE', url, undefined, options)
  }
}
```

```js file=your-server/api-client.js
export function createFetchClient(token, opts) {
  const baseUrl = opts.apiUrl.replace(/\/$/, '')

  function headers(options) {
    const h = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    }
    if (opts.tenant) h['X-Tenant'] = opts.tenant
    if (options?.userId) h['X-Impersonate-User'] = String(options.userId)
    return h
  }

  function buildQuery(params) {
    if (!params || Object.keys(params).length === 0) return ''
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      qs.set(k, String(v))
    }
    const s = qs.toString()
    return s ? `?${s}` : ''
  }

  async function request(method, path, body, options) {
    const url = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`
    const res = await fetch(url, {
      method,
      headers: headers(options),
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${method} ${url} failed: ${res.status} ${res.statusText} ${text}`)
    }
    if (res.status === 204) return {}
    return res.json()
  }

  return {
    baseUrl,
    get: (url, params, options) =>
      request('GET', `${url}${buildQuery(params)}`, undefined, options),
    post: (url, data, options) => request('POST', url, data, options),
    put: (url, data, options) => request('PUT', url, data, options),
    patch: (url, data, options) => request('PATCH', url, data, options),
    delete: (url, options) => request('DELETE', url, undefined, options)
  }
}
```

Wire it up:

```ts file=src/registries/tool-registry.ts
// your-server/config.ts
import { createFetchClient } from './api-client.js'

export const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) =>
    createFetchClient(token, {
      apiUrl: process.env.API_URL!,
      tenant: process.env.TENANT_ID
    })
})
```

```js file=src/registries/tool-registry.js
// your-server/config.ts
import { createFetchClient } from './api-client.js'
export const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) =>
    createFetchClient(token, {
      apiUrl: process.env.API_URL,
      tenant: process.env.TENANT_ID
    })
})
```

The factory closes over `apiUrl` and `tenant` at startup; the token rotates per request.

## Composing with `OAuthService`

When OAuth is enabled, the token comes from the [`OAuthService`](../07-auth-and-transport/oauth2-discovery.md) — you don't fetch it yourself in the factory. `ToolRegistry.registerTools` accepts a `getAccessToken` callback that closes over the request context:

```ts file=src/oauth.ts
import { HttpServer } from '@mcp-rune/mcp-rune/server'
import { OAuthService } from '@mcp-rune/mcp-rune/oauth2'

const oauth = new OAuthService({
  authServerUrl: process.env.AUTH_SERVER_URL!,
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  redirectUri: 'https://example.com/oauth/callback',
  scopes: ['mcp:read', 'mcp:write'],
  resourceUri: 'https://api.example.com',
  isProduction: true
})

const httpServer = new HttpServer({
  oauth,
  createServer: ({ sessionId, transport }) => {
    const mcpServer = createMcpServer(/* … */)
    toolRegistry.registerTools(mcpServer, {
      getAccessToken: async () => oauth.getAccessToken(sessionId)
    })
    return mcpServer
  }
})
```

```js file=src/oauth.js
import { HttpServer } from '@mcp-rune/mcp-rune/server'
import { OAuthService } from '@mcp-rune/mcp-rune/oauth2'
const oauth = new OAuthService({
  authServerUrl: process.env.AUTH_SERVER_URL,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri: 'https://example.com/oauth/callback',
  scopes: ['mcp:read', 'mcp:write'],
  resourceUri: 'https://api.example.com',
  isProduction: true
})
const httpServer = new HttpServer({
  oauth,
  createServer: ({ sessionId, transport }) => {
    const mcpServer = createMcpServer(/* … */)
    toolRegistry.registerTools(mcpServer, {
      getAccessToken: async () => oauth.getAccessToken(sessionId)
    })
    return mcpServer
  }
})
```

`registerTools` calls `getAccessToken` once per tool invocation, then invokes `createApiClient(token)`. Your factory stays simple — it doesn't know OAuth exists.

For requests that need impersonation, pass `userId` through the tool invocation context, and the framework threads it into `RequestOptions`:

```ts file=examples/api-client-guide-07.ts
// Inside a custom tool's execute():
await this.dataLayer.find('book', recordId, { userId: this.context.userId })
```

```js file=examples/api-client-guide-07.js
// Inside a custom tool's execute():
await this.dataLayer.find('book', recordId, { userId: this.context.userId })
```

Your client picks `userId` out of `options` and sets the impersonation header. The token still belongs to the application — `userId` just tells the API which user to act as.

## In-Memory Stub for Tests

For integration tests, you usually want to bypass HTTP entirely. Provide a stub client backed by a `Map`:

```ts file=src/clients/create-in-memory-client.ts
// __tests__/helpers/in-memory-client.ts
import type { ApiClient } from '@mcp-rune/mcp-rune/core'

export function createInMemoryClient(seed: Record<string, unknown[]> = {}): ApiClient {
  const store = new Map<string, Map<string, Record<string, unknown>>>()

  for (const [collection, records] of Object.entries(seed)) {
    const bucket = new Map()
    for (const r of records) bucket.set(String(r.id), r as Record<string, unknown>)
    store.set(collection, bucket)
  }

  function bucket(url: string): Map<string, Record<string, unknown>> {
    const segments = url.replace(/^\/+|\/+$/g, '').split('/')
    const collection = segments[0]!
    if (!store.has(collection)) store.set(collection, new Map())
    return store.get(collection)!
  }

  return {
    async get(url) {
      const segments = url.replace(/^\/+|\/+$/g, '').split('/')
      if (segments.length === 1) {
        return { data: Array.from(bucket(url).values()) }
      }
      const record = bucket(url).get(segments[1]!)
      if (!record) throw new Error(`Not found: ${url}`)
      return { data: record }
    },
    async post(url, data) {
      const id = String(bucket(url).size + 1)
      const record = { ...data, id }
      bucket(url).set(id, record)
      return { data: record }
    },
    async put(url, data) {
      const segments = url.replace(/^\/+|\/+$/g, '').split('/')
      const id = segments[1]!
      bucket(url).set(id, { ...(data ?? {}), id })
      return { data: bucket(url).get(id)! }
    },
    patch(url, data) {
      return this.put(url, data)
    },
    async delete(url) {
      const segments = url.replace(/^\/+|\/+$/g, '').split('/')
      bucket(url).delete(segments[1]!)
      return {}
    }
  }
}
```

```js file=src/clients/create-in-memory-client.js
export function createInMemoryClient(seed = {}) {
  const store = new Map()
  for (const [collection, records] of Object.entries(seed)) {
    const bucket = new Map()
    for (const r of records) bucket.set(String(r.id), r)
    store.set(collection, bucket)
  }
  function bucket(url) {
    const segments = url.replace(/^\/+|\/+$/g, '').split('/')
    const collection = segments[0]
    if (!store.has(collection)) store.set(collection, new Map())
    return store.get(collection)
  }
  return {
    async get(url) {
      const segments = url.replace(/^\/+|\/+$/g, '').split('/')
      if (segments.length === 1) {
        return { data: Array.from(bucket(url).values()) }
      }
      const record = bucket(url).get(segments[1])
      if (!record) throw new Error(`Not found: ${url}`)
      return { data: record }
    },
    async post(url, data) {
      const id = String(bucket(url).size + 1)
      const record = { ...data, id }
      bucket(url).set(id, record)
      return { data: record }
    },
    async put(url, data) {
      const segments = url.replace(/^\/+|\/+$/g, '').split('/')
      const id = segments[1]
      bucket(url).set(id, { ...(data ?? {}), id })
      return { data: bucket(url).get(id) }
    },
    patch(url, data) {
      return this.put(url, data)
    },
    async delete(url) {
      const segments = url.replace(/^\/+|\/+$/g, '').split('/')
      bucket(url).delete(segments[1])
      return {}
    }
  }
}
```

Use it in tests:

```ts file=src/clients/api-client.ts
const apiClient = createInMemoryClient({
  books: [{ id: '1', title: 'Clean Code' }]
})

const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: () => apiClient
})
```

```js file=src/clients/api-client.js
const apiClient = createInMemoryClient({
  books: [{ id: '1', title: 'Clean Code' }]
})
const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: () => apiClient
})
```

For stub testing at the higher `DataLayer` boundary (so you don't have to mock the wire format), see the [In-Memory DataLayer](./data-layer.md#in-memory-stub-for-tests) section instead — it bypasses both `ApiClient` and the convention.

## `SearchApiClient`: The Read-Only Subset

The `SearchService` and other read-only consumers depend on a narrower interface:

```ts file=src/clients/search-api-client.ts
import type { SearchApiClient } from '@mcp-rune/mcp-rune/core'

type SearchApiClient = Pick<ApiClient, 'get' | 'post'>
```

```js file=src/clients/search-api-client.js
/**
 * Read-only subset of ApiClient: only `get` and `post` are required.
 * SearchService accepts this narrower contract so a search-only adapter
 * doesn't have to implement `put` / `patch` / `delete`.
 *
 * @typedef {Pick<ApiClient, 'get' | 'post'>} SearchApiClient
 */
```

If you're writing a client that only ever serves search (e.g. an Elasticsearch bridge that exposes nothing else), implement `SearchApiClient` and use a separate full `ApiClient` for CRUD. The narrow type makes the seam auditable.

## Don't Reach Past the Interface

Tools and apps receive an `ApiClient`. They should not import a concrete client class, sniff for axios, or call `baseUrl` to construct URLs themselves — the [`EndpointResolver`](../04-tools/the-three-layers.md) owns URL composition. The whole point of the `ApiClient` seam is that every consumer is interchangeable.

If you find yourself needing behavior the interface doesn't expose, the answer is almost always one of:

1. Add the concern to your client's implementation of an existing method (auth header injection, request logging — these stay invisible to callers).
2. Move the concern into the convention (response normalization, association resolution).
3. Add it to an [ApiExtension](../10-extensions/api-extensions.md) (new tools, `ModelService` mixins).

Extending the `ApiClient` interface itself — adding a sixth method — is a framework-level decision, not a deployer-level one.

---

**Related guides:**

- [DataLayer Guide](./data-layer.md) — the layer above `ApiClient` that adds model awareness.
- [Custom API Convention](./api-convention.md) — response normalization and payload wrapping live here, not in the client.
- [Model service](./model-service.md) — how `ModelService` composes `ApiClient` + `EndpointResolver` + convention.
- [OAuth 2.0 Discovery Flow](../07-auth-and-transport/oauth2-discovery.md) — where the token in `createApiClient(token)` comes from.
