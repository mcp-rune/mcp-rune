---
extension:
  kind: hub
  what: Recipes — start here to pick the right extension surface
---

# Extension Recipes

Start here. mcp-rune ships three extension surfaces (`HttpExtension`, `ApiExtension`, `ToolFlowExtension`) plus several non-extension seams (`DataLayer`, `BaseConvention`, `SearchAdapter`, attribute `Kind`s). Each has its own dedicated guide — but for first contact you usually want the inverse map: "I want to do **X** — which seam does that?"

This page is that map. Each recipe is organized by deployer intent, not by extension type. Pick the entry that matches what you're trying to do, copy the example, then follow the link for the full reference.

<!-- illustration: extension-recipes#recipes -->

```
   I want to...
        │
        ├── Add a non-CRUD verb to a model
        │       (publish, archive, status changes)
        │       → customActionsExtension       (ApiExtension)
        │
        ├── Add an MCP tool unrelated to a model
        │       → ToolRegistry + BaseTool subclass
        │
        ├── Add an HTTP route (webhook, health, custom OAuth)
        │       → HttpExtension
        │
        ├── Stage a write for human review
        │       (collect → review → submit)
        │       → ToolFlowExtension  (e.g. centerOfControlExtension)
        │
        ├── Add a new summary lens
        │       → SummaryStrategy via ApiExtension
        │
        ├── Swap payload / association shape for one model
        │       → BaseConvention override
        │
        ├── Stub the API for integration tests
        │       → DataLayer override          (in-memory)
        │
        └── Touch many surfaces at once
                (Stripe-style integration)
                → see "Multi-surface" recipe below
```

Each leaf below is one section in this guide. Pick the row that matches, copy the snippet, follow the link for the full reference.

## Table of Contents

