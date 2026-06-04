# Authoring Extensions Guide

This guide walks you through writing an extension from scratch. mcp-rune has two extension types — pick the one whose lifetime matches your feature:

| Type                | Lives in                            | Best for                                                                                                   | Reference                                                                                                                                                                    |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`HttpExtension`** | `@mcp-rune/mcp-rune/extensions`     | HTTP routes and route-scoped middleware on top of `/oauth/*`, `/health`, and `/mcp`                        | [Extensions Guide](./extensions.md), worked example [`cimd`](../../src/extensions/cimd.ts)                                                                                   |
| **`ApiExtension`**  | `@mcp-rune/mcp-rune/api-extensions` | MCP tools + `ModelService` mixins + per-model config that's only relevant when the extension is registered | [API Extensions Guide](./api-extensions.md), worked examples [`custom-actions`](../../src/api-extensions/custom-actions.ts) and [`search`](../../src/api-extensions/search/) |

Both follow the same authoring contract — `requires?` capability declaration, `register(ctx)` entrypoint, narrowed context, explicit opt-in, no auto-registration. The framework's promise is that "what's actually running" is answerable by reading one call site (your `new HttpServer({...})` or `new ToolRegistry({...})`).

This guide focuses on the **`ApiExtension`** because it has more moving parts (config slot, helper, reader, factory, mixin, tool). Once you understand the full pattern, the `HttpExtension` version is a strict subset.

## Mental model: the five pieces an `ApiExtension` ships

Look at how the built-in `custom-actions` and `search` extensions are organized — both follow the same five-piece shape:

<!-- illustration: authoring-extensions#shape -->

```
your-extension/
├── types.ts         (1) Config type the extension consumes
├── capabilities.ts  (2) Typed helper + (3) typed reader
├── factory.ts       (4) Service factory (only if you contribute a service)
├── extension.ts     (5) MCP tools + the searchExtension()-style factory
└── index.ts             Public re-exports — one stable import path
```

| #   | Piece                                  | What it does                                                                                                                       | Example from `custom-actions`                                                             |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | **Config type**                        | The shape your per-model config takes                                                                                              | `interface CustomActionsConfig { actions: Record<string, ActionDefinition> }`             |
| 2   | **Typed helper** (`xxxConfig`)         | What model authors write in `extensions['xxx']` to get autocomplete + validation, even though the bag is `Record<string, unknown>` | `customActionsConfig({ actions: {...} })`                                                 |
| 3   | **Typed reader** (`getXxxConfig`)      | What everyone else uses to read the slice — structural, tolerates absence                                                          | `getActionsConfig(modelConfig)` returns `CustomActionsConfig \| undefined`                |
| 4   | **Service factory** (optional)         | If your extension creates a long-lived service that other code constructs, expose a factory so the construction is centralized     | `createSearchService(apiClient, context?)` — used by extension, apps, and analysis-ingest |
| 5   | **Extension factory** (`xxxExtension`) | Returns the `ApiExtension` object — registers tools, mixins, etc. via the narrowed context                                         | `customActionsExtension()`                                                                |

Plus, on the consumer side, one model-side slot:

```
BaseModel.extensions['xxx']     ← read by piece 3, written via piece 2
```

The pattern is symmetric and intentional: pieces 1–3 are pure types/functions (callable from anywhere); piece 4 is a construction helper; piece 5 is what you register on `ToolRegistry`.

## When to extend `DataLayer` vs compose privately

