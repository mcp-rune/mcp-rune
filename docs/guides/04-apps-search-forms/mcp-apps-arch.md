# MCP Apps Architecture Guide

A deep reference for the interactive UI system built on the `@modelcontextprotocol/ext-apps` extension protocol.

---

## 1. What Are MCP Apps?

MCP Apps are sandboxed HTML applications rendered inside MCP clients (Claude Desktop, COC, MCP Inspector). They provide visual, interactive interfaces — forms, tables, detail cards, search views — that communicate bidirectionally with the MCP server over the MCP protocol.

Unlike traditional web apps, MCP Apps have no server of their own. They are **single-file HTML bundles** served as MCP resources and controlled entirely by MCP tool calls.

### Core Primitives

Every MCP App is composed of two MCP primitives:

| Primitive    | Purpose                           | Example                       |
| ------------ | --------------------------------- | ----------------------------- |
| **Tool**     | LLM calls this to launch/interact | `new_model_app`               |
| **Resource** | Client fetches HTML from this URI | `ui://engineer/new-model-app` |

The tool declares its UI resource via `_meta.ui.resourceUri`. When the LLM calls the tool, the MCP client:

1. Fetches the HTML resource
2. Renders it in a sandboxed iframe
3. Delivers the tool result to the app via `ontoolresult`

---

## 2. System Architecture

### High-Level Flow

<!-- illustration: mcp-apps-architecture#layered -->

```
┌─ MCP Client (Claude Desktop / COC) ─────────────────┐
│                                                       │
│  ┌─ Sandboxed iframe ────────────────────────────┐   │
│  │  MCP App HTML/JS/CSS (single-file bundle)     │   │
│  │                                                │   │
│  │  Inbound notifications:                        │   │
│  │    ← ontoolinput  (LLM arguments)             │   │
│  │    ← ontoolresult (server data: schema + records)│ │
│  │    ← onhostcontextchanged (theme, fonts)      │   │
│  │                                                │   │
│  │  Outbound tool calls:                          │   │
│  │    → callServerTool('validate_form', {...})    │   │
│  │    → callServerTool('create_model', {...})     │   │
│  │    → callServerTool('find_model_app', {...})   │   │
│  └────────────────────────────────────────────────┘   │
│                                                       │
└───────────────────────────────────────────────────────┘
                      ↕ MCP protocol
┌─ MCP Server ─────────────────────────────────────────┐
│                                                       │
│  AppRegistry                                          │
│    ├── registerTools(mcpServer, { getAccessToken })   │
│    └── registerResources(mcpServer)                   │
│                                                       │
│  App Definitions (tool + resource pairs):             │
│    ├── new_model_app       → ui://…/new-model-app      │
│    ├── edit_model_app      → ui://…/edit-model-app     │
│    ├── find_model_app      → ui://…/find-model-app     │
│    ├── show_model_app      → ui://…/show-model-app     │
│    ├── pick_model_app      → ui://…/pick-model-app     │
│    ├── multi_pick_model_app→ ui://…/multi-pick-model-app│
│    └── view_selection_app  → ui://…/view-selection-app │
│                                                       │
│  Schema Generators (pure functions, no API calls):    │
│    ├── generateFormSchema(Model, Prompt)              │
│    ├── generateListSchema(Model)                      │
│    └── generateDetailSchema(Model, Prompt?)           │
│                                                       │
└───────────────────────────────────────────────────────┘
                      ↕ HTTP (Bearer token)
┌─ Rails API ──────────────────────────────────────────┐
│  Association options, record CRUD, search endpoints   │
└───────────────────────────────────────────────────────┘
```

### Communication Protocol

The `App` class from `@modelcontextprotocol/ext-apps` provides the communication layer:

**Host → App (notifications):**

| Event                  | When                      | Payload                   |
| ---------------------- | ------------------------- | ------------------------- |
| `ontoolinput`          | LLM provides prefill data | `{ arguments: { ... } }`  |
| `ontoolresult`         | Tool handler returns data | `{ content: [{ text }] }` |
| `onhostcontextchanged` | Theme/fonts change        | `{ theme, styles, ... }`  |

**App → Host (tool calls):**

| Method                                | Purpose                         |
| ------------------------------------- | ------------------------------- |
| `callServerTool({ name, arguments })` | Call any registered MCP tool    |
| `getHostContext()`                    | Get current theme/style context |

---

## 3. Default Apps

### App Catalog

| App                | Tool Name              | Resource URI                         | Auth | Purpose                                                    |
| ------------------ | ---------------------- | ------------------------------------ | ---- | ---------------------------------------------------------- |
| New Model App      | `new_model_app`        | `ui://engineer/new-model-app`        | Yes  | Interactive form to create records                         |
| Edit Model App     | `edit_model_app`       | `ui://engineer/edit-model-app`       | Yes  | Interactive form to edit records                           |
| Find Model App     | `find_model_app`       | `ui://engineer/find-model-app`       | Yes  | Browseable table with optional text query + filter popover |
| Show Model App     | `show_model_app`       | `ui://engineer/show-model-app`       | Yes  | Read-only detail cards                                     |
| Pick Model App     | `pick_model_app`       | `ui://engineer/pick-model-app`       | Yes  | Type-ahead picker (single-model or cross-model group)      |
| Multi-Pick App     | `multi_pick_model_app` | `ui://engineer/multi-pick-model-app` | Yes  | Browse-and-select picker for small/medium model sets       |
| View Selection App | `view_selection_app`   | `ui://engineer/view-selection-app`   | Yes  | Inspect and manage the in-session selection store          |

