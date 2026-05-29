---
extension:
  kind: plugin
  what: Author API extensions — tools + ModelService methods
---

# API Extensions

mcp-rune supports **opt-in API extensions** that contribute MCP tools and `ModelService` methods on top of the framework's built-in CRUD pipeline. Use API extensions to ship capabilities that aren't part of pure REST/CRUD — custom non-CRUD verbs, search subsystems, GraphQL field selection, bulk operations, RPC-style endpoints — without pulling them into the framework's core surface.

This guide is the **conceptual reference**: what an `ApiExtension` is, what the framework guarantees, what the registration and reading contracts look like, and why the design choices are what they are. For a **step-by-step walkthrough of authoring your own extension**, see [Authoring Extensions Guide](./authoring-extensions-guide.md).

It is the model-layer parallel of [`HttpExtension`](./extensions.md) and follows the same authoring contract.

## Architecture overview

Six pieces work together. Author-facing pieces are on the left; framework-facing pieces are on the right.

```
       ┌──────────────────────────────────────────────────────────────┐
       │                          your extension                      │
       │                                                              │
       │  xxxConfig({...})  ─────►   getXxxConfig(model)              │
       │   (typed helper)             (typed reader, structural)      │
       │        │                                │                    │
       │        │                                ▼                    │
       │        │                     ┌──────────────────────┐        │
       │        │                     │  capability getters  │        │
       │        │                     │  (filter consumers)  │        │
       │        │                     └──────────────────────┘        │
       │        │                                                     │
       │        │                     xxxExtension(): ApiExtension    │
       │        │                                │                    │
       │        │                                ▼                    │
       │        │                     register(ctx) ─► tools + mixin  │
       │        │                                                     │
       │        │                     createXxxService(apiClient, …)  │
       │        │                       (optional factory)            │
       │        ▼                                                     │
       │        │                                                     │
       └────────┼─────────────────────────────────────────────────────┘
                │                                ▲
                ▼                                │ registers
       ┌──────────────────────┐         ┌────────┴──────────────┐
       │ BaseModel.extensions │         │ ToolRegistry({        │
       │ {                    │         │   apiExtensions: {    │
       │   'xxx': …config…    │ ◄──────┤    'xxx': xxxExt()    │
       │ }                    │  reads  │   }                   │
       └──────────────────────┘         │ })                    │
                                        └───────────────────────┘
```