> **Projection-layer rule.** Apps, tools, prompts, and domain workflows consume only the `DataLayer` interface — never `SearchService`, `ApiClient`, or `ModelService` directly. See [The Projection-Layer Rule](./data-layer-guide.md#the-projection-layer-rule).

If your extension's capability is something the projection layer should consume — something an app or tool would want to call — extend `DataLayer` with a method and ship a decorator adapter that implements it. The `search` ApiExtension is the worked example: it added `searchNormalized`, `lookupNormalized`, and `groupSearchNormalized` to the interface, then shipped `SearchEnabledDataLayer` to implement them. Apps and tools now call `dataLayer.searchNormalized(...)` and never see `SearchService`.

If your capability is service-internal — transport helpers, request shaping, response normalization that other code uses through your own service — compose `ApiClient` privately inside your extension's service and don't surface a method on `DataLayer`. The `custom-actions` extension is this shape: it adds a `ModelService` mixin (`action()`) callable from tools that already hold a `ModelService` instance, but the contract is "tools call `this.modelService.action(...)`," not "tools reach for a generic `DataLayer` method."

Rule of thumb:

- **Extend `DataLayer`** when projection-layer callers (multiple apps, multiple tools, deployers) would all benefit from the same method shape. Add the method to the interface, give base adapters a sensible default (delegate or throw), ship a decorator with the real implementation, and document the wiring pattern (`withSearchEnabledDataLayer`-style factory).
- **Compose privately** when the capability is single-consumer or transport-level. Don't grow the interface for one caller; let that caller import your service directly. Note: this still respects the projection-layer rule — the caller is your own extension code, not an app/tool/prompt elsewhere in the framework.

## Step-by-step: build a `bulk-actions` extension

We'll build an extension that adds a `bulk_update_records` MCP tool — taking an array of record IDs and an attributes patch, dispatching a single PATCH to a `bulk-update` collection endpoint. The same pattern scales to any non-CRUD capability.

### 0. Decide the shape

- Per-model config: `{ endpoint: string }` — where the bulk endpoint lives
- New MCP tool: `bulk_update_records({ model, ids, attributes })`
- Optional `ModelService` mixin: `bulkUpdate(model, ids, attributes)`

### 1. Create the directory

<!-- illustration: authoring-extensions#bulk -->

```
src/api-extensions/bulk-actions/
├── types.ts
├── capabilities.ts
├── extension.ts
└── index.ts
```

(For a smaller extension you can collapse everything into one file like `custom-actions.ts` did. The directory shape only pays off once you have multiple modules.)

### 2. Define the config type — `types.ts`

```ts file=src/config/bulk-actions-config.ts
export interface BulkActionsConfig {
  /** Collection endpoint that accepts a PATCH with `{ ids, attributes }`. */
  endpoint: string
}
```

```js file=src/config/bulk-actions-config.js
/**
 * Per-model configuration for the bulk-actions extension.
 *
 * @typedef {Object} BulkActionsConfig
 * @property {string} endpoint Collection endpoint that accepts a PATCH with `{ ids, attributes }`.
 */
```

### 3. Typed helper + reader — `capabilities.ts`

```ts file=src/api-extensions/bulk-actions/capabilities.ts
import type { BulkActionsConfig } from './types.js'

/**
 * The minimal structural shape — accepting this instead of `ModelConfig`
 * means apps (which use `AppModelClass`) can call the same reader.
 */
export interface ModelWithExtensions {
  extensions?: Record<string, unknown>
}

export function bulkActionsConfig(config: BulkActionsConfig): BulkActionsConfig {
  return config
}

export function getBulkActionsConfig(model: ModelWithExtensions): BulkActionsConfig | undefined {
  return model.extensions?.['bulk-actions'] as BulkActionsConfig | undefined
}

export function getBulkUpdatableModelNames(models: Record<string, ModelWithExtensions>): string[] {
  return Object.entries(models)
    .filter(([, m]) => !!getBulkActionsConfig(m))
    .map(([name]) => name)
}
```

```js file=src/api-extensions/bulk-actions/capabilities.js
/**
 * In JavaScript the `xxxConfig()` helper is still useful as a JSDoc anchor.
 * Drop a `@type` import if your project uses checkJs, otherwise the runtime
 * shape is identical to the TS variant — config in, config out.
 */
export function bulkActionsConfig(config) {
  return config
}

export function getBulkActionsConfig(model) {
  return model.extensions?.['bulk-actions']
}

export function getBulkUpdatableModelNames(models) {
  return Object.entries(models)
    .filter(([, m]) => !!getBulkActionsConfig(m))
    .map(([name]) => name)
}
```

The `xxxConfig()` helper looks pointless because it's `(config) => config`. It isn't — it's a typed hook. When authors write `bulkActionsConfig({ endoint: '...' })` (typo), TypeScript catches the typo. Without the helper, the raw object would slot into an `unknown` and the typo would silently survive.

### 4. The MCP tool + extension factory — `extension.ts`

```ts file=src/tools/bulk-update-records-tool.ts
import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type { ApiExtension, ModelServiceMixin } from '@mcp-rune/mcp-rune/api-extensions'
import type { ToolAnnotations, ToolResult } from '@mcp-rune/mcp-rune/tools'
import { BaseTool } from '@mcp-rune/mcp-rune/tools'

import { getBulkActionsConfig, getBulkUpdatableModelNames } from './capabilities.js'

/**
 * MCP tool — `bulk_update_records`.
 *
 * Reads the model's `extensions['bulk-actions']` slice for the endpoint
 * and delegates to the `bulkUpdate` mixin contributed by this extension.
 */
export class BulkUpdateRecordsTool extends BaseTool {
  override get name(): string {
    return 'bulk_update_records'
  }

  override get annotations(): ToolAnnotations {
    return {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  }

  override get baseDescription(): string {
    return (
      `Patch many records at once via a single bulk-update endpoint. ` +
      `Models must declare a bulk-update endpoint via bulkActionsConfig.`
    )
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(getBulkUpdatableModelNames(this.models)).describe('Model name'),
      ids: z.array(z.string()).describe('Record IDs to update'),
      attributes: z.record(z.string(), z.unknown()).describe('Patch to apply to every record')
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const service = this.requireModelService() as unknown as BulkActionServiceMethods
      const { model, ids, attributes } = args as {
        model: string
        ids: string[]
        attributes: Record<string, unknown>
      }
      this.validateModel(model)
      const data = await service.bulkUpdate(model, ids, attributes)
      return this.formatResponse({ status: 'success', model, updated: ids.length, data })
    } catch (error) {
      return this.formatError(error as Error)
    }
  }
}

/** The mixin contract added to `ModelService` when this extension is registered. */
export interface BulkActionServiceMethods {
  bulkUpdate(
    model: string,
    ids: string[],
    attributes: Record<string, unknown>
  ): Promise<Record<string, unknown>>
}

const bulkActionsMixin: ModelServiceMixin = (service) => {
  return {
    bulkUpdate: (async (model: string, ids: string[], attributes: Record<string, unknown>) => {
      const modelConfig = service.models[model]
      if (!modelConfig) throw new Error(`Unknown model: ${model}`)
      const cfg = getBulkActionsConfig(modelConfig)
      if (!cfg) throw new Error(`Model '${model}' has no bulk-actions config`)

      const payload = service.buildPayload(model, modelConfig, { ids, attributes })
      return service.dispatch('PATCH', cfg.endpoint, payload)
    }) as unknown as (...args: unknown[]) => unknown
  }
}

/** The opt-in `bulk-actions` API extension. */
export function bulkActionsExtension(): ApiExtension {
  return {
    register(ctx) {
      ctx.registerTool('bulk_update_records', BulkUpdateRecordsTool)
      ctx.registerModelServiceMixin(bulkActionsMixin)
    }
  }
}
```

```js file=src/tools/bulk-update-records-tool.js
import { z } from 'zod'
import { BaseTool } from '@mcp-rune/mcp-rune/tools'
import { getBulkActionsConfig, getBulkUpdatableModelNames } from './capabilities.js'
/**
 * MCP tool — `bulk_update_records`.
 *
 * Reads the model's `extensions['bulk-actions']` slice for the endpoint
 * and delegates to the `bulkUpdate` mixin contributed by this extension.
 */
export class BulkUpdateRecordsTool extends BaseTool {
  get name() {
    return 'bulk_update_records'
  }
  get annotations() {
    return {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  }
  get baseDescription() {
    return (
      `Patch many records at once via a single bulk-update endpoint. ` +
      `Models must declare a bulk-update endpoint via bulkActionsConfig.`
    )
  }
  get inputSchema() {
    return {
      model: this.zodEnum(getBulkUpdatableModelNames(this.models)).describe('Model name'),
      ids: z.array(z.string()).describe('Record IDs to update'),
      attributes: z.record(z.string(), z.unknown()).describe('Patch to apply to every record')
    }
  }
  async execute(args) {
    try {
      const service = this.requireModelService()
      const { model, ids, attributes } = args
      this.validateModel(model)
      const data = await service.bulkUpdate(model, ids, attributes)
      return this.formatResponse({ status: 'success', model, updated: ids.length, data })
    } catch (error) {
      return this.formatError(error)
    }
  }
}
const bulkActionsMixin = (service) => {
  return {
    bulkUpdate: async (model, ids, attributes) => {
      const modelConfig = service.models[model]
      if (!modelConfig) throw new Error(`Unknown model: ${model}`)
      const cfg = getBulkActionsConfig(modelConfig)
      if (!cfg) throw new Error(`Model '${model}' has no bulk-actions config`)
      const payload = service.buildPayload(model, modelConfig, { ids, attributes })
      return service.dispatch('PATCH', cfg.endpoint, payload)
    }
  }
}
/** The opt-in `bulk-actions` API extension. */
export function bulkActionsExtension() {
  return {
    register(ctx) {
      ctx.registerTool('bulk_update_records', BulkUpdateRecordsTool)
      ctx.registerModelServiceMixin(bulkActionsMixin)
    }
  }
}
```

Notice the mixin composes the **stable `ModelService` contract** — `service.models`, `service.buildPayload`, `service.dispatch` — instead of reaching into private internals. Anything prefixed with `_` is not part of the contract and may change.

### 5. Public surface — `index.ts`

```ts file=examples/authoring-extensions-guide-03.ts
export type { BulkActionsConfig } from './types.js'
export {
  bulkActionsConfig,
  getBulkActionsConfig,
  getBulkUpdatableModelNames
} from './capabilities.js'
export type { ModelWithExtensions } from './capabilities.js'
export { bulkActionsExtension, BulkUpdateRecordsTool } from './extension.js'
export type { BulkActionServiceMethods } from './extension.js'
```

```js file=examples/authoring-extensions-guide-03.js
export {
  bulkActionsConfig,
  getBulkActionsConfig,
  getBulkUpdatableModelNames
} from './capabilities.js'
export { bulkActionsExtension, BulkUpdateRecordsTool } from './extension.js'
```

That's the entire extension. Now wire it up.

### 6. Register on a model

```ts file=src/book.ts
import { BaseModel } from '@mcp-rune/mcp-rune/core'
import { bulkActionsConfig } from './bulk-actions/index.js'

class Book extends BaseModel {
  static api = { endpoint: 'books' }
  static extensions = {
    'bulk-actions': bulkActionsConfig({ endpoint: 'books/bulk-update' })
  }
}
```

```js file=src/book.js
import { BaseModel } from '@mcp-rune/mcp-rune/core'
import { bulkActionsConfig } from './bulk-actions/index.js'
class Book extends BaseModel {
  static api = { endpoint: 'books' }
  static extensions = {
    'bulk-actions': bulkActionsConfig({ endpoint: 'books/bulk-update' })
  }
}
```

### 7. Register on `ToolRegistry`

```ts file=examples/authoring-extensions-guide-05.ts
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
import { bulkActionsExtension } from './bulk-actions/index.js'

new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: { book: Book },
  createApiClient,
  apiExtensions: {
    'bulk-actions': bulkActionsExtension()
  }
})
```

```js file=examples/authoring-extensions-guide-05.js
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
import { bulkActionsExtension } from './bulk-actions/index.js'
new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: { book: Book },
  createApiClient,
  apiExtensions: {
    'bulk-actions': bulkActionsExtension()
  }
})
```

The convention is to use the same key in three places: the extension's directory name, the `extensions` bag key on models, and the `apiExtensions` registration key. The framework doesn't enforce this — but every built-in extension follows it, and breaking it costs you grep-ability.

## What you got for free

- The `bulk_update_records` MCP tool is registered automatically when `bulkActionsExtension()` is registered. Pure-REST servers that omit it have zero `bulk_update_records` in their tool catalogue.
- The mixin lets call sites do `tool.modelService.bulkUpdate(...)` as if it were a built-in method.
- Filter-validation, error handling, logging, tracing, auth — all already wrapped around the tool by the framework's tool pipeline.
- Tool-name collisions across extensions or against core tools throw at boot with both extension keys in the message — never silent overwrites.

## Test the extension

The built-in extensions ship the test patterns you should mirror — they exercise both authoring surfaces (registering on `ToolRegistry` + per-model slice) without re-testing the framework itself:

- **Tool tests** (`__tests__/lib/api-extensions/custom-actions/model-action-tool.spec.ts`): construct the tool directly with mocked dependencies, capture the mixin via the real extension factory.
- **Service-mixin tests** (`__tests__/lib/api-extensions/custom-actions/action-service.spec.ts`): construct a real `ModelService`, apply the captured mixin via `Object.assign`, then exercise the new methods end-to-end through the convention pipeline.
- **End-to-end registration tests** (`__tests__/lib/api-extensions/custom-actions/extension.spec.ts`): construct a `ToolRegistry` with and without your extension; assert the contributed tool surfaces (or doesn't), and that `list_models` output reflects the model config (or doesn't).

The "capture the mixin" helper is small and worth copying verbatim:

```ts file=src/capture-mixin.ts
import { vi } from 'vitest'
import type { ModelServiceMixin } from '@mcp-rune/mcp-rune/api-extensions'

function captureMixin(extensionFactory: () => { register: (ctx: any) => void }): ModelServiceMixin {
  let captured: ModelServiceMixin | undefined
  extensionFactory().register({
    name: 'test',
    models: {},
    serverContext: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    registerTool: () => {},
    registerModelServiceMixin: (m) => {
      captured = m
    }
  })
  return captured!
}
```

```js file=src/capture-mixin.js
import { vi } from 'vitest'
function captureMixin(extensionFactory) {
  let captured
  extensionFactory().register({
    name: 'test',
    models: {},
    serverContext: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerTool: () => {},
    registerModelServiceMixin: (m) => {
      captured = m
    }
  })
  return captured
}
```

It exercises the **real** extension factory rather than exporting the mixin for tests — keeps the surface honest.

## The `HttpExtension` version

`HttpExtension` is structurally simpler — no per-model config, no mixins, just routes. See [Extensions Guide](./extensions.md) for the contract and [`cimd`](../../src/extensions/cimd.ts) for a worked example. The mental model:

| `ApiExtension` piece | `HttpExtension` equivalent                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Per-model config     | n/a — extensions configure themselves at construction (`cimdExtension({ redirectUris, clientName, scope })`) |
| Typed helper         | n/a — config goes into the factory's parameters                                                              |
| Typed reader         | n/a                                                                                                          |
| Extension factory    | Same shape: `cimdExtension(): HttpExtension`                                                                 |
| Registration         | `new HttpServer({ extensions: { cimd: cimdExtension() } })`                                                  |

If you find yourself wanting per-model config or `ModelService` integration in an HTTP extension, you actually want an `ApiExtension`.

## Co-locating a multi-surface extension

Non-trivial integrations rarely fit in one extension type. A Stripe integration might need an `ApiExtension` (a `charge` mixin on `ModelService`), an `HttpExtension` (a `/webhooks/stripe` route receiver), and a `ToolFlowExtension` (a `stripe_charge_review` app tool with `'collect'` submit mode). Same feature, three surfaces.

**The convention: co-locate the pieces in one file and export them as siblings.** The deployer imports from one place and wires to the three config maps. Three lines of wiring is acceptable. A fourth abstraction layer (a `defineExtension({...})` wrapper that collapses the three) is not — see the [extensibility ADR](#why-no-definewrapper) below for why.

### File and naming convention

- **Filename:** `<feature>-integration.ts` (e.g. `stripe-integration.ts`, `audit-integration.ts`).
- **Export names:** `<feature><Surface>Extension` — `stripeApiExtension`, `stripeHttpExtension`, `stripeToolFlowExtension`. Surface names are exactly the ones on the extension's interface, so a reader can pattern-match the export to the config map it goes in.
- **Shared types** (a `StripeConfig` object, a typed `ContextKey<T>`, a `ModelService` mixin type) live next to the extensions in the same file. They're the integration's internal API.

### Worked example: an audit-log integration

The audit integration ships a tool, an HTTP webhook receiver, and a `ToolFlowExtension` that threads a `Map`-backed log into every app handler. All three live in `src/integrations/audit-integration.ts`.

```ts file=src/integrations/audit-integration.ts
import type { ApiExtension } from '@mcp-rune/mcp-rune/api-extensions'
import {
  defineContextKey,
  type HttpExtension,
  type ToolFlowExtension
} from '@mcp-rune/mcp-rune/extensions'
import { BaseTool, TOOL_CATEGORIES, type ToolResult } from '@mcp-rune/mcp-rune/tools'
import { z } from 'zod'

/** Shared store typed key — consumers import this to read the audit log. */
export const AUDIT_LOG_KEY = defineContextKey<Map<string, unknown>>('auditLog')

class AuditRecentTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.DATA
  }
  override get name() {
    return 'audit_recent'
  }
  override get baseDescription() {
    return 'Return the last N audit log entries.'
  }
  override get inputSchema() {
    return { limit: z.number().int().min(1).max(100).default(20) }
  }
  override async execute(args: { limit: number }): Promise<ToolResult> {
    const entries = await this.dataLayer!.dispatch('GET', `audit?limit=${args.limit}`)
    return { content: [{ type: 'text', text: JSON.stringify(entries) }] }
  }
}

export const auditApiExtension: ApiExtension = {
  register(ctx) {
    ctx.registerTool('audit_recent', AuditRecentTool)
  }
}

export function auditHttpExtension(secret: string): HttpExtension {
  return {
    register(ctx) {
      ctx.router.post('/webhooks/audit', (req, res) => {
        /* verify req.headers['x-signature'] against `secret`, persist event */
        res.status(200).end()
      })
    }
  }
}

export const auditToolFlowExtension: ToolFlowExtension = {
  register(ctx) {
    ctx.provideContext(AUDIT_LOG_KEY, new Map<string, unknown>())
  }
}
```

```js file=src/integrations/audit-integration.js
import { defineContextKey } from '@mcp-rune/mcp-rune/extensions'
import { BaseTool, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'
import { z } from 'zod'

export const AUDIT_LOG_KEY = defineContextKey('auditLog')

class AuditRecentTool extends BaseTool {
  static get category() {
    return TOOL_CATEGORIES.DATA
  }
  get name() {
    return 'audit_recent'
  }
  get baseDescription() {
    return 'Return the last N audit log entries.'
  }
  get inputSchema() {
    return { limit: z.number().int().min(1).max(100).default(20) }
  }
  async execute(args) {
    const entries = await this.dataLayer.dispatch('GET', `audit?limit=${args.limit}`)
    return { content: [{ type: 'text', text: JSON.stringify(entries) }] }
  }
}

export const auditApiExtension = {
  register(ctx) {
    ctx.registerTool('audit_recent', AuditRecentTool)
  }
}

export function auditHttpExtension(secret) {
  return {
    register(ctx) {
      ctx.router.post('/webhooks/audit', (req, res) => {
        /* verify req.headers['x-signature'] against `secret`, persist event */
        res.status(200).end()
      })
    }
  }
}

export const auditToolFlowExtension = {
  register(ctx) {
    ctx.provideContext(AUDIT_LOG_KEY, new Map())
  }
}
```

### The wire-up

Three sibling imports, three config maps. The wiring stays at the deployer's call sites — it's the framework's auditability contract that anyone reading the server entry point can answer "what's registered here?" without grep:

```ts file=src/server-audit.ts
import { HttpServer, createServer } from '@mcp-rune/mcp-rune/server'
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
import {
  auditApiExtension,
  auditHttpExtension,
  auditToolFlowExtension
} from './integrations/audit-integration.js'

const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  apiExtensions: { audit: auditApiExtension }
})

const mcp = {
  name: 'my-server',
  createServer: ({ sessionId, transport, getAccessToken }) =>
    createServer({
      name: 'my-server',
      version: '1.0.0',
      sessionId,
      transport,
      toolRegistry,
      appRegistry,
      toolFlowExtensions: { audit: auditToolFlowExtension },
      getAccessToken
    })
}

new HttpServer({
  port: 3000,
  oauth,
  mcp,
  extensions: { audit: auditHttpExtension(process.env.AUDIT_SECRET!) }
})
```

```js file=src/server-audit.js
import { HttpServer, createServer } from '@mcp-rune/mcp-rune/server'
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
import {
  auditApiExtension,
  auditHttpExtension,
  auditToolFlowExtension
} from './integrations/audit-integration.js'

const toolRegistry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  apiExtensions: { audit: auditApiExtension }
})

const mcp = {
  name: 'my-server',
  createServer: ({ sessionId, transport, getAccessToken }) =>
    createServer({
      name: 'my-server',
      version: '1.0.0',
      sessionId,
      transport,
      toolRegistry,
      appRegistry,
      toolFlowExtensions: { audit: auditToolFlowExtension },
      getAccessToken
    })
}

new HttpServer({
  port: 3000,
  oauth,
  mcp,
  extensions: { audit: auditHttpExtension(process.env.AUDIT_SECRET) }
})
```

### Cross-references between siblings

When one surface needs to share state with another — the tool needs to read the `Map` the `ToolFlowExtension` provides, the HTTP handler needs to persist into the same `Map` — the typed `ContextKey<T>` defined at file top is the contract. Producers call `ctx.provideContext(KEY, value)`; consumers (app-tool handlers, custom tools that read context) reach into the bag by `context[KEY.name]`. The key is the integration's internal API.

For per-model config that one of the surfaces consumes (e.g. an `ApiExtension`'s `customActionsConfig`-style typed helper), follow the [Step-by-step: build a `bulk-actions` extension](#step-by-step-build-a-bulk-actions-extension) recipe earlier in this guide — that pattern works identically when used as a sibling inside a multi-surface integration file.

### Why no `defineExtension({...})` wrapper

A "one function that registers all three surfaces" sugar layer would have to keep a parallel API in sync with the three underlying typed contexts, hide the layer model from deployers when something breaks at the wrong layer, and encourage cross-cutting extensions that should be split into independent units. The framework deliberately preserves the **"one call site answers what is running"** invariant (`extensions.md:23`) — that property is more valuable than saving two lines of wiring boilerplate per integration.

The decision is documented in the extensibility ADR with a concrete trigger for revisiting: if real-world deployers consistently ship integrations where >50% of LOC is wiring boilerplate across the three config maps, the sugar becomes justified. Until then, the convention is documentation, not API. For the deployer-facing version of this recipe, see [Extension Recipes — Stripe-style integration](./extension-recipes.md#add-a-feature-that-touches-more-than-one-surface-stripe-style-integration).

## Pre-1.0 stability

`ApiExtensionContext`, `HttpExtensionContext`, and the `ModelService` mixin contract (`dispatch`, `buildPayload`, `endpointResolver`, `apiClient`, `models`) are **pre-1.0** — they may change in minor releases. Breaking changes are called out in `CHANGELOG.md`. Post-1.0 these shapes are major-version-locked.

If you publish your extension as a separate package, pin a `peerDependencies` range:

```json
{
  "peerDependencies": {
    "@mcp-rune/mcp-rune": "^1.0.0"
  }
}
```

## See also

- [API Extensions Guide](./api-extensions.md) — the conceptual reference (architecture overview, narrowed-context principle, naming convention, the "Why the namespaced bag?" rationale)
- [Extensions Guide (HTTP)](./extensions.md) — the `HttpExtension` contract and worked CIMD example
- [Service Layer Guide](./service-layer-guide.md) — what `ModelService.dispatch`, `buildPayload`, `endpointResolver`, `apiClient`, `models` actually do — the stable mixin contract
- [API Configuration Guide](./api-config-guide.md) — how `BaseModel.api` and `static extensions` interact
- Source of the built-ins:
  - [`src/api-extensions/custom-actions.ts`](../../src/api-extensions/custom-actions.ts) — single-file extension (tool + mixin + helper + reader)
  - [`src/api-extensions/search/`](../../src/api-extensions/search/) — directory-shaped extension (multiple modules including a factory)
  - [`src/extensions/cimd.ts`](../../src/extensions/cimd.ts) — minimal `HttpExtension`