Note: `new_model_app` and `edit_model_app` each build their own bundle, but both wrap the same shared client module at `src/mcp/apps/shared/model-form/main.js` — the rendered DOM is identical, and the mode (`'create'` vs `'update'`) is set from the server's tool result.

> **Projection-layer rule.** App handlers consume only the `DataLayer` interface — `context.dataLayer` is the only data-access seam exposed. The handler signature never receives `searchClient`, `apiClient`, or any concrete adapter. See [The Projection-Layer Rule](../08-adapters/data-layer.md#the-projection-layer-rule) for the full contract.

### App Data Flows

#### Create Form

```
User: "Create a book"
  ↓
LLM calls new_model_app({ model: 'book' })
  ↓
Server:
  1. generateFormSchema(Book, BookPrompt) → { fieldsets, fields }
  2. resolveAssociationOptions(fields, apiClient) → fetch locations, tags
  3. PromptClass.getDefaultFormState() → { status: 'unread', ... }
  ↓
Returns: { schema, defaults, mode: 'create' }
  ↓
App renders dynamic form → User fills → callServerTool('create_model')
```

#### Update Form

```
User: "Edit book abc-123"
  ↓
LLM calls edit_model_app({ model: 'book', record_id: 'abc-123' })
  ↓
Server:
  1. generateFormSchema(Book, BookPrompt) → { fieldsets, fields }
  2. resolveAssociationOptions(fields, apiClient) → fetch locations, tags
  3. apiClient.get('books/abc-123') → existing record as defaults
  ↓
Returns: { schema, defaults, mode: 'update', recordId: 'abc-123' }
  ↓
App renders pre-filled form → User edits → callServerTool('update_model')
```

#### Find Records

```
User: "Show me all unread books with rating ≥ 4"
  ↓
LLM calls find_model_app({ model: 'book', filters: { status: 'unread', rating: { from: 4 } } })
  ↓
Server (handler):
  1. generateListSchema(Book) → { columns, searchFields }
  2. dataLayer.searchNormalized('book', undefined, filters, { page: 1, perPage: 20 })
     ← single call; the SearchEnabledDataLayer wrapper routes to a search
       endpoint, a list endpoint, or a nested-resource path based on the
       model's `extensions.search` config — the handler doesn't care
  3. getSearchConfig(Book)?.filters → filterDefinitions (drives the popover)
  ↓
Returns: { schema, records, pagination, activeFilters, filterDefinitions }
  ↓
App renders table + Filters button → User edits filters in popover →
   callServerTool('find_model_app', { filters: <new> })
                                  → Paginate → callServerTool('find_model_app', { page })
                                  → Row click → callServerTool('edit_model_app')
                                  → Send (Replace|Add) → callServerTool('select_find_records')
```

#### Show Model App

```
User: "Show book abc-123"
  ↓
LLM calls show_model_app({ model: 'book', ids: ['abc-123'] })
  ↓
Server:
  1. generateDetailSchema(Book, BookPrompt?) → { fields, fieldsets? }
  2. apiClient.get('books/abc-123') → record
  ↓
Returns: { schema, records }
  ↓
App renders read-only detail card with sections, badges, stars
```

#### Inspect Selection

```
User: "What do I have selected for titles?"
  ↓
LLM calls view_selection_app({ model: 'title' })
  ↓
Server (handler):
  1. selectionStore.get('title') → { mode: 'ids', ids: [...], total: N }
  2. dataLayer.searchNormalized('title', undefined, { id: ids }, …) → records
  ↓
Returns: { view: 'ids', schema, records, ids, total }
  ↓
App renders table with per-row × → User clicks ×:
  → callServerTool('remove_from_selection', { model: 'title', ids: [<id>] })
  → callServerTool('view_selection_app', { model: 'title' })   // refresh
```

For filter-mode selections (built via the "Select all N results" escalation in `find_model_app`), the app renders the filter chips + a "Materialize as IDs" button that calls `materialize_selection`.

---

## 4. Schema Generation Layer

Schema generators are **pure functions** — no API calls, no side effects. They transform model/prompt configuration into JSON schemas that the client-side app renders dynamically.

### Schema Generators

| Generator                | Input                     | Output                                    | Used By                            |
| ------------------------ | ------------------------- | ----------------------------------------- | ---------------------------------- |
| `generateFormSchema()`   | ModelClass + PromptClass  | `{ model, title, fieldsets, fields }`     | New/Edit Model App                 |
| `generateListSchema()`   | ModelClass                | `{ model, title, columns, searchFields }` | Find Model App, View Selection App |
| `generateDetailSchema()` | ModelClass + PromptClass? | `{ model, title, fields, fieldsets? }`    | Show Model App                     |

### Single Source of Truth

The schema generators read from two sources:

| What                | Source                         | Example                                         |
| ------------------- | ------------------------------ | ----------------------------------------------- |
| Field types, labels | `Model.attributes`             | `title: { type: 'string', label: 'Title' }`     |
| Enum options        | `Model.attributes`             | `status: { enumValues: ['unread', 'reading'] }` |
| Validations         | `Model.attributes`             | `rating: { validation: { min: 1, max: 5 } }`    |
| Field grouping      | `Prompt.fieldGroups`           | `identity: { fields: ['title', 'author'] }`     |
| Section layout      | `Prompt.sections`              | `identity: { title: 'Book Identity' }`          |
| Defaults            | `Prompt.getDefaultFormState()` | `{ status: 'unread', formats: [] }`             |
| Associations        | `Model.associations`           | `belongsTo: { location: { ... } }`              |
| Search filters      | `Model.filters`                | `{ status: { type: 'enum', ... } }`             |

The Rails API is only used for:

1. **Association options** — fetched at form-open time with the user's token
2. **Record data** — fetched for update forms and detail views
3. **CRUD operations** — create, update, delete via tool calls
4. **Search queries** — POST to `{endpoint}/search` with filters

### Form Field Type Mapping

`generateFormSchema()` maps model attribute types to HTML form field types:

| Model Attribute                | Form Field Type  | HTML Rendered               |
| ------------------------------ | ---------------- | --------------------------- |
| `type: 'string'`               | `text`           | `<input type="text">`       |
| `type: 'text'`                 | `textarea`       | `<textarea>`                |
| `type: 'integer'` / `'number'` | `number`         | `<input type="number">`     |
| `type: 'boolean'`              | `checkbox`       | `<input type="checkbox">`   |
| `type: 'date'`                 | `date`           | `<input type="date">`       |
| `type: 'enum'`                 | `select`         | `<select>`                  |
| `format: 'URL'`                | `url`            | `<input type="url">`        |
| `format: 'base64'`             | `file`           | Skipped in generic form     |
| `type: 'array'` + `enumValues` | `checkbox_group` | Checkbox list               |
| `type: 'array'` (no enum)      | `multiselect`    | Checkbox list (association) |
| Field ending in `_id`          | `select`         | `<select>` (belongsTo)      |

### Association Resolution

Association fields (belongsTo selects, hasMany multiselects) are detected by:

1. **`_id` suffix** → looks up `Model.associations.belongsTo[fieldWithoutId]`
2. **`_ids` suffix** → looks up `Model.associations.hasMany[fieldWithoutIds + 's']`

The schema generator marks these fields with `association: { endpoint, labelField }`. The app's `handleToolCall` fetches options from the API separately:

```js file=examples/mcp-apps-architecture-01.js
// In handleToolCall (server-side):
await resolveAssociationOptions(schema.fields, apiClient)

// Fetches: GET /locations → [{ id: 1, name: 'Office' }, ...]
// Produces: field.options = [{ value: 1, label: 'Office' }, ...]
```

```ts file=examples/mcp-apps-architecture-01.ts
// In handleToolCall (server-side):
await resolveAssociationOptions(schema.fields, apiClient)

// Fetches: GET /locations → [{ id: 1, name: 'Office' }, ...]
// Produces: field.options = [{ value: 1, label: 'Office' }, ...]
```

---

## 5. AppRegistry

The `AppRegistry` class manages app registrations on the MCP server. It bridges app definitions with the MCP protocol.

### Registration Flow

```
createAppRegistry({ apiUrl })
  ↓
Creates app definitions (factories return plain objects)
  ↓
new AppRegistry(apps, { apiUrl })
  ↓
registry.registerTools(mcpServer, { getAccessToken })
  → For each app: registerAppTool(mcpServer, toolName, metadata, handler)
  → handler wraps handleToolCall with auth context
  ↓
registry.registerResources(mcpServer)
  → For each unique resourceUri: registerAppResource(mcpServer, ...)
  → Resource callback returns cached HTML via getHtml()
```

### Authentication Integration

Apps declaring `needsAuth: true` receive an authenticated API client:

```js file=src/token.js
// AppRegistry.registerTools():
if (app.needsAuth && getAccessToken && this._apiUrl) {
  const token = await getAccessToken()
  context.apiClient = createApiClient(token, { apiUrl: this._apiUrl })
}
return app.handleToolCall(args, context)
```

```ts file=src/token.ts
// AppRegistry.registerTools():
if (app.needsAuth && getAccessToken && this._apiUrl) {
  const token = await getAccessToken()
  context.apiClient = createApiClient(token, { apiUrl: this._apiUrl })
}
return app.handleToolCall(args, context)
```

The `getAccessToken` function comes from the OAuth2 session — it returns the current user's valid access token (refreshing if needed).

### Resource Deduplication

Multiple tools can share the same HTML resource. While `new_model_app` and `edit_model_app` now each own their own URI, deployer-authored apps can still register two tools against one bundle. The registry deduplicates by tracking registered URIs:

```js file=src/registered.js
registerResources(mcpServer) {
  const registered = new Set()
  for (const app of this._apps.values()) {
    if (registered.has(app.resourceUri)) continue
    registered.add(app.resourceUri)
    // ...register once
  }
}
```

```ts file=src/registered.ts
registerResources(mcpServer) {
  const registered = new Set()
  for (const app of this._apps.values()) {
    if (registered.has(app.resourceUri)) continue
    registered.add(app.resourceUri)
    // ...register once
  }
}
```

### Model Configuration

The registry wires models to apps via configuration maps:

```js file=src/filters.js
import { getSearchConfig } from '@mcp-rune/mcp-rune/api-extensions/search'

const FORM_MODEL_CLASSES = { activity: Activity, book: Book, ... }
const FORM_PROMPT_CLASSES = { activity: ActivityPrompt, book: BookPrompt, ... }

// Browse view excludes models with filters (those go to search view only):
const LIST_VIEW_MODELS = Object.fromEntries(
  Object.entries(FORM_MODEL_CLASSES).filter(([, M]) => {
    const filters = getSearchConfig(M)?.filters
    return !filters || Object.keys(filters).length === 0
  })
)

// Search view includes only models that declare at least one filter:
const SEARCH_VIEW_MODELS = Object.fromEntries(
  Object.entries(FORM_MODEL_CLASSES).filter(([, M]) => {
    const filters = getSearchConfig(M)?.filters
    return filters && Object.keys(filters).length > 0
  })
)
```

```ts file=src/filters.ts
import { getSearchConfig } from '@mcp-rune/mcp-rune/api-extensions/search'

const FORM_MODEL_CLASSES = { activity: Activity, book: Book, ... }
const FORM_PROMPT_CLASSES = { activity: ActivityPrompt, book: BookPrompt, ... }

// Browse view excludes models with filters (those go to search view only):
const LIST_VIEW_MODELS = Object.fromEntries(
  Object.entries(FORM_MODEL_CLASSES).filter(([, M]) => {
    const filters = getSearchConfig(M)?.filters
    return !filters || Object.keys(filters).length === 0
  })
)

// Search view includes only models that declare at least one filter:
const SEARCH_VIEW_MODELS = Object.fromEntries(
  Object.entries(FORM_MODEL_CLASSES).filter(([, M]) => {
    const filters = getSearchConfig(M)?.filters
    return filters && Object.keys(filters).length > 0
  })
)
```

> The `getSearchConfig` reader reaches into `M.extensions['search']` (v0.48.0+). Filter declarations live there via the `searchConfig({...})` typed helper from the search extension.

---

## 6. Client-Side Architecture

### App Connection Pattern

All client-side apps follow the same initialization pattern:

```js file=src/app.js
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts
} from '@modelcontextprotocol/ext-apps'

const app = new App({ name: 'App Name', version: '1.0.0' })

app.ontoolresult = (result) => {
  const data = JSON.parse(result.content.find((c) => c.type === 'text').text)
  // Render from data (schema, records, etc.)
}

app.onhostcontextchanged = (params) => {
  if (params?.theme) applyDocumentTheme(params.theme)
  if (params?.styles?.variables) applyHostStyleVariables(params.styles.variables)
  if (params?.styles?.css?.fonts) applyHostFonts(params.styles.css.fonts)
}

await app.connect()

// Apply initial host context
const ctx = app.getHostContext()
if (ctx?.theme) applyDocumentTheme(ctx.theme)
```

```ts file=src/app.ts
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts
} from '@modelcontextprotocol/ext-apps'

const app = new App({ name: 'App Name', version: '1.0.0' })

app.ontoolresult = (result) => {
  const data = JSON.parse(result.content.find((c) => c.type === 'text').text)
  // Render from data (schema, records, etc.)
}

app.onhostcontextchanged = (params) => {
  if (params?.theme) applyDocumentTheme(params.theme)
  if (params?.styles?.variables) applyHostStyleVariables(params.styles.variables)
  if (params?.styles?.css?.fonts) applyHostFonts(params.styles.css.fonts)
}

await app.connect()

// Apply initial host context
const ctx = app.getHostContext()
if (ctx?.theme) applyDocumentTheme(ctx.theme)
```

### State Management

Each app maintains minimal client-side state:

| App              | State Variables                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| New/Edit Model   | `formSchema`, `currentMode`, `recordId`                                                          |
| List Model App   | `listSchema`, `currentRecords`, `currentPage`, `modelName`                                       |
| Show Model App   | `detailSchema`, `record`                                                                         |
| Search Model App | `listSchema`, `currentRecords`, `currentPage`, `modelName`, `activeFilters`, `filterDefinitions` |

### Dynamic Rendering

The model form app dynamically creates HTML elements from the schema:

```js file=examples/mcp-apps-architecture-06.js
// For each field in schema.fields:
switch (field.type) {
  case 'text':
    renderTextInput(field)
  case 'textarea':
    renderTextarea(field)
  case 'select':
    renderSelect(field, field.options)
  case 'multiselect':
    renderCheckboxList(field, field.options)
  case 'checkbox_group':
    renderCheckboxGroup(field, field.options)
  // ...
}
```

```ts file=examples/mcp-apps-architecture-06.ts
// For each field in schema.fields:
switch (field.type) {
  case 'text':
    renderTextInput(field)
  case 'textarea':
    renderTextarea(field)
  case 'select':
    renderSelect(field, field.options)
  case 'multiselect':
    renderCheckboxList(field, field.options)
  case 'checkbox_group':
    renderCheckboxGroup(field, field.options)
  // ...
}
```

Fields are grouped into `<fieldset>` elements based on `field.group` matching `schema.fieldsets`.

### Pagination Pattern

Table-based apps (`find_model_app`, `view_selection_app`) paginate by calling their own tool:

```js file=src/fetch-page.js
async function fetchPage(page) {
  await app.callServerTool({
    name: 'find_model_app',
    arguments: { model: modelName, page, ...extraArgs }
  })
  // ontoolresult fires → re-renders table
}
```

```ts file=src/fetch-page.ts
async function fetchPage(page) {
  await app.callServerTool({
    name: 'find_model_app',
    arguments: { model: modelName, page, ...extraArgs }
  })
  // ontoolresult fires → re-renders table
}
```

`find_model_app` preserves both `activeFilters` and the optional `query` across pagination calls.

### Theming

CSS uses custom properties with dark-theme fallback values:

```css
:root {
  --color-text-primary: light-dark(#e0e0e0, #e0e0e0);
  --color-background-primary: light-dark(#1a1a2e, #1a1a2e);
  --color-accent: #e94560;
  --surface: #16213e;
  --border: #0f3460;
}
```

The host overrides these via `applyHostStyleVariables()`, ensuring apps match Claude Desktop's dark mode, COC's custom theme, etc.

---

## 7. Build System

### Vite + Single-File HTML

Apps are built with Vite and `vite-plugin-singlefile`, which inlines all CSS and JavaScript into a single HTML file. This is required because MCP resources must be self-contained.

### Build Configuration

```js file=src/configs.js
// src/mcp/apps/vite.config.js
const configs = {
  'new-model-app': { root: 'new-model-app/ui', outFile: 'new-model-app.html' },
  'edit-model-app': { root: 'edit-model-app/ui', outFile: 'edit-model-app.html' },
  'find-model-app': { root: 'find-model-app/ui', outFile: 'find-model-app.html' },
  'show-model-app': { root: 'show-model-app/ui', outFile: 'show-model-app.html' },
  'view-selection-app': { root: 'view-selection-app/ui', outFile: 'view-selection-app.html' },
  'create-book': { root: 'create-book/ui', outFile: 'create-book.html' }
}
```

```ts file=src/configs.ts
// src/mcp/apps/vite.config.js
const configs = {
  'new-model-app': { root: 'new-model-app/ui', outFile: 'new-model-app.html' },
  'edit-model-app': { root: 'edit-model-app/ui', outFile: 'edit-model-app.html' },
  'find-model-app': { root: 'find-model-app/ui', outFile: 'find-model-app.html' },
  'show-model-app': { root: 'show-model-app/ui', outFile: 'show-model-app.html' },
  'view-selection-app': { root: 'view-selection-app/ui', outFile: 'view-selection-app.html' },
  'create-book': { root: 'create-book/ui', outFile: 'create-book.html' }
}
```

### Build Command

```bash
npm run build:engineer:apps
```

This runs sequentially for each target:

```
BUILD_TARGET=new-model-app vite build
BUILD_TARGET=edit-model-app vite build
BUILD_TARGET=find-model-app vite build
BUILD_TARGET=show-model-app vite build
BUILD_TARGET=view-selection-app vite build
BUILD_TARGET=create-book vite build
```

Output goes to `src/engineer/apps/dist/` (git-tracked).

### HTML Caching

At runtime, each app reads its HTML once from disk and caches it:

```js file=src/get-html.js
let _cachedHtml = null

function getHtml() {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}
```

```ts file=src/get-html.ts
let _cachedHtml = null

function getHtml() {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}
```

---

## 8. File Structure

<!-- illustration: mcp-apps-architecture#tree -->

```
src/mcp/apps/
├── lib/                               # Shared server-side helpers
│   ├── form-schema.ts                 # generateFormSchema() — pure function
│   ├── list-schema.ts                 # generateListSchema() — pure function
│   ├── detail-schema.ts               # generateDetailSchema() — pure function
│   ├── form-app-helpers.ts            # Shared form-app server helpers
│   ├── registry.ts                    # AppRegistry + createAppRegistry()
│   └── …                              # types, formatters, stores, etc.
│
├── new-model-app/                     # New-record form
│   ├── index.ts                       # Server factory
│   └── ui/                            # Iframe entry
│       ├── index.html
│       ├── app.js                     # Thin shim → shared/model-form/main.js
│       └── (no per-app CSS — shared)
│
├── edit-model-app/                    # Edit-record form
│   ├── index.ts
│   └── ui/                            # Thin shim → shared/model-form/main.js
│
├── find-model-app/                    # Browseable table + query + filter popover
│   ├── index.ts
│   └── ui/
│
├── show-model-app/                    # Record detail
│   ├── index.ts
│   └── ui/
│
├── view-selection-app/                # Inspect + manage the selection store
│   ├── index.ts
│   └── ui/
│
├── shared/                            # Cross-app iframe code
│   ├── app-init.js
│   ├── base.css
│   ├── helpers.js
│   ├── formatters.js / .runtime.js
│   └── model-form/                    # Shared form UI consumed by new + edit
│       ├── main.js                    # initModelFormApp() — bulk of form code
│       └── styles.css
│
├── vite.config.js                     # Multi-target build config
└── dist/                              # Built single-file HTML (git-tracked)
    ├── new-model-app.html
    ├── edit-model-app.html
    ├── find-model-app.html
    ├── show-model-app.html
    └── view-selection-app.html
```

---

## 9. App Definition Contract

Every app (generic or custom) is a plain object with these properties:

| Property          | Type       | Required | Description                                   |
| ----------------- | ---------- | -------- | --------------------------------------------- |
| `resourceUri`     | `string`   | Yes      | MCP resource URI (e.g., `ui://engineer/...`)  |
| `toolName`        | `string`   | Yes      | MCP tool name (e.g., `new_model_app`)         |
| `needsAuth`       | `boolean`  | Yes      | Whether handleToolCall receives apiClient     |
| `name`            | `string`   | Yes      | Human-readable app name                       |
| `description`     | `string`   | Yes      | App description for resource listing          |
| `toolDescription` | `string`   | Yes      | Tool description for LLM                      |
| `toolInputSchema` | `Object`   | Yes      | Zod schema for tool parameters                |
| `handleToolCall`  | `Function` | Yes      | `(args, { apiClient? }) → { content: [...] }` |
| `getHtml`         | `Function` | Yes      | `() → string` — returns single-file HTML      |

---

## 10. Generic vs Custom Apps

### When to Use Generic

The schema-driven generic apps handle any model that has `attributes` and `fieldGroups`/`sections`. Adding a new model requires **zero new HTML** — just a registry entry.

Use generic for:

- Standard CRUD model forms
- Simple list/browse views
- Record detail views
- Any model with standard field types

### When to Use Custom

Build a custom app when:

- Unique layout or multi-step wizard
- Non-CRUD workflow (import, dashboard, visualization)
- Conditional fields or complex interactions
- Domain-specific rendering not covered by field types

### Creating a Custom App

1. Create `src/engineer/apps/my-app.js` (factory function)
2. Create `src/engineer/apps/my-app-ui/` with `index.html`, `app.js`, `styles.css`
3. Add build target to `vite.config.js`
4. Add `BUILD_TARGET=my-app` to build script in `package.json`
5. Register in `createAppRegistry()` in `index.js`
6. Build: `npm run build:engineer:apps`

---

## 11. Search System Integration

The search view app works alongside the search tool system:

### Discovery Flow

```
1. LLM calls list_models
   → Response includes filterable_search: { available: true, filter_count: N, hint }
   → LLM now knows which models support ES-backed filtering

2. LLM calls get_filters_guide({ model })        [strategy category, no auth]
   → Returns filter reference: types, enum values, date_range format, examples

3. LLM calls search_records({ model, filters })   [crud category, auth required]
   → Returns JSON results for LLM processing
   → Usage rule hints: "call find_model_app to display visually"

4. LLM calls find_model_app({ model, filters })  [app tool, auth required]
   → Renders visual table with filter popover + chips in the host
```

### Tool Precedence

- `search_records` is the **preferred** tool for models with `filterable_search`
- `find_records` usage rules direct LLM to prefer `search_records` for filterable models
- `find_records` remains the tool for ID lookups and simple text search on non-filterable models

### How `find_model_app` routes searches

`find_model_app` is the single browseable surface for every model. The handler makes one call:

```ts file=src/result.ts
const result = await dataLayer.searchNormalized(model, query, filters, { page, perPage })
```

```js file=src/result.js
const result = await dataLayer.searchNormalized(model, query, filters, { page, perPage })
```

The `SearchEnabledDataLayer` decorator (composed automatically by `AppRegistry`) picks the right backend:

| Model shape                         | Routing                                              |
| ----------------------------------- | ---------------------------------------------------- |
| Declares `extensions.search.query`  | POST to the model's search endpoint                  |
| `api.standalone === false` (nested) | Routed through search to avoid a top-level list call |
| Plain model, no query, just filters | Plain `listNormalized` — GET on the model endpoint   |

The app handler never branches on model shape; the seam does it.

---

## 12. Adding a New Model to Apps

### Step 1: Model Configuration

Ensure the model has `attributes`, `endpoint`, and optionally `associations`:

```js file=src/project.js
export class Project extends BaseModel {
  static api = { endpoint: 'projects' }
  static associations = {
    belongsTo: { category: { rel: 'category', target_model: 'category' } }
  }
  static attributes = {
    name: { type: 'string', required: true, label: 'Name' },
    status: { type: 'enum', enumValues: ['planning', 'active'], default: 'planning' },
    category_id: { type: 'integer', label: 'Category' }
  }
}
```

```ts file=src/project.ts
export class Project extends BaseModel {
  static api = { endpoint: 'projects' }
  static associations = {
    belongsTo: { category: { rel: 'category', target_model: 'category' } }
  }
  static attributes = {
    name: { type: 'string', required: true, label: 'Name' },
    status: { type: 'enum', enumValues: ['planning', 'active'], default: 'planning' },
    category_id: { type: 'integer', label: 'Category' }
  }
}
```

### Step 2: Prompt Configuration

Ensure the prompt has `fieldGroups` and `sections`:

```js file=src/prompts/project-prompt.js
export class ProjectPrompt extends BasePrompt {
  static strategy = 'hybrid'
  static fieldGroups = {
    identity: { fields: ['name', 'status', 'category_id'], context: 'Project Identity' }
  }
  static sections = {
    identity: { title: 'Project Identity', groups: ['identity'], required: true }
  }
  getDefaultFormState() {
    return { name: '', status: 'planning', category_id: null }
  }
}
```

```ts file=src/prompts/project-prompt.ts
export class ProjectPrompt extends BasePrompt {
  static strategy = 'hybrid'
  static fieldGroups = {
    identity: { fields: ['name', 'status', 'category_id'], context: 'Project Identity' }
  }
  static sections = {
    identity: { title: 'Project Identity', groups: ['identity'], required: true }
  }
  getDefaultFormState() {
    return { name: '', status: 'planning', category_id: null }
  }
}
```

### Step 3: Register in App Registry

Add entries to the model/prompt maps in `src/engineer/apps/index.js`:

```js file=examples/mcp-apps-architecture-12.js
import { Project } from '../models/project.js'
import { ProjectPrompt } from '../prompts/project_prompt.js'

const FORM_MODEL_CLASSES = { ..., project: Project }
const FORM_PROMPT_CLASSES = { ..., project: ProjectPrompt }
// LIST_VIEW_MODELS and SEARCH_VIEW_MODELS are derived automatically from FORM_MODEL_CLASSES.
// Models with filters declared via `searchConfig({ filters: ... })` in their `extensions['search']`
// slice go to the search view; models without go to browse view. The `getSearchConfig` reader
// from `@mcp-rune/mcp-rune/api-extensions/search` is the single read site.
```

```ts file=examples/mcp-apps-architecture-12.ts
import { Project } from '../models/project.js'
import { ProjectPrompt } from '../prompts/project_prompt.js'

const FORM_MODEL_CLASSES = { ..., project: Project }
const FORM_PROMPT_CLASSES = { ..., project: ProjectPrompt }
// LIST_VIEW_MODELS and SEARCH_VIEW_MODELS are derived automatically from FORM_MODEL_CLASSES.
// Models with filters declared via `searchConfig({ filters: ... })` in their `extensions['search']`
// slice go to the search view; models without go to browse view. The `getSearchConfig` reader
// from `@mcp-rune/mcp-rune/api-extensions/search` is the single read site.
```

### Step 4: Build

```bash
npm run build:engineer:apps
```

That's it. All five apps (create, update, browse, detail, search) now work with the new model. Zero new HTML.

---

## 13. Dependencies

| Package                          | Version | Purpose                                       |
| -------------------------------- | ------- | --------------------------------------------- |
| `@modelcontextprotocol/ext-apps` | ^1.2.0  | MCP Apps protocol (App class, server helpers) |
| `@modelcontextprotocol/sdk`      | ^1.25.1 | Core MCP protocol (McpServer, types)          |
| `vite`                           | ^7.3.1  | Build tool for single-file HTML               |
| `vite-plugin-singlefile`         | ^2.3.0  | Inlines CSS/JS into single HTML               |
| `zod`                            | ^4.2.1  | Input schema validation                       |

---

## 14. Design Decisions

### MCP Server as Source of Truth

The MCP server owns all metadata — field types, validations, grouping, labels, filter definitions. The Rails API provides data, not structure. This keeps the MCP server decoupled from the Rails app's internal implementation.

### Schema-Driven Rendering

One generic renderer handles all model forms, lists, and details. Adding a new model requires zero UI code. This eliminates per-model maintenance burden and ensures consistent UX.

### Single-File HTML Bundles

MCP resources must be self-contained. Vite + singlefile plugin inlines all CSS and JS into one HTML file, eliminating external dependencies and network requests from the sandbox.

### Lazy Association Resolution

Association options (locations, tags) are fetched when the form opens, not at schema time. This ensures options are fresh, user-scoped, and the schema generator stays pure.

### Unified Find Surface

A single `find_model_app` handles every browseable scenario — plain list, text query, structured filter, or both — across every registered model. Routing decisions (search endpoint vs. plain list vs. nested fallback) live inside the `SearchEnabledDataLayer` decorator, not the app handler. The user always lands on the same UI with an optional `query` input and the Filters popover.

### Separate Selection-Management Surface

`view_selection_app` is a dedicated surface for inspecting and pruning the in-session selection store. Picker apps (`find_model_app`, `pick_model_app`, `multi_pick_model_app`) write to the store; `view_selection_app` is the read/manage view. Keeping them separate means the selection store has one canonical visualization without overloading the picker UIs.

## 15. Tool Response Pattern: UI Data vs LLM Context

When an MCP App tool returns `{ content: [...] }`, the host delivers **all** content blocks to the LLM conversation context. If the tool returns full JSON (records, schemas, workflow definitions), that entire payload ends up in the LLM context — even though the user already sees the data rendered in the app UI.

### Two Strategies

#### Strategy A: Two-Block Response (data tools)

For tools where the LLM needs the data for follow-up (e.g., record lists, search results), return two blocks:

| Block            | Audience         | Content                                           |
| ---------------- | ---------------- | ------------------------------------------------- |
| 1st `text` block | UI app + LLM     | Full JSON payload: schema, records, metadata      |
| 2nd `text` block | LLM context only | Minimal summary: count, status, interaction hints |

```js file=examples/mcp-apps-architecture-14.js
return {
  content: [
    { type: 'text', text: JSON.stringify({ schema, records, pagination }) },
    {
      type: 'text',
      text: `${totalRecords} records displayed. Do not repeat or summarize the data.`
    }
  ]
}
```

```ts file=examples/mcp-apps-architecture-14.ts
return {
  content: [
    { type: 'text', text: JSON.stringify({ schema, records, pagination }) },
    {
      type: 'text',
      text: `${totalRecords} records displayed. Do not repeat or summarize the data.`
    }
  ]
}
```

The client-side app reads only the first text block via `.find()`:

```js file=src/data.js
const data = JSON.parse(result.content.find((c) => c.type === 'text').text)
```

```ts file=src/data.ts
const data = JSON.parse(result.content.find((c) => c.type === 'text').text)
```

#### Strategy B: App-Initiated Data Fetch (display-only tools)

For tools where the LLM does NOT need the data (e.g., workflow panel, dashboards), return only a summary from the tool and have the app fetch data via `callServerTool`. App-initiated `callServerTool` results do **not** enter the LLM context.

**Server-side** — branch on an internal `action` parameter:

```js file=examples/mcp-apps-architecture-16.js
handleToolCall(args) {
  // App-initiated: return full data (invisible to LLM)
  if (args?.action === 'fetch_data') {
    return { content: [{ type: 'text', text: JSON.stringify({ items }) }] }
  }
  // LLM-initiated: return minimal summary only
  return {
    content: [{ type: 'text', text: `Panel displayed with ${items.length} items.` }]
  }
}
```

```ts file=examples/mcp-apps-architecture-16.ts
handleToolCall(args) {
  // App-initiated: return full data (invisible to LLM)
  if (args?.action === 'fetch_data') {
    return { content: [{ type: 'text', text: JSON.stringify({ items }) }] }
  }
  // LLM-initiated: return minimal summary only
  return {
    content: [{ type: 'text', text: `Panel displayed with ${items.length} items.` }]
  }
}
```

**Client-side** — fetch data on tool result:

```js file=src/response.js
app.ontoolresult = async () => {
  const response = await app.callServerTool({
    name: 'my_panel',
    arguments: { action: 'fetch_data' }
  })
  const data = JSON.parse(response.content.find((c) => c.type === 'text').text)
  renderItems(data.items)
}
```

```ts file=src/response.ts
app.ontoolresult = async () => {
  const response = await app.callServerTool({
    name: 'my_panel',
    arguments: { action: 'fetch_data' }
  })
  const data = JSON.parse(response.content.find((c) => c.type === 'text').text)
  renderItems(data.items)
}
```

### Summary Block Guidelines

- State the count or summary of what was displayed
- Include "Do not repeat or summarize the data" to prevent the LLM from echoing JSON
- Mention interactive capabilities (selection, card clicks, pagination)
- Keep to 1-3 sentences — the goal is minimal LLM context overhead

### Apps by Strategy

| Strategy      | App                  | LLM Context                                 |
| ------------- | -------------------- | ------------------------------------------- |
| A (two-block) | `find_model_app`     | JSON + record count + filter/query summary  |
| A (two-block) | `view_selection_app` | JSON + selection state + management hint    |
| B (app-fetch) | `workflow_panel`     | Summary only (N workflows, click to launch) |