| Piece                                                      | Owned by  | Read by                                   | Purpose                                                                                                                                                           |
| ---------------------------------------------------------- | --------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`xxxConfig({...})`** typed helper                        | extension | model authors                             | Gives `extensions['xxx']` slot type-safe values                                                                                                                   |
| **`getXxxConfig(model)`** typed reader                     | extension | tools/apps/anyone                         | Single read site; structural (works on `ModelConfig`, `AppModelClass`, `SearchModelClass`)                                                                        |
| **Capability getters** (`getXxxableModelNames`, etc.)      | extension | tools that need "which models support X?" | Filter `models` registry by extension config                                                                                                                      |
| **`xxxExtension()`** factory                               | extension | server author                             | Returns `ApiExtension`; registered on `ToolRegistry`                                                                                                              |
| **`createXxxService(apiClient, ctx?)`** factory (optional) | extension | extension itself + other consumers        | Central construction site for long-lived service instances (only needed when the extension exposes a service that's used outside its tools, e.g. `SearchService`) |
| **`BaseModel.extensions['xxx']`** slot                     | framework | typed reader                              | Per-model config bag, namespaced by extension key                                                                                                                 |
| **`ToolRegistry({ apiExtensions: {...} })`**               | framework | server author                             | Single opt-in site; runs `register(ctx)` once at boot with capability validation and dedupe                                                                       |

The two built-in extensions show what this looks like in practice:

- **[`custom-actions`](../../src/api-extensions/custom-actions.ts)** — single-file extension; contributes one MCP tool (`model_action`) and one mixin (`action()` on `ModelService`).
- **[`search`](../../src/api-extensions/search/)** — directory-shaped extension; contributes two MCP tools (`search_records`, `get_filters_guide`), a `createSearchService` factory, and a `SearchService` used by apps and `analysis-ingest-tool` as a module import (independent of registration).

## The `ModelService` mixin contract (stable surface mixins compose)

When your extension contributes a mixin via `ctx.registerModelServiceMixin(...)`, the mixin function receives a `ModelService` instance and returns a map of methods to `Object.assign` onto it. The mixin should compose these **public** members instead of reaching into private internals:

| Member                                                       | Purpose                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `service.apiClient`                                          | The underlying CRUD client (`get`, `post`, `put`, `patch`, `delete`, `baseUrl`)                                           |
| `service.endpointResolver`                                   | `pathForType(model, config)`, `applyNamespace(config, path)`, plus the CRUD `resolveCollection` / `resolveRecord` helpers |
| `service.models`                                             | Read-only view of the models registry                                                                                     |
| `service.buildPayload(model, modelConfig, attrs)`            | Convention-aware payload wrapping (handles association resolution)                                                        |
| `service.dispatch(method, url, payload?, params?, options?)` | HTTP dispatch through the configured `ApiClient`                                                                          |

Anything prefixed with `_` (e.g. `_apiClient`, `_resolver`) is not part of the contract and may change without a release note.

## What an ApiExtension is

An `ApiExtension` is an object with a `register(ctx)` function. `ToolRegistry` calls `register()` once at construction, hands it a narrowed context object, and threads its contributions (tool classes, `ModelService` mixins) into the registry.

API extensions are model/service-layer features: MCP tools, methods that compose `EndpointResolver` and `ApiClient`, configuration that lives on individual models. They are **not** the place for HTTP-layer concerns (routes, route-scoped middleware) — those belong to [`HttpExtension`](./extensions.md).

## What the framework guarantees

mcp-rune never auto-registers an API extension. There is no plugin discovery, no scanning of `node_modules`, no env-var sniffing that wires things up behind your back, no convention-based loading. An extension runs **if and only if** you pass it in the `apiExtensions` option on `ToolRegistry`. Conversely, if you don't pass it, it definitely is not running.

This is deliberate: the answer to "what tools are actually registered in this server?" is always answerable by reading one call site — the `new ToolRegistry({...})` constructor argument.

## The registration contract

Register API extensions through the `apiExtensions` option on `ToolRegistry`. The shape is `{ [name]: ApiExtension }` — a plain object keyed by an identifier you choose.

```ts file=src/registry.ts
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
import { customActionsExtension } from '@mcp-rune/mcp-rune/api-extensions/custom-actions'
import { searchExtension } from '@mcp-rune/mcp-rune/api-extensions/search'

new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  apiExtensions: {
    'custom-actions': customActionsExtension(),
    search: searchExtension()
  }
})
```

```js file=src/registry.js
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
import { customActionsExtension } from '@mcp-rune/mcp-rune/api-extensions/custom-actions'
import { searchExtension } from '@mcp-rune/mcp-rune/api-extensions/search'

new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  apiExtensions: {
    'custom-actions': customActionsExtension(),
    search: searchExtension()
  }
})
```

> The `customActionsExtension` and `searchExtension` referenced above are the two built-in API extensions today. Their per-model config slots both sit in the `extensions` bag (`customActionsConfig({...})` since v0.44.0 and `searchConfig({...})` since v0.48.0), giving `BaseModel` exactly one model-level field for opt-in capabilities and a consistent authoring shape.

The key (`'custom-actions'` above) is the extension's identifier for the lifetime of this registry. It is:

- **Used for log lines** (`ApiExtension "custom-actions" registered`).
- **The dedupe primitive** — object semantics guarantee you cannot register the same key twice.
- **Stable** — built-in extensions document their conventional key. For your own extensions, pick something descriptive (`'graphql-fields'`, `'tenant-scoping'`).

Registration happens in object insertion order, which is the order JavaScript guarantees for string keys.

## The context object

```ts
interface ApiExtensionContext {
  name: string // the key you registered the extension under
  models: ModelsRegistry // read-only view of the registry
  serverContext: ServerContext // server name, description, etc.
  logger: typeof logger
  registerTool(name: string, ToolClass: ToolClass): void
  registerModelServiceMixin(mixin: ModelServiceMixin): void
  registerSummaryStrategy(strategy: SummaryStrategy): void
}
```

What the context deliberately does **not** expose:

- Raw access to `ToolRegistry` internals. Extensions get narrowed collectors (`registerTool`, `registerModelServiceMixin`, `registerSummaryStrategy`); they cannot mutate `_toolClasses` directly or reach into the gate list.
- Other extensions' contributions. There is no "extension registry" you can iterate at runtime.
- The `McpServer` instance. Tool registration happens later, via `registerTools(mcpServer, ...)`.

This narrowing is deliberate. Extensions can break their own tools, but they cannot break the host.

## `requires` capabilities

Declare host capabilities your extension depends on:

```ts
export function myExtension(): ApiExtension {
  return {
    requires: [],
    register(ctx) {
      /* ... */
    }
  }
}
```

No capabilities are defined yet (the type is `never`). The field is reserved so the contract stays aligned with `HttpExtension` and is ready when a real consumer needs one. Boot-time failure on an unknown capability is the default — a missing capability is much harder to diagnose at tool-call time than at construction.

## Contribution channels

### Tools

```ts
register(ctx) {
  ctx.registerTool('graphql_select', GraphqlSelectTool)
}
```

Tool names must be **globally unique** across core tools and all registered extensions. Collisions throw at boot with both extension keys in the error — never silent overwrites.

The contributed `ToolClass` follows the same contract as core tools: it extends `BaseTool`, declares `category` and `requiresAuth`, exposes `inputSchema`, and implements `execute()`. Tools registered through extensions go through the same auth pipeline, interceptor chain, and tracing wrapper as core tools.

### `ModelService` mixins

```ts
register(ctx) {
  ctx.registerModelServiceMixin((service) => ({
    publish: async (model: string, recordId: string) => {
      const config = (service as unknown as { models: ModelsRegistry })
      const url = service.endpointResolver.pathForType(/* ... */)
      return service.dispatch('POST', url)
    }
  }))
}
```

A mixin is a function `(service) => Record<string, Function>`. The host applies each returned method to the lazily-constructed `ModelService` instance via `Object.assign`. Mixin authors should compose the **stable extension contract** on `ModelService`:

- `service.dispatch(method, url, payload?, params?, options?)` — HTTP dispatch through the configured `ApiClient`
- `service.buildPayload(model, modelConfig, attrs)` — convention-aware payload wrapping (handles association resolution)
- `service.endpointResolver` — URL resolution (`pathForType`, namespace application)
- `service.apiClient` — read-only access to the underlying client (for `baseUrl`, etc.)

Reaching into private internals (`_apiClient`, `_models`, anything prefixed with `_`) is not part of the contract and may break in any release.

### Summary strategies

```ts
import type { SummaryStrategy } from '@mcp-rune/mcp-rune/extensions'

const salesNarrativeStrategy: SummaryStrategy = {
  name: 'sales-narrative',
  description: 'Prose summary tuned for deal records: pipeline stage, $ amount, owner.',
  appliesTo: (input) => input.model === 'deal',
  generate: (input) => ({
    finding: `Page ${input.page}: ${input.records.length} deals — ${summarizeDeals(input.records)}`,
    metadata: { page: input.page, model: input.model }
  })
}

register(ctx) {
  ctx.registerSummaryStrategy(salesNarrativeStrategy)
}
```

A `SummaryStrategy` is a deterministic pure function (sync or async, but no LLM or network I/O) that takes a page of stored records and produces a `{ finding, metadata }` to persist as an `analysis_memories` row. Strategies become callable on `analysis_ingest` (via `summary_strategy` / `summary_strategies`) and on `analysis_summarize` (which re-runs them against already-ingested data without re-fetching).

Strategy names must be **globally unique** across built-ins and all extensions — kebab-case, starting with a letter. Collisions throw at boot with both owner keys in the error.

The optional `appliesTo(input)` returns `false` to silently skip the strategy for a given page — useful when a multi-strategy ingest passes e.g. `['distribution', 'temporal', 'entity-extraction']` and not every page has the prerequisites for each.

See [Summary Strategies](./summary-strategies.md) for the full catalog of built-ins, the strategy interface, and an authoring walkthrough.

Mixins run lazily: each `BaseTool` instance constructs its own `ModelService` on first access, and mixins are applied at that moment. There is one `ModelService` per tool instance; mixin state does not leak between tools.

## Model configuration: the `extensions` bag

Per-model config for an extension lives on `BaseModel.extensions`, keyed by the extension's registration name:

```ts
class BookModel extends BaseModel {
  static api = { endpoint: 'books', namespace: 'api/v1' } // pure CRUD
  static extensions = {
    'custom-actions': customActionsConfig({
      actions: { publish: { path: ':id/publish' } }
    }),
    search: searchConfig({
      lookup: { fields: ['title'] }
    })
  }
}
```

Each extension exports a typed helper (`customActionsConfig`, `searchConfig`) that returns the value for its slice. The bag itself is typed as `Record<string, unknown>` — type safety lives at the call site via the helper.

### Why the namespaced bag?

A namespaced bag (`extensions: { 'custom-actions': {...} }`) instead of flat top-level keys on the model is what modern TypeScript/Node frameworks designed for plugin diversity converge on — ESLint (`rules: { 'plugin/rule': ... }`), Webpack/Vite (`plugins: [reactPlugin(opts)]`), Babel, PostCSS, Tailwind, TypeScript's `compilerOptions.plugins`, Storybook, Next.js, Astro. The flat-keys alternative is closer to Rails/Django-era thinking (config keys live on the base class, gems hook in via initializers), which doesn't scale once two plugins want overlapping config names or want to evolve their config shape independently.

Concretely the bag gives us four things:

1. **Namespace safety** — no two extensions ever fight over a key like `actions`.
2. **Type safety at the call site** — the typed helper (`customActionsConfig({...})`) gives full autocomplete and validation even though the bag is typed as `Record<string, unknown>`. Authors are expected to use the helper, not write raw object literals.
3. **Independent versioning** — `custom-actions@2` can change its config shape without ever touching the core `ApiConfig` type.
4. **Discoverability via imports** — `import { customActionsConfig } from '.../custom-actions'` makes ownership obvious. The model file reads as a list of capabilities, each with a clear import line.

The one real cost — no IDE autocomplete inside a raw object literal — is fully recovered by the helper pattern.

### Naming convention

Every extension exports a _pair_ of functions, named by what the extension **does** — not by what it extends:

- **`xxxExtension()`** — returns the `ApiExtension` object. Registered once at server boot in `ToolRegistry.apiExtensions`.
- **`xxxConfig({...})`** — returns a typed config blob. Placed per-model in `Model.extensions['xxx']`.

Examples: `customActionsExtension()` + `customActionsConfig({...})`, `searchExtension()` + `searchConfig({...})`.

Do **not** prefix helpers with `api` (e.g. `apiSearchConfig`, `customApiActionsConfig`). The location already encodes that these are API extensions three times over — the bag is `static extensions`, the import path is `@mcp-rune/mcp-rune/api-extensions/...`, the type implemented is `ApiExtension`. A fourth encoding in the helper name is redundant and breaks the convention modern plugin systems follow (Vite's `react()` not `viteReact()`, Tailwind's `forms` not `tailwindForms`, PostCSS's `autoprefixer` not `postcssAutoprefixer`).

### Reading the config

Each extension exports a typed getter that reads its slice from the bag, returning `undefined` when the extension's key is absent. This lets core code (e.g. `list_models` output) tolerate the extension being unregistered:

```ts
import type { ModelConfig } from '@mcp-rune/mcp-rune/tools'

export interface CustomActionsConfig {
  actions: Record<string, ActionDefinition>
}

export function getActionsConfig(model: ModelConfig): CustomActionsConfig | undefined {
  return model.extensions?.['custom-actions'] as CustomActionsConfig | undefined
}
```

## A worked example

A minimal "echo" extension that contributes one tool and one mixin method:

```ts
import type { ApiExtension } from '@mcp-rune/mcp-rune/api-extensions'
import { BaseTool, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'

class EchoTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.STRATEGY
  }
  get name() {
    return 'echo'
  }
  get baseDescription() {
    return 'Echo a message back.'
  }
  get inputSchema() {
    return { message: z.string() }
  }
  async execute({ message }: { message: string }) {
    return { content: [{ type: 'text', text: message }] }
  }
}

export function echoExtension(): ApiExtension {
  return {
    register(ctx) {
      ctx.registerTool('echo', EchoTool)
      ctx.registerModelServiceMixin((_service) => ({
        echoMixin: (msg: string) => `echo: ${msg}`
      }))
      ctx.logger.info(`echo extension wired up`, { service: ctx.name })
    }
  }
}

// Register:
new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient,
  apiExtensions: {
    echo: echoExtension()
  }
})
```

That's a complete extension — interface, factory, registration. No decorators, no DI container, no plugin manifest.

## Stability

The `ApiExtensionContext` shape is **pre-1.0**: it may change in any minor release. Breaking changes will be called out prominently in `CHANGELOG.md` and migration steps will be in the release notes.

The `ModelService` extension contract (`dispatch`, `buildPayload`, `endpointResolver`, `apiClient`) is also pre-1.0 but is treated as more stable than the context shape: it's what mixin authors compose, and breaking it has a wider blast radius.

Post-1.0, shape changes will be major-version bumps. If you publish an extension as a separate package, pin a `peerDependencies` range that matches the API version you built against:

```json
{
  "peerDependencies": {
    "@mcp-rune/mcp-rune": "^1.0.0"
  }
}
```