- [Add a non-CRUD verb to a model (publish, archive)](#add-a-non-crud-verb-to-a-model-publish-archive)
- [Add a custom MCP tool unrelated to a model](#add-a-custom-mcp-tool-unrelated-to-a-model)
- [Add an HTTP route inside the same process](#add-an-http-route-inside-the-same-process)
- [Stage a write for human review before submitting to the API](#stage-a-write-for-human-review-before-submitting-to-the-api)
- [Add a new way to summarize a page of records for `analysis_ingest`](#add-a-new-way-to-summarize-a-page-of-records-for-analysis_ingest)
- [Swap the response-parsing convention for one model](#swap-the-response-parsing-convention-for-one-model)
- [Stub the API for integration tests](#stub-the-api-for-integration-tests)
- [Add a feature that touches more than one surface (Stripe-style integration)](#add-a-feature-that-touches-more-than-one-surface-stripe-style-integration)

---

## Add a non-CRUD verb to a model (publish, archive)

Use the built-in `customActionsExtension`. Declare per-model verbs in the model's `extensions` bag; the framework exposes them as a single `model_action` MCP tool plus generated handlers on `ModelService`.

```ts file=src/models/post.ts
import { BaseModel } from '@mcp-rune/mcp-rune'
import type { AttributeDefinition } from '@mcp-rune/mcp-rune/core'
import { customActionsConfig } from '@mcp-rune/mcp-rune/api-extensions/custom-actions'

export class Post extends BaseModel {
  static override api = { endpoint: 'posts' }
  static override attributes: Record<string, AttributeDefinition> = {
    title: { type: 'string', required: true },
    body: { type: 'text' }
  }
  static override extensions = {
    'custom-actions': customActionsConfig({
      publish: { method: 'POST', path: ':id/publish' },
      archive: { method: 'POST', path: ':id/archive' }
    })
  }
}
```

```js file=src/models/post.js
import { BaseModel } from '@mcp-rune/mcp-rune'
import { customActionsConfig } from '@mcp-rune/mcp-rune/api-extensions/custom-actions'

export class Post extends BaseModel {
  static api = { endpoint: 'posts' }
  static attributes = {
    title: { type: 'string', required: true },
    body: { type: 'text' }
  }
  static extensions = {
    'custom-actions': customActionsConfig({
      publish: { method: 'POST', path: ':id/publish' },
      archive: { method: 'POST', path: ':id/archive' }
    })
  }
}
```

Register the extension on `ToolRegistry`:

```ts file=src/registry-custom-actions.ts
import { ToolRegistry } from '@mcp-rune/mcp-rune/tools'
import { customActionsExtension } from '@mcp-rune/mcp-rune/api-extensions/custom-actions'

const registry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  apiExtensions: {
    'custom-actions': customActionsExtension()
  }
})
```

```js file=src/registry-custom-actions.js
import { ToolRegistry } from '@mcp-rune/mcp-rune/tools'
import { customActionsExtension } from '@mcp-rune/mcp-rune/api-extensions/custom-actions'

const registry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: (token) => createApiClient(token, { apiUrl }),
  apiExtensions: {
    'custom-actions': customActionsExtension()
  }
})
```

**Why this lives in `ApiExtension`:** custom verbs reach into `ModelService` to share HTTP dispatch, payload building, and endpoint resolution. The `ApiExtension` boundary gives them typed access to those primitives without exposing the rest of the registry.

→ Full reference: [API Extensions](./api-extensions.md). Built-in custom-actions source: [`src/api-extensions/custom-actions.ts`](../../../src/api-extensions/custom-actions.ts).

---

## Add a custom MCP tool unrelated to a model

When a tool isn't a CRUD operation on one of your models — a workflow helper, a one-off report generator, a domain calculation — write a `BaseTool` subclass and contribute it via `ApiExtension.registerTool`.

```ts file=src/tools/audit-tool.ts
import type { ApiExtension } from '@mcp-rune/mcp-rune/api-extensions'
import { BaseTool, TOOL_CATEGORIES, type ToolResult } from '@mcp-rune/mcp-rune/tools'
import { z } from 'zod'

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

export const auditExtension: ApiExtension = {
  register(ctx) {
    ctx.registerTool('audit_recent', AuditRecentTool)
  }
}
```

```js file=src/tools/audit-tool.js
import { BaseTool, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'
import { z } from 'zod'

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

export const auditExtension = {
  register(ctx) {
    ctx.registerTool('audit_recent', AuditRecentTool)
  }
}
```

**Why this lives in `ApiExtension`:** custom tools go through the same auth pipeline, interceptor chain, and tracing wrapper as core tools. Registering through an extension keeps them opt-in (servers that don't import the extension don't pay for the tool) and gives the contribution an owner key for collision diagnostics.

→ Full references: [Tool Creation](../03-tools-and-services/tool-creation.md) for the `BaseTool` contract, [API Extensions](./api-extensions.md) for the registration shape.

---

## Add an HTTP route inside the same process

When you need to expose a route alongside `/oauth/*`, `/health`, and `/mcp` — a webhook receiver, a debug endpoint, a richer health probe — write an `HttpExtension`. The framework hands you a pre-mounted Express `Router` and a narrowed context object.

```ts file=src/extensions/whoami-extension.ts
import type { HttpExtension } from '@mcp-rune/mcp-rune/extensions'

export function whoamiExtension(): HttpExtension {
  return {
    register(ctx) {
      ctx.router.get('/whoami', (_req, res) => {
        res.json({
          server: ctx.mcpName,
          baseUrl: ctx.baseUrl,
          oauthMode: ctx.oauth !== null
        })
      })
    }
  }
}
```

```js file=src/extensions/whoami-extension.js
export function whoamiExtension() {
  return {
    register(ctx) {
      ctx.router.get('/whoami', (_req, res) => {
        res.json({
          server: ctx.mcpName,
          baseUrl: ctx.baseUrl,
          oauthMode: ctx.oauth !== null
        })
      })
    }
  }
}
```

Wire on `HttpServer`:

```ts file=src/server-http-extension.ts
import { HttpServer } from '@mcp-rune/mcp-rune/server'
import { whoamiExtension } from './extensions/whoami-extension.js'

new HttpServer({
  port: 3000,
  oauth,
  mcp,
  extensions: {
    whoami: whoamiExtension()
  }
})
```

```js file=src/server-http-extension.js
import { HttpServer } from '@mcp-rune/mcp-rune/server'
import { whoamiExtension } from './extensions/whoami-extension.js'

new HttpServer({
  port: 3000,
  oauth,
  mcp,
  extensions: {
    whoami: whoamiExtension()
  }
})
```

**Why this lives in `HttpExtension`:** the extension owns its `Router` but cannot mutate global middleware, error handlers, or the MCP transport. That isolation is the contract — extensions can break their own routes but not the host.

→ Full reference: [Extensions (HttpExtension)](./extensions-http.md). Worked example with capabilities: the built-in [CIMD extension](../../../src/extensions/cimd.ts).

---

## Stage a write for human review before submitting to the API

For human-in-the-loop flows ("collect → review → confirm → submit"), opt into the built-in `centerOfControlExtension`. It flips the form `submitMode` to `'collect'`, registers `collect_form_data` / `get_form_data` tools, and threads a per-server `FormDataStore` into the app-tool context.

```ts file=src/server-center-of-control.ts
import { createServer } from '@mcp-rune/mcp-rune/server'
import { centerOfControlExtension } from '@mcp-rune/mcp-rune/extensions/center-of-control'

createServer({
  name: 'my-mcp',
  version: '1.0.0',
  sessionId,
  transport,
  toolRegistry,
  appRegistry,
  toolFlowExtensions: { centerOfControl: centerOfControlExtension },
  getAccessToken
})
```

```js file=src/server-center-of-control.js
import { createServer } from '@mcp-rune/mcp-rune/server'
import { centerOfControlExtension } from '@mcp-rune/mcp-rune/extensions/center-of-control'

createServer({
  name: 'my-mcp',
  version: '1.0.0',
  sessionId,
  transport,
  toolRegistry,
  appRegistry,
  toolFlowExtensions: { centerOfControl: centerOfControlExtension },
  getAccessToken
})
```

The flow becomes: user fills the form → clicks Done → iframe calls `collect_form_data` → store stages the payload → LLM calls `get_form_data` to display a summary → LLM calls `create_model` / `update_model` on user confirmation.

To write a similar approval flow against a different review surface (Slack, an internal queue, an email loop), follow the same shape: a `ToolFlowExtension` that calls `setFormSubmitMode('collect')`, registers a `request_approval`-style tool, and uses `defineContextKey` to share its store with handlers.

**Why this lives in `ToolFlowExtension`:** the flow mutates the **tool surface** (new app tools) and the **runtime context** (the store passed to every app handler) in one coordinated unit. `ApiExtension` is wrong because the store doesn't belong on `ModelService`; `HttpExtension` is wrong because the flow is MCP-transport-agnostic.

→ Full reference: [Tool Flow Extension Guide](./tool-flow-extension.md). Worked example: [`src/extensions/center-of-control.ts`](../../../src/extensions/center-of-control.ts).

---

## Add a new way to summarize a page of records for `analysis_ingest`

`analysis_ingest` writes one memory per page using a `SummaryStrategy`. Five strategies ship built-in (`distribution`, `coverage`, `anomaly`, `temporal`, `entity-extraction`). Contribute a new one through `ApiExtension.registerSummaryStrategy` — strategies are deterministic pure functions over the records array.

```ts file=src/extensions/sales-narrative-strategy.ts
import type { ApiExtension } from '@mcp-rune/mcp-rune/api-extensions'
import type { SummaryStrategy } from '@mcp-rune/mcp-rune/api-extensions'

const salesNarrativeStrategy: SummaryStrategy = {
  name: 'sales-narrative',
  description: 'Prose summary tuned for deal records: pipeline stage, $ amount, owner.',
  appliesTo: (input) => input.model === 'deal',
  generate: (input) => ({
    finding: `Page ${input.page}: ${input.records.length} deals tracked.`,
    metadata: { page: input.page, model: input.model }
  })
}

export const salesNarrativeExtension: ApiExtension = {
  register(ctx) {
    ctx.registerSummaryStrategy(salesNarrativeStrategy)
  }
}
```

```js file=src/extensions/sales-narrative-strategy.js
const salesNarrativeStrategy = {
  name: 'sales-narrative',
  description: 'Prose summary tuned for deal records: pipeline stage, $ amount, owner.',
  appliesTo: (input) => input.model === 'deal',
  generate: (input) => ({
    finding: `Page ${input.page}: ${input.records.length} deals tracked.`,
    metadata: { page: input.page, model: input.model }
  })
}

export const salesNarrativeExtension = {
  register(ctx) {
    ctx.registerSummaryStrategy(salesNarrativeStrategy)
  }
}
```

Once registered, callers select your strategy via `analysis_ingest(summary_strategy: 'sales-narrative')` or include it in `summary_strategies: ['sales-narrative', 'distribution']`. Strategy names are globally unique across built-ins and extensions; collisions throw at boot with both contributor keys in the error.

**Why this lives in `ApiExtension`:** strategies extend the model-layer surface (they read `input.records` which the framework fetches via `DataLayer`) and the registration happens at `ToolRegistry` construction. Same lifetime, same context, same collision rules as tool registration.

→ Full reference: [Summary Strategies](../05-retrieval-graphrag/summary-strategies.md). The built-in strategies live under [`src/core/summary-strategies/`](../../../src/core/summary-strategies/).

---

## Swap the response-parsing convention for one model

If your API doesn't follow JSON:API — different envelope shape, different association resolution, different error format — implement `BaseConvention` and attach it per-model. No extension is needed; this is a plain model-config field.

```ts file=src/conventions/hal-convention.ts
import type { BaseConvention } from '@mcp-rune/mcp-rune/prompts'

export const halConvention: BaseConvention = {
  parseRecords(response, model) {
    return response._embedded?.[model] ?? []
  },
  parseErrorResponse(response) {
    return { message: response.message, details: response.errors }
  },
  normalizeRecord(record) {
    const { _links, _embedded, ...attrs } = record
    return attrs
  }
  // ...full surface in api-convention-guide.md
}
```

```js file=src/conventions/hal-convention.js
export const halConvention = {
  parseRecords(response, model) {
    return response._embedded?.[model] ?? []
  },
  parseErrorResponse(response) {
    return { message: response.message, details: response.errors }
  },
  normalizeRecord(record) {
    const { _links, _embedded, ...attrs } = record
    return attrs
  }
  // ...full surface in api-convention-guide.md
}
```

```ts file=src/models/legacy-record.ts
import { BaseModel } from '@mcp-rune/mcp-rune'
import type { AttributeDefinition } from '@mcp-rune/mcp-rune/core'
import { halConvention } from '../conventions/hal-convention.js'

export class LegacyRecord extends BaseModel {
  static override api = {
    endpoint: 'records',
    convention: halConvention
  }
  static override attributes: Record<string, AttributeDefinition> = {
    title: { type: 'string', required: true }
  }
}
```

```js file=src/models/legacy-record.js
import { BaseModel } from '@mcp-rune/mcp-rune'
import { halConvention } from '../conventions/hal-convention.js'

export class LegacyRecord extends BaseModel {
  static api = {
    endpoint: 'records',
    convention: halConvention
  }
  static attributes = { title: { type: 'string', required: true } }
}
```

**Why this isn't an `ApiExtension`:** conventions are model-level configuration, not registry-wide behavior. Two models with different upstream APIs each pick their own convention; the framework dispatches based on the model being acted on.

→ Full reference: [Custom API Convention](../08-adapters/api-convention.md).

---

## Stub the API for integration tests

When you want to exercise the tool surface end-to-end without a live API — for tests, demos, or local development — swap the `DataLayer` factory on `ToolRegistry`. The built-in `createInMemoryDataLayer` accepts fixtures keyed by model:

```ts file=src/registry-in-memory.ts
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
import { createInMemoryDataLayer } from '@mcp-rune/mcp-rune/core'

const registry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: () => null as never, // unused with in-memory data layer
  dataLayer: createInMemoryDataLayer({
    fixtures: {
      book: {
        '1': { id: '1', title: 'Clean Code', author: 'Bob Martin' },
        '2': { id: '2', title: 'The Pragmatic Programmer', author: 'Andy Hunt' }
      }
    }
  })
})
```

```js file=src/registry-in-memory.js
import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
import { createInMemoryDataLayer } from '@mcp-rune/mcp-rune/core'

const registry = new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  createApiClient: () => null,
  dataLayer: createInMemoryDataLayer({
    fixtures: {
      book: {
        1: { id: '1', title: 'Clean Code', author: 'Bob Martin' },
        2: { id: '2', title: 'The Pragmatic Programmer', author: 'Andy Hunt' }
      }
    }
  })
})
```

Every CRUD tool now reads from and writes to the fixture map. No HTTP, no auth, no fixtures cleanup between test runs unless you reset the registry.

**Why this isn't an extension:** `DataLayer` is a single per-server adapter, not a registry of contributions. The deployer picks one — `ModelService` (default), `createInMemoryDataLayer`, or a custom class — and the projection layer (tools, prompts, apps) talks to it through one stable interface.

→ Full reference: [DataLayer Guide](../08-adapters/data-layer.md), §"In-Memory Stub for Tests."

---

## Add a feature that touches more than one surface (Stripe-style integration)

Real integrations rarely fit cleanly in one extension type. A Stripe integration, for example, might need:

- A `publish` `ModelService` mixin (via `ApiExtension`) to call the Stripe API on a model write
- A `/webhooks/stripe` route handler (via `HttpExtension`) to receive Stripe events
- A `stripe_charge_review` app tool with `'collect'` submit mode (via `ToolFlowExtension`)

**Co-locate the pieces in one file** and export them as siblings. The deployer imports from one place and wires to the three config maps. Naming convention: `<feature>Integration.ts` for the filename, `<feature><Surface>Extension` for the exports.

```ts file=src/integrations/stripe-integration.ts
import type { ApiExtension } from '@mcp-rune/mcp-rune/api-extensions'
import type { HttpExtension, ToolFlowExtension } from '@mcp-rune/mcp-rune/extensions'

export const stripeApiExtension: ApiExtension = {
  register(ctx) {
    ctx.registerModelServiceMixin(() => ({
      stripeCharge: async (model: string, recordId: string) => {
        /* ... */
      }
    }))
  }
}

export function stripeHttpExtension(secret: string): HttpExtension {
  return {
    register(ctx) {
      ctx.router.post('/webhooks/stripe', (req, res) => {
        /* verify with `secret`, dispatch event */
        res.status(200).end()
      })
    }
  }
}

export const stripeToolFlowExtension: ToolFlowExtension = {
  requires: ['apps'],
  register(_ctx) {
    /* register stripe_charge_review app tool, set 'collect' mode */
  }
}
```

```js file=src/integrations/stripe-integration.js
export const stripeApiExtension = {
  register(ctx) {
    ctx.registerModelServiceMixin(() => ({
      stripeCharge: async (model, recordId) => {
        /* ... */
      }
    }))
  }
}

export function stripeHttpExtension(secret) {
  return {
    register(ctx) {
      ctx.router.post('/webhooks/stripe', (req, res) => {
        /* verify with `secret`, dispatch event */
        res.status(200).end()
      })
    }
  }
}

export const stripeToolFlowExtension = {
  requires: ['apps'],
  register(_ctx) {
    /* register stripe_charge_review app tool, set 'collect' mode */
  }
}
```

Wire them at three call sites — that's the contract:

```ts file=src/server-stripe-wire.ts
import {
  stripeApiExtension,
  stripeHttpExtension,
  stripeToolFlowExtension
} from './integrations/stripe-integration.js'

const toolRegistry = new ToolRegistry({
  /* ... */ apiExtensions: { stripe: stripeApiExtension }
})

createServer({
  /* ... */ toolFlowExtensions: { stripe: stripeToolFlowExtension }
})

new HttpServer({
  /* ... */
  extensions: { stripe: stripeHttpExtension(process.env.STRIPE_WEBHOOK_SECRET!) }
})
```

```js file=src/server-stripe-wire.js
import {
  stripeApiExtension,
  stripeHttpExtension,
  stripeToolFlowExtension
} from './integrations/stripe-integration.js'

const toolRegistry = new ToolRegistry({
  /* ... */ apiExtensions: { stripe: stripeApiExtension }
})

createServer({
  /* ... */ toolFlowExtensions: { stripe: stripeToolFlowExtension }
})

new HttpServer({
  /* ... */
  extensions: { stripe: stripeHttpExtension(process.env.STRIPE_WEBHOOK_SECRET) }
})
```

Three lines of wiring across three config maps is acceptable. A fourth abstraction layer that hides the wiring is not — the framework deliberately preserves the property that "what is registered on this server" is answerable by reading the three call sites.

**Why no `defineExtension({...})` wrapper:** sugar that collapses the three surfaces into one object would have to stay in sync with three underlying types, hide the layer model from deployers when something breaks, and encourage cross-cutting extensions that should be split. The current decision (documented in the extensibility ADR) is to solve cross-cutting authoring with this convention and revisit sugar only if real usage shows >50% of LOC is wiring boilerplate.

→ Full reference with the file/naming convention, a worked end-to-end audit-integration example, and the cross-reference-via-`ContextKey` pattern: [Authoring Extensions — Co-locating a multi-surface extension](./authoring-extensions.md#co-locating-a-multi-surface-extension).

---

**See also:**

- [Extensibility Overview](./extensibility.md) — the seam map and the five conventions every extension follows.
- [Authoring Extensions](./authoring-extensions.md) — assembly contract shared by `HttpExtension` and `ApiExtension`.
- [Extensions (HttpExtension)](./extensions-http.md), [API Extensions](./api-extensions.md), [Tool Flow Extension Guide](./tool-flow-extension.md) — the three typed extension surfaces.
