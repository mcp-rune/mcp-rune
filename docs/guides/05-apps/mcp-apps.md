# MCP apps

This is the first chapter of the Apps section. Apps consume the same three layers Tools do (`DataLayer`, `ModelLayer`, `AnalysisLayer` from [chapter 4](../04-tools/the-three-layers.md)) plus a small bidirectional message protocol that lets a sandboxed iframe call back to the server. Once you understand how the protocol works, the next chapter shows how the framework wires it; the chapter after that covers `BaseAppForm` for when the default synthesized form needs customization.

MCP Apps are interactive HTML user interfaces that render inside MCP clients with UI support (e.g. Claude Desktop, MCP Inspector). They use the `@modelcontextprotocol/ext-apps` extension protocol to communicate bidirectionally with the MCP server.

## Architecture Overview

<!-- illustration: mcp-apps-guide#overview -->

```
┌─ MCP Client ─────────────────────────────────┐
│                                               │
│  ┌─ Sandboxed iframe ──────────────────────┐  │
│  │  MCP App HTML/JS/CSS                    │  │
│  │                                          │  │
│  │  ← ontoolinput (prefill data)           │  │
│  │  ← ontoolresult (schema + defaults)     │  │
│  │  ← onhostcontextchanged (theme)         │  │
│  │                                          │  │
│  │  → callServerTool('create_model', ...)   │  │
│  │  → callServerTool('update_model', ...)   │  │
│  └──────────────────────────────────────────┘  │
│                                               │
└───────────────────────────────────────────────┘
                    ↕ MCP protocol
┌─ MCP Server ─────────────────────────────────┐
│                                               │
│  Tool: new_model_app                          │
│    → handleToolCall(args, { dataLayer })      │
│    → Returns: { schema, defaults, mode }      │
│                                               │
│  Resource: ui://bookshelf/new-model-app       │
│    → Returns: single-file HTML                │
│                                               │
└───────────────────────────────────────────────┘
```

## How MCP Apps Work

### 1. Tool + Resource Registration

Each MCP App consists of two MCP primitives:

- **Tool**: The LLM calls this tool to launch the app. The form tools are model-parameterized — one `new_model_app` tool covers every model (`new_model_app({ model: 'book', mode: 'form' })`), and one `edit_model_app` covers every edit (`edit_model_app({ model: 'book', record_id: 'abc-123' })`). There are no per-model tools.
- **Resource**: The client fetches HTML from this URI (e.g., `ui://bookshelf/new-model-app`, where `bookshelf` is the `namespace` you pass to `createDefaultAppRegistry`)

The tool declares its UI resource via `_meta.ui.resourceUri`, which tells the MCP client to render the HTML in an iframe when the tool is called.

### 2. Protocol Flow

The same HTML app handles both create and update — the mode is determined by the tool result data.

**Create flow:**

```
User: "Create a book"
  ↓
LLM calls new_model_app({ model: 'book', mode: 'form' })
  ↓
MCP Server: handleToolCall() → returns { schema, defaults, mode: 'create', submitMode }
  ↓
App renders empty form with defaults → User fills → create_model
```

**Update flow:**

```
User: "Edit book abc-123"
  ↓
LLM calls edit_model_app({ model: 'book', record_id: 'abc-123' })
  ↓
MCP Server: handleToolCall() → fetches existing record via the DataLayer → returns { schema, defaults, mode: 'update', recordId }
  ↓
App renders pre-filled form → User edits → update_model with the record id
```

Both flows submit directly by default (`submitMode: 'direct'` on the tool result). When a tool-flow extension flips the registry to `'collect'` (the built-in `centerOfControlExtension` does this), the form instead stages its data via `collect_form_data` and the LLM owns the review/confirm/submit handoff.

### 3. Communication

The `@modelcontextprotocol/ext-apps` `App` class provides bidirectional communication:

**Host → App (notifications):**

- `ontoolinput` — Tool arguments (prefill data)
- `ontoolresult` — Tool execution result (schema, defaults)
- `onhostcontextchanged` — Theme, style variables, fonts

**App → Host (tool calls):**

- `callServerTool({ name, arguments })` — Call any registered MCP tool

## Generic Model Form App

Instead of building a custom HTML form for each model, we use a **schema-driven generic form** that renders any model's form dynamically.

### Data Flow

<!-- illustration: mcp-apps-guide#dataflow -->

```
┌─ MCP Server ──────────────────────────────────────────────┐
│                                                            │
│  Book.attributes       → field kinds, validations, enums   │
│  Book.associations     → which fields need options          │
│  BookForm.fields       → which attributes render             │
│  BookForm.fieldsets    → grouping + section titles           │
│  BookPrompt            → getDefaultFormState() only          │
│                                                            │
│  bindAppForm(BookForm, Book)      → BoundAppForm            │
│  generateAppFormSchema(boundForm) → JSON schema (pure)      │
│       │                                                    │
│       │  For association fields only:                      │
│       │  resolveAssociationOptions(fields, dataLayer,      │
│       │    defaults) → select / multiselect options         │
│                                                            │
└────────────────────────────────────────────────────────────┘
              ↓ JSON via ontoolresult
┌─ Generic Form MCP App ────────────────────────────────────┐
│  Receives schema → dynamically renders form               │
│  Gates submit on required fields (client-side)            │
│  Submits via callServerTool('create_model' / 'update_model')│
│  Renders backend validation errors (422) inline           │
└────────────────────────────────────────────────────────────┘
```

