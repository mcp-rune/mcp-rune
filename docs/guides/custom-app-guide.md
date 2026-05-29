---
extension:
  kind: plugin
  what: Write a custom MCP app
---

# Writing a Custom MCP App

mcp-rune ships six **MCP Apps** — interactive iframe widgets the LLM can summon: `list-view`, `record-detail`, `search-view`, `model-form`, `multi-select-picker`, `autocomplete-picker`. They share infrastructure: the kind taxonomy from [`kind-metadata`](./attribute-kinds-guide.md), the formatter registry from `apps/shared/formatters.ts`, the form-schema generator, the selection store, theming.

You write a **custom app** when the six don't fit. Examples:

- A read-only dashboard that aggregates several models into a single view.
- A bulk-edit grid with cell-level validation.
- A specialized picker for a domain object (e.g. a calendar for a `booking` model).
- A printable artifact (invoice, certificate) the user can trigger from the chat.

This guide covers the `AppDefinition` shape, the three categories of app, the deployer-facing single-file path, and the advanced Vite-bundled path that reuses the kind taxonomy.

For the protocol-level deep dive — how iframe communication works, message ordering, the `@modelcontextprotocol/ext-apps` SDK — see [MCP Apps Architecture](./mcp-apps-architecture.md). For the user-facing introduction, see [MCP Apps Guide](./mcp-apps-guide.md).

## Table of Contents