The pipeline is one straight line: `bindAppForm(FormClass, ModelClass)` merges the form class with the model's attribute and association metadata into a `BoundAppForm`; `generateAppFormSchema(boundForm)` turns that into pure JSON with no I/O; `resolveAssociationOptions(fields, dataLayer, defaults)` then fills in option lists for association fields through the `DataLayer` — the pipeline is backend-neutral and never assumes a particular API framework.

### Why Schema-Driven?

The MCP server **already has** all metadata needed to render a form:

| What's needed | Where it lives | Example |
| --- | --- | --- |
| Field kinds, labels | `Model.attributes` | `title: { type: 'string', label: 'Title' }` |
| Enum options | `Model.attributes` | `status: { enumValues: ['unread', ...] }` |
| Validations | `Model.attributes` | `rating: { validation: { min: 1, max: 5 } }` |
| Which fields render | `FormClass.fields` | `static fields = ['title', 'author_id', 'status']` |
| Fieldset grouping, titles | `FormClass.fieldsets` | `identity: { title: 'Book Identity', fields: [...] }` |
| Defaults | `Prompt.getDefaultFormState()` (optional) | `{ status: 'unread' }` |
| Associations | `Model.associations` | `belongsTo: { location }` |

The **only** thing fetched from the backend is association option values (the user's locations, tags) — resolved through the `DataLayer` at form-open time. Prompt classes contribute exactly one thing to forms: `getDefaultFormState()`. When no prompt class is supplied, defaults come from the attributes' own `default` values.

### Form Schema Structure

```json
{
  "model": "book",
  "title": "Create Book",
  "fieldsets": [
    {
      "key": "book_identity",
      "title": "Book Identity",
      "required": true,
      "groups": ["book_identity"]
    }
  ],
  "fields": [
    {
      "name": "title",
      "type": "text",
      "label": "Title",
      "group": "book_identity",
      "required": true,
      "placeholder": "e.g. Clean Code"
    },
    {
      "name": "status",
      "type": "select",
      "label": "Status",
      "default": "unread",
      "options": [
        { "value": "unread", "label": "Unread" },
        { "value": "reading", "label": "Reading" }
      ]
    },
    {
      "name": "location_id",
      "type": "select",
      "label": "Location",
      "association": { "endpoint": "locations", "labelField": "name" },
      "options": [
        { "value": 1, "label": "Office Shelf" },
        { "value": 3, "label": "Bedroom" }
      ]
    },
    {
      "name": "tag_ids",
      "type": "multiselect",
      "label": "Tags",
      "association": { "endpoint": "tags", "labelField": "name" },
      "options": [{ "value": 1, "label": "Ruby", "color": "#cc342d" }]
    },
    {
      "name": "formats",
      "type": "checkbox_group",
      "options": [
        { "value": "physical", "label": "Physical" },
        { "value": "ebook", "label": "Ebook" }
      ]
    }
  ]
}
```

### Supported Field Types

Field types are not hardcoded in the schema generator — each attribute's `type` names a **kind**, and the kinds registry owns the kind → input mapping via `resolveInputType(kind, format, opts)` (`src/mcp/models/kinds/registry.ts`). Registering or overriding a kind (through the `kinds` option on the registry) changes this table without touching the form code. See [Attributes and kinds](../02-the-model/attributes-and-kinds.md) for the full taxonomy.

| Kind (attribute `type`) | Schema type | HTML rendered |
| --- | --- | --- |
| `string`, `uuid` | `text` | `<input type="text">` |
| `text`, `json` | `textarea` | `<textarea>` |
| `integer`, `decimal`, `rating` | `number` | `<input type="number">` (min/max from validation) |
| `boolean` | `checkbox` | `<input type="checkbox">` |
| `date` / `datetime` / `time` | `date` / `datetime-local` / `time` | native date/time inputs |
| `email`, `url`, `color` | `email` / `url` / `color` | native inputs |
| `enum` (any kind + `enumValues`) | `select` | `<select>` (searchable when >10 options) |
| `array` with `enumValues` | `checkbox_group` | checkbox group |
| `base64` | `text` | plain text input; list and detail views exclude `format: 'base64'` fields |

Associations override the kind-derived type: a field bound to a `belongsTo` association becomes a `select`, a `hasMany` field becomes a `multiselect` (checkbox list), with options filled by `resolveAssociationOptions`.

## Adding a New Model Form

Adding a form for a new model requires **zero new HTML, zero new tools, and zero rebuilds** — there is exactly one step: add the model class to `createDefaultAppRegistry`. Both `new_model_app` and `edit_model_app` pick it up automatically.

```js file=src/apps/registry.js
// src/apps/registry.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

import { Book } from '../models/book.js'
import { Review } from '../models/review.js'
import { BookForm } from '../forms/book-form.js'
import { BookPrompt } from '../prompts/book-prompt.js'

// One call wires every framework app (pickers, tables, forms, …).
// formClasses and promptClasses are optional refinements per model.
export function buildAppRegistry() {
  return createDefaultAppRegistry({
    modelClasses: { book: Book, review: Review },
    formClasses: { book: BookForm },
    promptClasses: { book: BookPrompt },
    namespace: 'bookshelf'
  })
}
```

```ts file=src/apps/registry.ts
// src/apps/registry.ts
import { createDefaultAppRegistry, type AppRegistry } from '@mcp-rune/mcp-rune/apps'

import { Book } from '../models/book.js'
import { Review } from '../models/review.js'
import { BookForm } from '../forms/book-form.js'
import { BookPrompt } from '../prompts/book-prompt.js'

// One call wires every framework app (pickers, tables, forms, …).
// formClasses and promptClasses are optional refinements per model.
export function buildAppRegistry(): AppRegistry {
  return createDefaultAppRegistry({
    modelClasses: { book: Book, review: Review },
    formClasses: { book: BookForm },
    promptClasses: { book: BookPrompt },
    namespace: 'bookshelf'
  })
}
```

That's the whole workflow. `review` has no form class above, so the registry synthesizes one from `Review.attributes` — every attribute not marked `prompt_visible: false` becomes a field, in declaration order. The two optional dictionaries refine per-model behavior:

- **`formClasses`** — a `BaseAppForm` subclass controls which fields render, fieldset grouping, and which associations must be resolved before the form opens. See the [Model Form Customization Guide](./model-form.md).
- **`promptClasses`** — forms consult a prompt class for exactly one thing, `getDefaultFormState()`. Everything else on the prompt (e.g. `static formStrategy = 'hybrid'`) belongs to the Guided/Quick prompt flows, not to the form app.

### Boot validation is automatic

You don't have to remember a validation call: `createDefaultAppRegistry` runs `validateRegistries` over the models, the resolved form classes (explicit and synthesized), and any prompt classes as part of construction ([ADR 0012](../../architecture/decisions/0012-boot-validation-runs-automatically.md)). The `validate` option sets the policy:

- `'throw'` (default) — error-level issues (an `enum` without `enumValues`, a form field that isn't a model attribute, an unknown kind) raise `SchemaValidationError` at boot with a full report.
- `'warn'` — logs the report and continues; the migration hatch for deployments cleaning up latent declaration errors.
- `'off'` — skips validation.

No rebuild is ever needed. The app HTML bundles ship prebuilt inside the npm package; adding a model only changes the JSON schema the server sends to the same bundle.

## File Structure

<!-- illustration: mcp-apps-guide#tree2 -->

```
src/mcp/apps/
├── new-model-app/              # Create-record form
│   └── ui/                     # Thin shim → shared/model-form/main.js
│       ├── index.html
│       └── app.js
├── edit-model-app/             # Edit-record form (same shim, update mode)
│   └── ui/
├── find-model-app/             # Browseable table — query + filter popover + selection
│   ├── index.ts                # createFindModelApp() factory (server)
│   └── ui/
├── show-model-app/             # Record detail view
│   ├── index.ts
│   └── ui/
├── view-selection-app/         # Inspect + manage the in-session selection store
│   ├── index.ts
│   └── ui/
├── pick-model-app/             # Type-ahead picker (single-model or group)
│   ├── index.ts
│   └── ui/
├── multi-pick-model-app/       # Browse-and-select picker for small/medium sets
│   ├── index.ts
│   └── ui/
├── workflow-panel-app/         # Deployer-supplied workflows as clickable cards
│   ├── index.ts
│   └── ui/
├── lib/                        # Shared server-side code
│   ├── registry.ts             # AppRegistry (+ ThemeOverrides, KindExtension)
│   ├── create-default-registry.ts  # createDefaultAppRegistry()
│   ├── create-model-form-app.ts    # createModelFormApp({ mode }) → new/edit apps
│   ├── base-app-form.ts        # BaseAppForm
│   ├── bind-app-form.ts        # bindAppForm(FormClass, ModelClass) → BoundAppForm
│   ├── app-form-schema.ts      # generateAppFormSchema(boundForm) — pure function
│   ├── app-form-helpers.ts     # resolveAssociationOptions() + defaults helpers
│   ├── app-form-associations.ts # association pre-check before the form opens
│   ├── synthesize-form-class.ts # default form class from model attributes
│   ├── list-schema.ts          # generateListSchema() — list/table schema
│   ├── detail-schema.ts        # generateDetailSchema() — record detail schema
│   ├── selection-store.ts      # SelectionStore — session-scoped Map
│   ├── selection-tools.ts      # createSelectionTools() — per-app selection
│   └── …                       # form-data store/tools, validators, html-loader, helpers
├── shared/                     # Shared client-side JS/CSS for ui/ folders
│   ├── base.css, app-init.js, helpers.js, …
│   ├── kind-renderers.ts       # kind → DOM renderer decoration
│   ├── kind-renderers.runtime.js # applies deployer render hints in the iframe
│   └── model-form/             # Shared form UI consumed by new + edit
│       ├── main.js             # initModelFormApp() — bulk of form code
│       └── styles.css
├── scripts/build-all.mjs       # build:all-apps driver
├── vite.config.js              # BUILD_TARGET-driven single-file HTML build
└── dist/                       # Prebuilt outputs (one HTML per app, shipped in the package)
    ├── new-model-app.html
    ├── edit-model-app.html
    ├── find-model-app.html
    ├── show-model-app.html
    ├── view-selection-app.html
    ├── pick-model-app.html
    ├── multi-pick-model-app.html
    └── workflow-panel-app.html
```

## Key Components

### `generateAppFormSchema(boundForm, options?)` — `src/mcp/apps/lib/app-form-schema.ts`

Pure function that generates a form schema from a `BoundAppForm` — the merged view of a form class and its model class produced by `bindAppForm(FormClass, ModelClass)`. No API calls, no side effects.

**Input:** `BoundAppForm` (+ optional `{ allModelClasses }` for detecting nested associations) **Output:** `{ model, title, fieldsets, fields }`

Maps attribute kinds to form field types via `resolveInputType`, marks association fields, and preserves validation rules, defaults, placeholders, and `visibleWhen` conditions.

### `createModelFormApp({ mode, … })` — `src/mcp/apps/lib/create-model-form-app.ts`

One factory, parameterized by `mode: 'create' | 'update'`, produces both form apps. `createDefaultAppRegistry` calls it twice. The returned `AppDefinition` carries:

- `resourceUri` — MCP resource URI for the HTML (`ui://{namespace}/new-model-app` / `…/edit-model-app`)
- `toolName` — MCP tool name (`new_model_app` / `edit_model_app`)
- `handleToolCall(args, { dataLayer, formSubmitMode })` — binds the form, generates the schema, fetches association options
- `getHtml()` — Returns the prebuilt single-file HTML for that app

**`new_model_app`**: requires `mode: "form"` (calling without it returns guidance to use `get_prompt_guide` first); runs an association pre-check so required associations are resolved via pickers before the form opens; builds defaults from `PromptClass.getDefaultFormState()` (or attribute defaults), merges `prefill` args, and resolves a parent-context banner when the model is nested. **`edit_model_app`**: requires `record_id`; fetches the existing record through the `DataLayer` and uses the record data as defaults.

Both bundles wrap the same `src/mcp/apps/shared/model-form/main.js` client module, so they render identical UI. The runtime mode (`'create'` / `'update'`) is set from the server's tool result, not from the bundle.

### `AppRegistry` — `src/mcp/apps/lib/registry.ts`

Registry that manages app registrations. Key methods:

- `registerTools(mcpServer, { getAccessToken, selectionStore, formDataStore, extraContext })` — Registers tool handlers with per-session context
- `registerResources(mcpServer)` — Registers HTML resources (injecting theme overrides and kind render hints into `<head>` at serve time)
- `registerApp(app)` — Adds one more `AppDefinition` after construction (e.g. a custom app)

Data access is gated: an app with `needsAuth: true` only receives `context.dataLayer` when `getAccessToken`, `apiUrl`, **and** `createApiClient` are all configured. When the gate passes, the registry builds an authenticated API client from the session's access token, wraps it in the configured `DataLayer` factory plus the search-enabled seam, and hands the result to `handleToolCall` — apps never see the raw API client.

### Client-side App — `src/mcp/apps/shared/model-form/main.js`

Generic form renderer (called by both `new-model-app/ui/app.js` and `edit-model-app/ui/app.js`) that:

1. Receives schema via `ontoolresult`
2. Dynamically creates fieldsets and fields based on schema
3. Handles all field types (text, number, select, multiselect, checkbox_group, etc.)
4. Gates the submit button on required fields client-side (no server round-trip to validate)
5. Submits via `callServerTool('create_model')` / `callServerTool('update_model')` — or `callServerTool('collect_form_data')` when the server advertised `submitMode: 'collect'`
6. Renders backend validation errors (422) inline next to the offending fields
7. Applies host theme via the shared `app-init.js` bootstrap (`applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts`)

## Building

**These commands are for framework contributors only.** Deployers never build app bundles: the prebuilt `dist/*.html` files ship inside the npm package, and each app's `getHtml()` reads them at serve time. Adding models, forms, prompts, kinds, or theme overrides requires no build step.

If you are working on the framework itself, the apps are built into single-file HTML bundles using Vite + `vite-plugin-singlefile`:

```bash
# Build every app bundle
npm run build:all-apps

# Build one app (defaults to new-model-app via BUILD_TARGET)
npm run build:apps

# Build a specific app
npm run build:apps:find-model-app
```

`vite.config.js` maps `BUILD_TARGET` to a sibling app directory: every app ships its iframe entry at `<app>/ui/index.html` and bundles to `dist/<app>.html`, so adding a new app is a filesystem-only change. The build inlines all CSS and JavaScript into a single HTML file, which is read by the server lazily and served via the MCP resources protocol.

**Important (contributors):** after modifying any file in `shared/model-form/` (or in a per-app `ui/` folder), rebuild before the changes take effect.

## Theming

Every app ships `src/mcp/apps/shared/base.css` — one tokenized system with two themes. Light is the default; dark mirrors it via a `prefers-color-scheme: dark` media query, and a host can force either by setting `[data-theme]` on the document root:

```css
:root,
[data-theme='light'] {
  --acc: #6b4fe6; /* violet accent */
  --acc-2: #5b3fd6;
  --acc-tint: rgba(124, 92, 255, 0.09);
  --acc-line: rgba(124, 92, 255, 0.3);
  --ink: #16161c; /* text scale: --ink … --ink-4 */
  --surface: #fafafb; /* surfaces: --surface, --surface-2 */
  --line: #e9e9ef; /* borders: --line … --line-3 */
  /* status colors (--mint / --amber / --rose), radii, fonts … */
}
```

Deployers restyle every app through the `themeOverrides` and `headerIcon` options on `createDefaultAppRegistry` (or `AppRegistry` directly) — no build step:

```js file=examples/mcp-apps-theming.js
const appRegistry = createDefaultAppRegistry({
  modelClasses: { book: Book },
  namespace: 'bookshelf',
  // SVG data URI rendered as the h1::before glyph (sugar for --header-icon)
  headerIcon: 'data:image/svg+xml;base64,…',
  themeOverrides: {
    cssVariables: { '--acc': '#0a84ff', '--acc-2': '#0a84ff' },
    css: '.mr-banner { border-radius: 0; }' // appended verbatim
  }
})
```

```ts file=examples/mcp-apps-theming.ts
const appRegistry = createDefaultAppRegistry({
  modelClasses: { book: Book },
  namespace: 'bookshelf',
  // SVG data URI rendered as the h1::before glyph (sugar for --header-icon)
  headerIcon: 'data:image/svg+xml;base64,…',
  themeOverrides: {
    cssVariables: { '--acc': '#0a84ff', '--acc-2': '#0a84ff' },
    css: '.mr-banner { border-radius: 0; }' // appended verbatim
  }
})
```

The registry injects these as a `<style>` block (a `:root { … }` override plus the raw CSS) before `</head>` when serving each app's HTML resource. On top of that, apps also honor host-pushed styling at runtime via `onhostcontextchanged` (`applyDocumentTheme`, `applyHostStyleVariables`).

## Integration with Prompts

App availability derives from **form classes**, not from any prompt-side registration. A model is offered by `new_model_app` / `edit_model_app` when it resolves a form class — an explicit `formClasses` entry, or the synthesized default when the model has renderable attributes. There is no link property to maintain on the prompt side.

When a user asks to create a model, the `get_prompt_guide` tool checks which models have forms and instructs the LLM to offer three options:

1. **Interactive Form** → the LLM calls `new_model_app(model: "book", mode: "form")` instead of the guide
2. **Guided** → `get_prompt_guide` with `mode: 'guided'`, step-by-step LLM guidance
3. **Quick** → `get_prompt_guide` with `mode: 'quick'`, infer from context and ask only for essentials

Models without a form class get only the Guided and Quick options.

## Dependencies

The apps stack rides on `@modelcontextprotocol/ext-apps` (the `App` class and server registration helpers), `@modelcontextprotocol/sdk`, and `zod` for tool input schemas; framework contributors building bundles additionally use `vite` + `vite-plugin-singlefile`. Version ranges live in [`package.json`](../../../package.json) — this guide deliberately doesn't duplicate them.

## Building a Custom (Hardcoded) MCP App

The generic schema-driven approach handles most model forms. However, if you need a fully custom UI — unique layout, specialized interactions, non-CRUD workflows — you can build a hardcoded MCP App from scratch. Below is a compact reference; the full treatment (app categories, the single-file path, the Vite-bundled path, reusing the kind taxonomy) lives in [Writing a Custom MCP App](../10-extensions/custom-app.md).

The example is a bookshelf review composer: a hand-built form that posts a review for a book.

### Server-Side: App Definition

A custom app is a plain object satisfying the `AppDefinition` shape — `handleToolCall` plus `getHtml`. No schema generation — you control everything.

```js file=src/apps/custom-example.js
// src/apps/custom-example.js
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'

const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
let _cachedHtml = null

function getHtml() {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf-8')
  }
  return _cachedHtml
}

export function createCustomApp() {
  return {
    resourceUri: 'ui://bookshelf/custom-tool',
    toolName: 'custom_tool',
    name: 'Review Composer',
    description: 'A fully custom interactive UI for composing book reviews',
    toolDescription: 'Show a custom review-composer form.',
    needsAuth: false, // set true if handleToolCall needs context.dataLayer

    toolInputSchema: {
      title: z.string().describe('Pre-fill the review title').optional()
    },

    async handleToolCall(args = {}) {
      // Return whatever JSON your client-side app expects
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              model: 'review',
              defaults: { title: args.title || '' },
              statusOptions: ['draft', 'published']
            })
          }
        ]
      }
    },

    getHtml
  }
}
```

```ts file=src/apps/custom-example.ts
// src/apps/custom-example.ts
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'

import type { AppDefinition } from '@mcp-rune/mcp-rune/apps'

const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
let _cachedHtml: string | null = null

function getHtml(): string {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf-8')
  }
  return _cachedHtml
}

export function createCustomApp(): AppDefinition {
  return {
    resourceUri: 'ui://bookshelf/custom-tool',
    toolName: 'custom_tool',
    name: 'Review Composer',
    description: 'A fully custom interactive UI for composing book reviews',
    toolDescription: 'Show a custom review-composer form.',
    needsAuth: false, // set true if handleToolCall needs context.dataLayer

    toolInputSchema: {
      title: z.string().describe('Pre-fill the review title').optional()
    },

    async handleToolCall(args = {}) {
      // Return whatever JSON your client-side app expects
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              model: 'review',
              defaults: { title: args.title || '' },
              statusOptions: ['draft', 'published']
            })
          }
        ]
      }
    },

    getHtml
  }
}
```

### Client-Side: Hardcoded HTML + JS

The client uses `@modelcontextprotocol/ext-apps` `App` class. Unlike the generic renderer, you write the HTML form by hand and wire up fields directly.

```js file=src/apps/custom-ui-app.js
// src/apps/custom-ui/app.js
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts
} from '@modelcontextprotocol/ext-apps'

const app = new App({ name: 'Review Composer', version: '1.0.0' })

// Receive tool result (initial data from handleToolCall)
app.ontoolresult = (result) => {
  const text = result?.content?.find((c) => c.type === 'text')?.text
  if (!text) return
  const data = JSON.parse(text)
  prefillForm(data.defaults)
}

// Receive tool input (LLM pre-fill arguments)
app.ontoolinput = (params) => {
  if (params?.arguments) prefillForm(params.arguments)
}

// Theme support
app.onhostcontextchanged = (params) => {
  if (params?.theme) applyDocumentTheme(params.theme)
  if (params?.styles?.variables) applyHostStyleVariables(params.styles.variables)
  if (params?.styles?.css?.fonts) applyHostFonts(params.styles.css.fonts)
}

await app.connect()

// Apply initial theme
const ctx = app.getHostContext()
if (ctx?.theme) applyDocumentTheme(ctx.theme)
if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables)

// --- Form Logic (hardcoded to your specific fields) ---

function prefillForm(values) {
  for (const [key, val] of Object.entries(values)) {
    if (val == null || val === '') continue
    const input = document.getElementById(key)
    if (input) input.value = val
  }
}

function collectFormData() {
  const data = {}
  for (const id of ['title', 'status', 'description']) {
    const el = document.getElementById(id)
    if (!el) continue
    const val = el.value.trim()
    if (val) data[id] = val
  }
  return data
}

// Submit via MCP tool. There is no separate validation round-trip:
// check required fields client-side, then let the backend validate on
// create — a 422 comes back on the tool result for inline display.
document.getElementById('btn-submit').addEventListener('click', async () => {
  const fields = collectFormData()
  if (!fields.title) {
    // Mark the title field as required inline...
    return
  }
  const result = await app.callServerTool({
    name: 'create_model',
    arguments: { model: 'review', attributes: fields }
  })
  if (result?.isError) {
    // Parse the validation payload and render per-field errors inline...
    return
  }
  // Show the success state...
})
```

```ts file=src/apps/custom-ui-app.ts
// src/apps/custom-ui/app.ts
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts
} from '@modelcontextprotocol/ext-apps'

const app = new App({ name: 'Review Composer', version: '1.0.0' })

// Receive tool result (initial data from handleToolCall)
app.ontoolresult = (result) => {
  const text = result?.content?.find((c) => c.type === 'text')?.text
  if (!text) return
  const data = JSON.parse(text)
  prefillForm(data.defaults)
}

// Receive tool input (LLM pre-fill arguments)
app.ontoolinput = (params) => {
  if (params?.arguments) prefillForm(params.arguments)
}

// Theme support
app.onhostcontextchanged = (params) => {
  if (params?.theme) applyDocumentTheme(params.theme)
  if (params?.styles?.variables) applyHostStyleVariables(params.styles.variables)
  if (params?.styles?.css?.fonts) applyHostFonts(params.styles.css.fonts)
}

await app.connect()

// Apply initial theme
const ctx = app.getHostContext()
if (ctx?.theme) applyDocumentTheme(ctx.theme)
if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables)

// --- Form Logic (hardcoded to your specific fields) ---

function prefillForm(values) {
  for (const [key, val] of Object.entries(values)) {
    if (val == null || val === '') continue
    const input = document.getElementById(key)
    if (input) input.value = val
  }
}

function collectFormData() {
  const data = {}
  for (const id of ['title', 'status', 'description']) {
    const el = document.getElementById(id)
    if (!el) continue
    const val = el.value.trim()
    if (val) data[id] = val
  }
  return data
}

// Submit via MCP tool. There is no separate validation round-trip:
// check required fields client-side, then let the backend validate on
// create — a 422 comes back on the tool result for inline display.
document.getElementById('btn-submit').addEventListener('click', async () => {
  const fields = collectFormData()
  if (!fields.title) {
    // Mark the title field as required inline...
    return
  }
  const result = await app.callServerTool({
    name: 'create_model',
    arguments: { model: 'review', attributes: fields }
  })
  if (result?.isError) {
    // Parse the validation payload and render per-field errors inline...
    return
  }
  // Show the success state...
})
```

### When to Use Custom vs Generic

| Scenario                                    | Approach                                 |
| ------------------------------------------- | ---------------------------------------- |
| Standard CRUD model form                    | Generic schema-driven (zero new HTML)    |
| Unique layout or multi-step wizard          | Custom hardcoded app                     |
| Non-CRUD workflow (e.g., import, dashboard) | Custom hardcoded app                     |
| Conditional fields or complex interactions  | Custom hardcoded app                     |
| Rapid prototyping of a new model form       | Generic first, customize later if needed |

### Registration

Custom apps join the same registry as the framework apps — build the default registry, then add yours with `registerApp`:

```js file=src/apps/custom-app.js
// src/apps/registry.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

import { Book } from '../models/book.js'
import { Review } from '../models/review.js'
import { createCustomApp } from './custom-example.js'

export function buildAppRegistry() {
  const registry = createDefaultAppRegistry({
    modelClasses: { book: Book, review: Review },
    namespace: 'bookshelf'
  })
  registry.registerApp(createCustomApp())
  return registry
}
```

```ts file=src/apps/custom-app.ts
// src/apps/registry.ts
import { createDefaultAppRegistry, type AppRegistry } from '@mcp-rune/mcp-rune/apps'

import { Book } from '../models/book.js'
import { Review } from '../models/review.js'
import { createCustomApp } from './custom-example.js'

export function buildAppRegistry(): AppRegistry {
  const registry = createDefaultAppRegistry({
    modelClasses: { book: Book, review: Review },
    namespace: 'bookshelf'
  })
  registry.registerApp(createCustomApp())
  return registry
}
```

## Column Selection (List View & Search View)

Table apps (`find-model-app`, `view-selection-app`) support **LLM-driven column selection** — the tool description lists all available columns per model, and the LLM chooses which columns are relevant to display based on the user's request. This prevents horizontal scroll when models have many attributes.

### How It Works

```
LLM reads tool description → "Available columns — book: title, author, status, rating, ..."
                           → "Choose columns relevant to what the user wants to see"
    ↓
LLM calls tool with columns parameter → { model: 'book', columns: ['title', 'author', 'status'] }
    ↓
Server: applyColumnSelection(fullSchema, ['title', 'author', 'status'], BookModel)
    ↓
Client renders 3-column table (no horizontal scroll)
```

### Column Resolution Order

`applyColumnSelection()` (`src/mcp/apps/lib/list-schema.ts`) resolves columns in this order:

1. **Explicit columns** — LLM passes `columns: ['title', 'status']` → show only those
2. **Model defaults** — LLM omits `columns`, model has `static defaultColumns` → use those
3. **Full schema** — No columns specified, no defaults → show all inferred columns

### Adding Default Columns to a Model

Define `static defaultColumns` on the model class to control which columns appear when the LLM omits the `columns` parameter:

```js file=src/activity.js
export class Activity extends BaseModel {
  static defaultColumns = ['title', 'description', 'started_at', 'duration_minutes']
  // ...
}
```

```ts file=src/activity.ts
export class Activity extends BaseModel {
  static defaultColumns = ['title', 'description', 'started_at', 'duration_minutes']
  // ...
}
```

Without `defaultColumns`, all inferred columns are shown (which may cause horizontal scroll for models with many attributes).

### Infrastructure

All column selection logic lives in `src/mcp/apps/lib/list-schema.ts`:

| Function | Purpose |
| --- | --- |
| `getAvailableColumnNames(ModelClass)` | Returns column name array for tool description inventory |
| `applyColumnSelection(schema, columns, ModelClass)` | Filters schema columns to requested subset with fallback |
| `generateListSchema(ModelClass)` | Generates full schema with all inferred columns |
| `inferColumns(ModelClass)` | Determines which attributes become table columns |

`inferColumns` automatically excludes: `id`, fields with `prompt_visible: false`, long text fields (except `description`), and file uploads (`format: 'base64'`).

## Selection Store & Selection Tools

> **Projection-layer rule.** App handlers consume only the `DataLayer` interface. The selection store and its tools are exposed through `context.selectionStore` and the shared model-visible tools below — no app reaches for `SearchService` or any other adapter directly. See [The Projection-Layer Rule](../06-the-three-layers-up-close/data-layer.md#the-projection-layer-rule).

MCP Apps that display record lists (`find_model_app`, `pick_model_app`, `multi_pick_model_app`) support **server-side selection** — users check records in the UI, the selection is stored on the MCP server, and the LLM can retrieve and manage it for follow-up operations. `view_selection_app` is the dedicated visual surface for inspecting, pruning, and clearing the store.

### Architecture

<!-- illustration: mcp-apps-guide#selection -->

```
┌─ MCP App (iframe) ─────────────────────────────────────┐
│                                                         │
│  User checks rows → [✓] Activity 1  [✓] Activity 3    │
│                                                         │
│  Click "Send (Replace)" or "Send (Add)" →               │
│    callServerTool('select_find_records', {              │
│      model: 'activity', mode: 'ids',                   │
│      ids: ['1', '3'], total: 2,                        │
│      strategy: 'replace' // or 'add'                    │
│    })                                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
          ↕ MCP protocol
┌─ MCP Server ────────────────────────────────────────────┐
│                                                         │
│  SelectionStore (session-scoped Map)                    │
│    activity → { mode: 'ids', ids: ['1','3'], total: 2 }│
│    contact  → { mode: 'filter', filters: {city:'NY'} } │
│                                                         │
│  Per-app tools (visibility: ['app']):                   │
│    select_find_records, select_view_records,            │
│    select_autocomplete_records, select_multi_records    │
│                                                         │
│  Shared tools (visibility: ['model']):                  │
│    get_selection           — read                       │
│    add_to_selection        — union IDs                  │
│    remove_from_selection   — drop IDs                   │
│    clear_selection         — empty one or all           │
│    materialize_selection   — filter-mode → ids-mode     │
│                                                         │
└─────────────────────────────────────────────────────────┘
          ↕
┌─ LLM ──────────────────────────────────────────────────┐
│                                                         │
│  Calls get_selection({ model: 'activity' })            │
│  → { ids: ['1','3'], total: 2 }                        │
│  → Uses IDs for bulk_action_models, update, export, …  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Selection Flow

<!-- illustration: mcp-apps-guide#selflow -->

```
User selects records in UI
        │
        ▼
App calls select_*_records tool ──── visibility: ['app'] only
        │                            (LLM cannot call this)
        ▼
SelectionStore.set({ model, mode, ids, filters, total, strategy })
        │
        ▼
App sends status message: "Selection saved: 2 Activities" (replace)
                       or "Added 2 — total is now 5"      (add)
        │
        ▼
LLM calls get_selection / add_to_selection / remove_from_selection
        / clear_selection / materialize_selection
        ▼
Returns stored selection → LLM uses for follow-up operations
```

### Selection Modes

| Mode     | When                               | Data                          |
| -------- | ---------------------------------- | ----------------------------- |
| `ids`    | User checks specific rows          | `ids: ['1', '3', '7']`        |
| `filter` | User clicks "Select all N results" | `filters: { status: 'open' }` |

### Selection strategy: replace vs add

The `select_*_records` schema includes an optional `strategy: 'replace' | 'add'` field that controls how a submission combines with any existing selection for the same model:

- `strategy: 'replace'` (default) — overwrite the model's prior selection. Matches the find-model-app "Send (Replace)" button.
- `strategy: 'add'` — union the submitted IDs with the existing ids-mode selection. Rejected (with `SelectionMergeError`) when either side is filter-mode, because a predicate plus an explicit ID list can't be merged losslessly. Matches the find-model-app "Send (Add)" button.

The find-model-app UI hides the "Send (Add)" button when the selection escalates to filter-mode (via "Select all N results"), so the LLM never has to reason about an impossible merge.

### Managing selections from the model side

Five model-visible tools let the LLM read and edit the selection store directly. Each is shared across every app (registered once via `createSharedSelectionTools()` and deduplicated by `AppRegistry`).

| Tool | Schema | Behavior |
| --- | --- | --- |
| `get_selection` | `{ model? }` | Reads the stored selection for one model, or every model when `model` is omitted. |
| `add_to_selection` | `{ model, ids: string[] }` | Unions IDs with the existing ids-mode selection. Errors when either side is filter-mode. |
| `remove_from_selection` | `{ model, ids: string[] }` | Drops IDs from the ids-mode selection. No-op for filter-mode. Removing every remaining ID clears the entry. |
| `clear_selection` | `{ model? }` | Clears one model when `model` is supplied, every model when omitted. |
| `materialize_selection` | `{ model }` | For a filter-mode entry, calls `dataLayer.searchNormalized` with the stored filters and rewrites the entry as ids-mode. |

`materialize_selection` is the bridge between the two modes — once filter-mode is materialized, individual rows can be pruned with `remove_from_selection`. The implementation lives in `selection-tools.ts` and consumes only `dataLayer` and `selectionStore` from context; it never imports `SearchService`.

### Key Files

| File | Purpose |
| --- | --- |
| `src/mcp/apps/lib/selection-store.ts` | `SelectionStore` class — session-scoped Map with `set({ strategy })`, `removeIds` |
| `src/mcp/apps/lib/selection-tools.ts` | `createSelectionTools()` + `createSharedSelectionTools()` factories |
| `src/mcp/apps/find-model-app/index.ts` | Calls `createSelectionTools('select_find_records', …)` |
| `src/mcp/apps/view-selection-app/index.ts` | Calls `createSelectionTools('select_view_records', …)` + reads selection store |
| `src/mcp/apps/pick-model-app/index.ts` | Calls `createSelectionTools('select_autocomplete_records', …)` |
| `src/mcp/apps/multi-pick-model-app/index.ts` | Calls `createSelectionTools('select_multi_records', …)` |

### Tool Visibility

Each app gets its **own** `select_*_records` tool bound to its `resourceUri`, because the ext-apps host enforces that app-initiated tool calls can only target tools registered with the same `resourceUri`. The five model-visible tools are shared (deduplicated by `AppRegistry`).

| Tool                          | Visibility  | Who calls it                   |
| ----------------------------- | ----------- | ------------------------------ |
| `select_find_records`         | `['app']`   | `find_model_app` UI only       |
| `select_view_records`         | `['app']`   | `view_selection_app` UI only   |
| `select_autocomplete_records` | `['app']`   | `pick_model_app` UI only       |
| `select_multi_records`        | `['app']`   | `multi_pick_model_app` UI only |
| `get_selection`               | `['model']` | LLM                            |
| `add_to_selection`            | `['model']` | LLM                            |
| `remove_from_selection`       | `['model']` | LLM                            |
| `clear_selection`             | `['model']` | LLM                            |
| `materialize_selection`       | `['model']` | LLM                            |

## Design Decisions

### MCP Server as Source of Truth

The MCP server owns all form metadata — field kinds, validations, grouping, labels. The backend behind the `DataLayer` is only consulted to:

1. Fetch association options (locations, tags) at form-open time via `resolveAssociationOptions`
2. Validate submissions — `create_model` / `update_model` surface the backend's validation errors, which the form renders inline
3. Persist records (`create_model` → a `POST` to the model's endpoint through the `DataLayer`'s convention)

This keeps the MCP server decoupled from the backend's internal structure — the same form pipeline runs against a JSON:API server, a HAL server, or an in-memory adapter.

### Single Generic Renderer

One HTML/JS/CSS app handles all model forms. Adding a new model requires zero new UI code — just a registry entry. This eliminates the maintenance burden of per-model hardcoded forms.

### Association Resolution at Form-Open Time

Association options (e.g., user's locations) are fetched when the form opens, not at schema generation time. This ensures:

- Options are always fresh (no caching issues)
- User-scoped data (only the current user's locations appear)
- Graceful degradation (if API call fails, field renders as empty select)

## Related Guides

- **[Model Form Customization Guide](./model-form.md)** — Horizontal layout, field group layouts (`row`, future types), responsive behavior, and the rendering pipeline from prompt config to CSS