- [`AppDefinition` Shape](#appdefinition-shape)
- [Three Categories of App](#three-categories-of-app)
- [Anatomy of a Framework App](#anatomy-of-a-framework-app)
- [Single-File Custom App](#single-file-custom-app)
- [Vite-Bundled Custom App](#vite-bundled-custom-app)
- [Reusing the Kind Taxonomy](#reusing-the-kind-taxonomy)
- [Wiring Into the Registry](#wiring-into-the-registry)
- [Testing a Custom App](#testing-a-custom-app)

## `AppDefinition` Shape

```ts file=src/app-definition.ts
import type { AppDefinition } from '@mcp-rune/mcp-rune/apps'

interface AppDefinition {
  name: string // unique identifier
  description: string // shown to the LLM
  resourceUri?: string // mcp://... where the iframe HTML lives
  toolName?: string // MCP tool that opens the app
  toolDescription?: string
  toolInputSchema?: Record<string, unknown> // Zod-flavored input schema
  needsAuth?: boolean // requires an authenticated request
  visibility?: string[] // optional visibility filter
  annotations?: {
    // MCP tool annotations
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  handleToolCall?(args, context): Promise<ToolResult> // server-side handler
  getHtml?(): string // HTML for the iframe
}
```

```js file=src/app-definition.js
/**
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * import type { AppDefinition } from '@mcp-rune/mcp-rune/apps'
 *
 * interface AppDefinition {
 *   name: string // unique identifier
 *   description: string // shown to the LLM
 *   resourceUri?: string // mcp://... where the iframe HTML lives
 *   toolName?: string // MCP tool that opens the app
 *   toolDescription?: string
 *   toolInputSchema?: Record<string, unknown> // Zod-flavored input schema
 *   needsAuth?: boolean // requires an authenticated request
 *   visibility?: string[] // optional visibility filter
 *   annotations?: {
 *     // MCP tool annotations
 *     readOnlyHint?: boolean
 *     destructiveHint?: boolean
 *     idempotentHint?: boolean
 *     openWorldHint?: boolean
 *   }
 *   handleToolCall?(args, context): Promise<ToolResult> // server-side handler
 *   getHtml?(): string // HTML for the iframe
 * }
 */
```

Every field is optional except `name` and `description`. What you populate determines which category your app falls into.

## Three Categories of App

| Category            | Populates                                       | Use when                                                                                                                                  |
| ------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Pure UI**         | `getHtml`, `resourceUri`                        | The app is static or self-contained — no server-side work.                                                                                |
| **Tool-backed**     | `toolName`, `toolInputSchema`, `handleToolCall` | A tool the LLM calls (with no iframe), e.g. `get_field_suggestions`.                                                                      |
| **Resource + tool** | All of the above                                | The standard interactive widget pattern — LLM calls the tool with arguments, server returns metadata pointing the iframe to the resource. |

The shipped apps are almost all category three. `record-detail`, for instance: the LLM calls `find_records_app(model, ids)`, the handler fetches records and returns a `ToolResult` with `_meta` referencing the `mcp://app/record-detail` resource; the host loads the HTML, the iframe receives the data via postMessage and renders.

## Anatomy of a Framework App

Take `record-detail`:

```
src/mcp/apps/
├── record-detail.ts         ← server-side AppDefinition factory + handleToolCall
├── record-detail-ui/        ← iframe source (HTML + app.js + styles)
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── dist/
    └── record-detail.html   ← single-file iframe bundle (Vite output)
```

The server file (`record-detail.ts`):

```ts file=src/mcp/apps/record-detail.ts
export function createRecordDetailApp(opts: { models: ModelsRegistry }): AppDefinition {
  return {
    name: 'record_detail',
    description: 'Renders a read-only detail card for one or more records',
    resourceUri: 'mcp://app/record-detail',
    toolName: 'find_records_app',
    toolDescription: 'Open the record-detail viewer with the given IDs.',
    toolInputSchema: { model: z.enum(modelNames), ids: z.array(z.string()).optional() },
    annotations: { readOnlyHint: true },
    getHtml: () => loadHtml(),
    needsAuth: true,
    async handleToolCall(args, context) {
      const records = await context.dataLayer.list(args.model, { id: args.ids })
      return {
        content: [{ type: 'text', text: formatAppSummary(records) }],
        _meta: appResponseMeta({ records, schema })
      }
    }
  }
}
```

```js file=src/mcp/apps/record-detail.js
export function createRecordDetailApp(opts) {
  return {
    name: 'record_detail',
    description: 'Renders a read-only detail card for one or more records',
    resourceUri: 'mcp://app/record-detail',
    toolName: 'find_records_app',
    toolDescription: 'Open the record-detail viewer with the given IDs.',
    toolInputSchema: { model: z.enum(modelNames), ids: z.array(z.string()).optional() },
    annotations: { readOnlyHint: true },
    getHtml: () => loadHtml(),
    needsAuth: true,
    async handleToolCall(args, context) {
      const records = await context.dataLayer.list(args.model, { id: args.ids })
      return {
        content: [{ type: 'text', text: formatAppSummary(records) }],
        _meta: appResponseMeta({ records, schema })
      }
    }
  }
}
```

The handler fetches data, formats a summary the LLM sees, and ships `_meta` containing the records and schema the iframe will consume.

The iframe (`record-detail-ui/app.js`) reads the records out of the host message, walks the schema, calls `renderCellValue(value, field)` from `apps/shared/formatters.ts` for each field, and appends nodes to the DOM. Kind-aware rendering, theming, and selection state are inherited automatically.

## Single-File Custom App

For most deployer-written apps, you don't need Vite. Ship a single inline HTML string:

```ts file=src/apps/create-booking-calendar-app.ts
// your-server/apps/booking-calendar.ts
import { z } from 'zod'
import type { AppDefinition } from '@mcp-rune/mcp-rune/apps'

export function createBookingCalendarApp(): AppDefinition {
  return {
    name: 'booking_calendar',
    description: 'Display a monthly calendar of bookings.',
    resourceUri: 'mcp://app/booking-calendar',
    toolName: 'show_booking_calendar',
    toolDescription: 'Open the calendar for a given month.',
    toolInputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/) },
    annotations: { readOnlyHint: true },
    needsAuth: true,
    getHtml: () => HTML,
    async handleToolCall(args, context) {
      const month = (args as { month: string }).month
      const records = await context.dataLayer.list('booking', { month })
      return {
        content: [{ type: 'text', text: `Loaded ${records.length} bookings for ${month}` }],
        _meta: { 'mcp-rune/payload': { records, month } }
      }
    }
  }
}

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Bookings</title>
<style>body { font-family: system-ui; padding: 1rem; }</style></head>
<body>
  <h1>Bookings</h1>
  <div id="grid"></div>
  <script type="module">
    import { openWindow } from 'https://esm.sh/@modelcontextprotocol/ext-apps@1.7.1'
    const host = await openWindow()
    const payload = host.toolOutput?._meta?.['mcp-rune/payload']
    document.getElementById('grid').textContent =
      'Month: ' + payload.month + ' — ' + payload.records.length + ' bookings'
  </script>
</body></html>`
```

```js file=src/apps/create-booking-calendar-app.js
// your-server/apps/booking-calendar.ts
import { z } from 'zod'
export function createBookingCalendarApp() {
  return {
    name: 'booking_calendar',
    description: 'Display a monthly calendar of bookings.',
    resourceUri: 'mcp://app/booking-calendar',
    toolName: 'show_booking_calendar',
    toolDescription: 'Open the calendar for a given month.',
    toolInputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/) },
    annotations: { readOnlyHint: true },
    needsAuth: true,
    getHtml: () => HTML,
    async handleToolCall(args, context) {
      const month = args.month
      const records = await context.dataLayer.list('booking', { month })
      return {
        content: [{ type: 'text', text: `Loaded ${records.length} bookings for ${month}` }],
        _meta: { 'mcp-rune/payload': { records, month } }
      }
    }
  }
}
const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Bookings</title>
<style>body { font-family: system-ui; padding: 1rem; }</style></head>
<body>
  <h1>Bookings</h1>
  <div id="grid"></div>
  <script type="module">
    import { openWindow } from 'https://esm.sh/@modelcontextprotocol/ext-apps@1.7.1'
    const host = await openWindow()
    const payload = host.toolOutput?._meta?.['mcp-rune/payload']
    document.getElementById('grid').textContent =
      'Month: ' + payload.month + ' — ' + payload.records.length + ' bookings'
  </script>
</body></html>`
```

No build step. The string is the iframe HTML; mcp-rune injects theming + formatters via `injectIntoHead` before serving it. Good enough for read-only views, dashboards, and printable artifacts.

The shape stays the same whether you author the HTML by hand or generate it. The `_meta` envelope is your communication channel from server to iframe — anything you put in `'mcp-rune/payload'` (or your own key) is readable inside the iframe via the SDK's `host.toolOutput`.

## Vite-Bundled Custom App

If your app is interactive enough to want JS modules, CSS imports, and bundled dependencies, follow the framework pattern:

1. Create `your-server/apps/booking-calendar-ui/`:
   - `index.html` — page skeleton.
   - `app.js` — UI logic, imports from `@mcp-rune/mcp-rune/apps`.
   - `styles.css` — your styles.
2. Add a `vite.config.js` mirroring `src/mcp/apps/vite.config.js`. Use `viteSingleFile()` so the output is one self-contained `.html`.
3. Build into `your-server/apps/dist/booking-calendar.html`.
4. In your `AppDefinition`, read the file at server startup:

```ts file=src/load-html.ts
import fs from 'node:fs'
import path from 'node:path'

const HTML_PATH = path.resolve(import.meta.dirname, 'dist/booking-calendar.html')
let _cached: string | null = null
function loadHtml() {
  if (!_cached) _cached = fs.readFileSync(HTML_PATH, 'utf-8')
  return _cached
}
```

```js file=src/load-html.js
import fs from 'node:fs'
import path from 'node:path'
const HTML_PATH = path.resolve(import.meta.dirname, 'dist/booking-calendar.html')
let _cached = null
function loadHtml() {
  if (!_cached) _cached = fs.readFileSync(HTML_PATH, 'utf-8')
  return _cached
}
```

Use this when your app:

- Imports the framework's `helpers`, `renderCellValue`, or `getFormatter` (so it inherits theming, kind rendering, and overrides).
- Needs more than ~200 lines of UI code.
- Wants to share components across multiple custom apps in your deployment.

## Reusing the Kind Taxonomy

The whole point of having a shared kind registry is so custom apps don't reinvent rendering. In a Vite-bundled custom app, import the same primitives the framework apps use:

```js file=src/payload.js
// your-server/apps/booking-calendar-ui/app.js
import {
  renderCellValue,
  getFormatter,
  helpers
} from '../../../node_modules/@mcp-rune/mcp-rune/dist/mcp/apps/shared/formatters.js'

const payload = host.toolOutput?._meta?.['mcp-rune/payload']
const tbody = document.querySelector('tbody')

for (const booking of payload.records) {
  const tr = document.createElement('tr')
  for (const col of payload.schema.columns) {
    const td = document.createElement('td')
    td.appendChild(renderCellValue(booking[col.name], col))
    tr.appendChild(td)
  }
  tbody.appendChild(tr)
}
```

```ts file=src/payload.ts
// your-server/apps/booking-calendar-ui/app.js
import {
  renderCellValue,
  getFormatter,
  helpers
} from '../../../node_modules/@mcp-rune/mcp-rune/dist/mcp/apps/shared/formatters.js'

const payload = host.toolOutput?._meta?.['mcp-rune/payload']
const tbody = document.querySelector('tbody')

for (const booking of payload.records) {
  const tr = document.createElement('tr')
  for (const col of payload.schema.columns) {
    const td = document.createElement('td')
    td.appendChild(renderCellValue(booking[col.name], col))
    tr.appendChild(td)
  }
  tbody.appendChild(tr)
}
```

That single `renderCellValue` call picks up:

- Built-in kinds with their `format()` renderers.
- Any deployer-registered overrides via `AppRegistry.formatters` (theming, locale, badges).
- The `--color-accent` etc. CSS variables from `themeOverrides`.

No re-implementation. If you later add a new kind to your server, your custom app renders it without code changes.

For form-style inputs, use `getFormatter(kind, format).toInput / .fromInput / .parse / .serialize` from the same module — these come from `kind-metadata` and round-trip correctly for every kind.

## Wiring Into the Registry

If you use `createDefaultAppRegistry`, pass extra apps in the `apps` array:

```ts file=src/registries/app-registry.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { createBookingCalendarApp } from './apps/booking-calendar.js'

export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookings',
  apps: [createBookingCalendarApp()] // alongside the 6 framework apps
})
```

```js file=src/registries/app-registry.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { createBookingCalendarApp } from './apps/booking-calendar.js'
export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookings',
  apps: [createBookingCalendarApp()] // alongside the 6 framework apps
})
```

If you're hand-wiring `AppRegistry`:

```ts file=src/registry.ts
import { AppRegistry } from '@mcp-rune/mcp-rune/apps'

const registry = new AppRegistry(
  [
    createBookingCalendarApp()
    // …
  ],
  {
    /* registry options */
  }
)

// Or register after construction:
registry.registerApp(createBookingCalendarApp())
```

```js file=src/registry.js
import { AppRegistry } from '@mcp-rune/mcp-rune/apps'
const registry = new AppRegistry(
  [
    createBookingCalendarApp()
    // …
  ],
  {
    /* registry options */
  }
)
// Or register after construction:
registry.registerApp(createBookingCalendarApp())
```

Apps registered after `registerResources` is called won't appear; register them all before the server accepts connections.

## Testing a Custom App

Test the server-side handler with vitest, using a stub `DataLayer`:

```ts file=src/app.ts
import { describe, expect, it } from 'vitest'
import { createBookingCalendarApp } from '../src/apps/booking-calendar'

describe('booking-calendar app', () => {
  it('returns records under mcp-rune/payload in _meta', async () => {
    const app = createBookingCalendarApp()
    const result = await app.handleToolCall!(
      { month: '2026-05' },
      { dataLayer: { list: async () => [{ id: '1', date: '2026-05-12' }] } }
    )
    expect(result._meta?.['mcp-rune/payload']).toMatchObject({
      month: '2026-05',
      records: [{ id: '1', date: '2026-05-12' }]
    })
  })
})
```

```js file=src/app.js
import { describe, expect, it } from 'vitest'
import { createBookingCalendarApp } from '../src/apps/booking-calendar'
describe('booking-calendar app', () => {
  it('returns records under mcp-rune/payload in _meta', async () => {
    const app = createBookingCalendarApp()
    const result = await app.handleToolCall(
      { month: '2026-05' },
      { dataLayer: { list: async () => [{ id: '1', date: '2026-05-12' }] } }
    )
    expect(result._meta?.['mcp-rune/payload']).toMatchObject({
      month: '2026-05',
      records: [{ id: '1', date: '2026-05-12' }]
    })
  })
})
```

Test the iframe rendering with `happy-dom`:

```ts file=src/td.ts
/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import { renderCellValue } from '@mcp-rune/mcp-rune/apps'

describe('booking-calendar iframe', () => {
  it('renders a booking row through the shared formatter', () => {
    const td = renderCellValue('2026-05-12', { kind: 'date' })
    expect(td.textContent).toContain('2026')
  })
})
```

```js file=src/td.js
/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import { renderCellValue } from '@mcp-rune/mcp-rune/apps'
describe('booking-calendar iframe', () => {
  it('renders a booking row through the shared formatter', () => {
    const td = renderCellValue('2026-05-12', { kind: 'date' })
    expect(td.textContent).toContain('2026')
  })
})
```

Integration-test the iframe via `injectIntoHead` to confirm theming and formatter overrides reach your HTML:

```ts file=src/registry.ts
import { AppRegistry } from '@mcp-rune/mcp-rune/apps'

const registry = new AppRegistry([createBookingCalendarApp()], {
  formatters: { date: { display: { locale: 'en-GB' } } }
})
const html = registry.injectIntoHead(loadHtml())
expect(html).toContain('window.__MCP_RUNE_FORMATTERS__')
expect(html).toContain('en-GB')
```

```js file=src/registry.js
import { AppRegistry } from '@mcp-rune/mcp-rune/apps'
const registry = new AppRegistry([createBookingCalendarApp()], {
  formatters: { date: { display: { locale: 'en-GB' } } }
})
const html = registry.injectIntoHead(loadHtml())
expect(html).toContain('window.__MCP_RUNE_FORMATTERS__')
expect(html).toContain('en-GB')
```

---

**Related guides:**

- [MCP Apps Guide](./mcp-apps-guide.md) — user-facing overview of the apps system.
- [MCP Apps Architecture](./mcp-apps-architecture.md) — protocol-level reference for iframe ↔ host communication.
- [Attribute Kinds](./attribute-kinds-guide.md) — the kind taxonomy custom apps inherit.
- [Model Form Customization](./model-form-customization-guide.md) — layout primitives for the generic `model-form` (often enough; you may not need a custom app).
