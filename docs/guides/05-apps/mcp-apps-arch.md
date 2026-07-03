> **Customization:** none — this chapter is the wiring deep-dive (sandbox, channels, schema generators, build). The deployer-facing seams are [`createDefaultAppRegistry({ modelClasses, … })`](./mcp-apps.md) for assembling the default apps (plus `AppRegistry.registerApp` for custom ones) and [`BaseAppForm`](./model-form.md) for tuning the generic form. Architecture below is what runs underneath; you cannot replace it.

# Apps architecture

The previous chapter showed _what_ an MCP app is and how it talks to the server. This one is the deep reference for _how_ the framework wires it: how a `ui://` resource resolves to an iframe, how the sandbox is constructed, how the message channels are bound to the three layers from [chapter 4](../04-tools/the-three-layers.md). Read it when you need to debug a wiring issue or understand exactly what runs before your app's `init()` callback.

A deep reference for the interactive UI system built on the `@modelcontextprotocol/ext-apps` extension protocol.

---

## 1. What Are MCP Apps?

MCP Apps are sandboxed HTML applications rendered inside MCP clients (Claude Desktop, COC, MCP Inspector). They provide visual, interactive interfaces — forms, tables, detail cards, search views — that communicate bidirectionally with the MCP server over the MCP protocol.

Unlike traditional web apps, MCP Apps have no server of their own. They are **single-file HTML bundles** served as MCP resources and controlled entirely by MCP tool calls.

### Core Primitives

Every MCP App is composed of two MCP primitives:

| Primitive    | Purpose                           | Example                        |
| ------------ | --------------------------------- | ------------------------------ |
| **Tool**     | LLM calls this to launch/interact | `new_model_app`                |
| **Resource** | Client fetches HTML from this URI | `ui://bookshelf/new-model-app` |

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
│  │    → callServerTool('create_model', {...})     │   │
│  │    → callServerTool('update_model', {...})     │   │
│  │      (422 errors render as inline field errors)│   │
│  │    → callServerTool('find_model_app', {...})   │   │
│  └────────────────────────────────────────────────┘   │
│                                                       │
└───────────────────────────────────────────────────────┘
                      ↕ MCP protocol
┌─ MCP Server ─────────────────────────────────────────┐
│                                                       │
│  AppRegistry (assembled by createDefaultAppRegistry)  │
│    ├── registerTools(mcpServer, { getAccessToken, … })│
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
│    ├── generateAppFormSchema(bindAppForm(Form, Model))│
│    ├── generateListSchema(Model)                      │
│    └── generateDetailSchema(Model, Prompt?)           │
│                                                       │
└───────────────────────────────────────────────────────┘
                      ↕ HTTP (Bearer token)
┌─ Backend REST API ───────────────────────────────────┐
│  Association options, record CRUD, search endpoints   │
└───────────────────────────────────────────────────────┘
```

There is no separate validation tool: the form submits straight to `create_model` / `update_model`, and server-side validation failures (HTTP 422) come back through the same call and render as inline field errors in the form.

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

| App | Tool Name | Resource URI | Auth | Purpose |
| --- | --- | --- | --- | --- |
| New Model App | `new_model_app` | `ui://bookshelf/new-model-app` | Yes | Interactive form to create records |
| Edit Model App | `edit_model_app` | `ui://bookshelf/edit-model-app` | Yes | Interactive form to edit records |
| Find Model App | `find_model_app` | `ui://bookshelf/find-model-app` | Yes | Browseable table with optional text query + filter popover |
| Show Model App | `show_model_app` | `ui://bookshelf/show-model-app` | Yes | Read-only detail cards |
| Pick Model App | `pick_model_app` | `ui://bookshelf/pick-model-app` | Yes | Type-ahead picker (single-model or cross-model group) |
| Multi-Pick App | `multi_pick_model_app` | `ui://bookshelf/multi-pick-model-app` | Yes | Browse-and-select picker for small/medium model sets |
| View Selection App | `view_selection_app` | `ui://bookshelf/view-selection-app` | Yes | Inspect and manage the in-session selection store |

These seven are the default set assembled by `createDefaultAppRegistry` (the `ui://bookshelf/…` namespace comes from its `namespace` option; use `exclude` to trim the list). An eighth factory, `createWorkflowPanelApp`, is opt-in: it returns the `workflow_panel_app` panel plus its `visibility: ['app']` data tool (see [section 15](#15-tool-response-pattern-ui-data-vs-llm-context)).

Note: `new_model_app` and `edit_model_app` each build their own bundle, but both wrap the same shared client module at `src/mcp/apps/shared/model-form/main.js` — the rendered DOM is identical, and the mode (`'create'` vs `'update'`) is set from the server's tool result.

> **Projection-layer rule.** App handlers consume only the `DataLayer` interface — `context.dataLayer` is the only data-access seam exposed. The handler signature never receives `searchClient`, `apiClient`, or any concrete adapter. See [The Projection-Layer Rule](../06-the-three-layers-up-close/data-layer.md#the-projection-layer-rule) for the full contract.

### App Data Flows

#### Create Form

```
User: "Create a book"
  ↓
LLM calls new_model_app({ model: 'book', mode: 'form' })
  ↓
Server:
  0. Mode gate — without mode: 'form' the tool refuses and points the LLM
     at get_prompt_guide to present creation-mode options first
  1. bindAppForm(BookForm, Book) → BoundAppForm (fields ⊕ attributes ⊕ associations)
  2. Association pre-check — unresolved *required* associations short-circuit
     with { status: 'associations_needed', associations: [...instructions] }
  3. generateAppFormSchema(boundForm) → { fieldsets, fields }
  4. Defaults: BookPrompt.getDefaultFormState() (or attribute `default`s) + prefill
  5. resolveAssociationOptions(schema.fields, dataLayer, defaults) → fetch locations, tags
  ↓
Returns: { schema, defaults, mode: 'create', submitMode, hiddenValues?, parentContext? }
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
  1. bindAppForm(BookForm, Book) → generateAppFormSchema(boundForm) → { fieldsets, fields }
  2. dataLayer.dispatch('GET', 'books/abc-123') → existing record as defaults
  3. resolveAssociationOptions(schema.fields, dataLayer, defaults) → fetch locations, tags
  ↓
Returns: { schema, defaults, mode: 'update', submitMode, recordId: 'abc-123' }
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
       model's `extensions['search']` config — the handler doesn't care
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
  1. generateDetailSchema(Book, BookPrompt?) → { model, title, endpoint, fields }
  2. dataLayer.dispatch('GET', 'books/abc-123') → record (parallel per id;
     association IDs batch-resolved to labels)
  ↓
Returns: { schema, records }
  ↓
App renders read-only detail card with sections, badges, stars
```

#### Inspect Selection

```
User: "What books do I have selected?"
  ↓
LLM calls view_selection_app({ model: 'book' })
  ↓
Server (handler):
  1. selectionStore.get('book') → { mode: 'ids', ids: [...], total: N }
  2. dataLayer.searchNormalized('book', undefined, { id: ids }, …) → records
  ↓
Returns: { view: 'ids', schema, records, ids, total }
  ↓
App renders table with per-row × → User clicks ×:
  → callServerTool('remove_from_selection', { model: 'book', ids: [<id>] })
  → callServerTool('view_selection_app', { model: 'book' })   // refresh
```

For filter-mode selections (built via the "Select all N results" escalation in `find_model_app`), the app renders the filter chips + a "Materialize as IDs" button that calls `materialize_selection`.

---

## 4. Schema Generation Layer

Schema generators are **pure functions** — no API calls, no side effects. They transform model/prompt configuration into JSON schemas that the client-side app renders dynamically.

### Schema Generators

| Generator | Input | Output | Used By |
| --- | --- | --- | --- |
| `generateAppFormSchema()` | `BoundAppForm` from `bindAppForm(FormClass, ModelClass)` | `{ model, title, fieldsets, fields }` | New/Edit Model App |
| `generateListSchema()` | ModelClass | `{ model, title, columns, searchFields }` | Find Model App, View Selection App |
| `generateDetailSchema()` | ModelClass + PromptClass? | `{ model, title, endpoint, fields }` | Show Model App |

The form generator never receives raw classes: `bindAppForm(FormClass, ModelClass)` merges the form's `fields`/`fieldsets` declarations with the model's attributes and associations once, and every downstream consumer (schema generation, association resolution, iframe rendering) reads the resulting `BoundAppForm`.

### Single Source of Truth

The schema generators read from these sources:

| What | Source | Example |
| --- | --- | --- |
| Field kinds, labels | `Model.attributes` | `title: { type: 'string', label: 'Title' }` |
| Enum options | `Model.attributes` | `status: { enumValues: ['unread', 'reading'] }` |
| Validations | `Model.attributes` | `rating: { validation: { min: 1, max: 5 } }` |
| Which fields render | `AppForm.fields` | `static fields = ['title', 'author', 'status']` |
| Fieldset layout | `AppForm.fieldsets` | `identity: { title: 'Book Identity', fields: [...] }` |
| Defaults | `Prompt.getDefaultFormState()`, falling back to attribute `default`s | `{ status: 'unread', formats: [] }` |
| Associations | `Model.associations` | `belongsTo: { location: { ... } }` |
| Search filters | `extensions['search']` via `searchConfig({ filters })` | `{ status: { type: 'enum', ... } }` |

The backend API is only used for:

1. **Association options** — fetched at form-open time through the session-scoped `DataLayer`
2. **Record data** — fetched for update forms and detail views
3. **CRUD operations** — create, update, delete via tool calls
4. **Search queries** — routed by `SearchEnabledDataLayer` to the model's declared search endpoint

### Form Field Type Mapping

`generateAppFormSchema()` does not hardcode a type table — it calls `resolveInputType(kind, format, opts)` from the kinds registry (`src/mcp/models/kinds/`), so deployer-registered kinds (`AppRegistry({ kinds })`) slot in automatically. The built-in kinds resolve to:

| Model Attribute | Form Field Type | HTML Rendered |
| --- | --- | --- |
| `type: 'string'` | `text` | `<input type="text">` |
| `type: 'text'` / `'json'` | `textarea` | `<textarea>` |
| `type: 'integer'` / `'decimal'` | `number` | `<input type="number">` |
| `type: 'boolean'` | `checkbox` | `<input type="checkbox">` |
| `type: 'date'` | `date` | `<input type="date">` |
| `type: 'datetime'` | `datetime-local` | `<input type="datetime-local">` |
| `type: 'enum'` | `select` | `<select>` (requires `enumValues`) |
| `format: 'url'` | `url` | `<input type="url">` (format resolves as a kind) |
| `type: 'base64'` | `text` | Passthrough input — no dedicated widget |
| any kind + `enumValues` | `select` | `<select>` — enum-driven widening |
| `type: 'array'` + `enumValues` | `checkbox_group` | Checkbox list |
| bound belongsTo field | `select` | `<select>`, options fetched at open time |
| bound hasMany field | `multiselect` | Checkbox list, options fetched at open time |

Association bindings override the base kind, and `enumValues` on any definition widens it to `select` (`checkbox_group` when the kind is `array`) — both rules live in one place (`resolveInputType`). An `enum` attribute without `enumValues` throws; boot validation catches it before any form opens.

### Association Resolution

Association fields (belongsTo selects, hasMany multiselects) are detected during `bindAppForm`, not by name heuristics in the schema generator. The binder inverts the model's API convention: for each `belongsTo` / `hasMany` entry it asks `convention.resolveAssociationFields(name, config)` which field names carry that association, then maps those names back to the association — so deployments on non-JSON-API conventions (HAL `_link` fields, nested relations) get correct field typing for free. Only when the model declares no `api.convention` does a JSON-API-shaped fallback apply: `<name>_id` for belongsTo, singularized `<name>_ids` for hasMany.

The schema generator marks bound fields with `association: { endpoint, labelField }` (plus `nested: { parentModel, childEndpoint }` for parent-scoped children). The app's `handleToolCall` fetches options from the API separately:

```js file=examples/mcp-apps-architecture-01.js
// In handleToolCall (server-side):
await resolveAssociationOptions(schema.fields, dataLayer, defaults)

// Fetches: dataLayer.dispatch('GET', 'locations') → [{ id: 1, name: 'Office' }, ...]
// Produces: field.options = [{ value: '1', label: 'Office' }, ...]
```

```ts file=examples/mcp-apps-architecture-01.ts
// In handleToolCall (server-side):
await resolveAssociationOptions(schema.fields, dataLayer, defaults)

// Fetches: dataLayer.dispatch('GET', 'locations') → [{ id: 1, name: 'Office' }, ...]
// Produces: field.options = [{ value: '1', label: 'Office' }, ...]
```

`defaults` matters for the nested case: a child scoped under a parent (e.g. a `category` under a `theme`) resolves its options from `themes/<theme_id>/categories`, and the parent id comes from the defaults/prefill bag.

---

## 5. AppRegistry

The `AppRegistry` class manages app registrations on the MCP server. It bridges app definitions with the MCP protocol.

### Registration Flow

```
createDefaultAppRegistry({ modelClasses, namespace, ... })
  ↓
Synthesizes missing form classes, then builds the seven default
app definitions (factories return plain objects)
  ↓
new AppRegistry(apps, { models, apiUrl, createApiClient, themeOverrides, kinds, ... })
  ↓
Boot validation: validateRegistries over models + resolved form classes
(explicit and synthesized) + prompt classes — validate: 'throw' | 'warn' | 'off'
  ↓
registry.registerTools(mcpServer, { getAccessToken, selectionStore, formDataStore })
  → For each app: registerAppTool(mcpServer, toolName, metadata, handler)
  → handler wraps handleToolCall with layer context (dataLayer, modelLayer, …)
  ↓
registry.registerResources(mcpServer)
  → For each unique resourceUri: registerAppResource(mcpServer, ...)
  → Resource callback returns cached HTML via getHtml(), with theme/kind injection
```

Boot validation runs automatically inside `createDefaultAppRegistry` — it is the composition root that actually holds the form declarations, so it validates them itself rather than deferring to `createServer` (see [ADR 0012](../../architecture/decisions/0012-boot-validation-runs-automatically.md)). Declaration errors (unknown kind, form field that doesn't exist on the model, enum without values) fail at boot with a formatted report instead of surfacing as request-time errors; `validate: 'warn'` is the migration hatch, `'off'` skips.

### Authentication Integration

Apps declaring `needsAuth: true` receive an authenticated, search-enabled `DataLayer` — never the raw API client:

```js file=src/token.js
// AppRegistry.registerTools():
if (app.needsAuth && getAccessToken && this._apiUrl && this._createApiClient) {
  const token = await getAccessToken()
  const apiClient = this._createApiClient(token, { apiUrl: this._apiUrl })
  const baseDataLayer = this._dataLayerFactory({
    apiClient,
    models,
    namespace,
    defaultConvention,
    logger
  })
  context.dataLayer = withSearchEnabledDataLayer(baseDataLayer, { searchGroups, defaultShaper })
  context.analysisLayer = createAnalysisLayerFactory(models, context.dataLayer)
}
return app.handleToolCall(args, context)
```

```ts file=src/token.ts
// AppRegistry.registerTools():
if (app.needsAuth && getAccessToken && this._apiUrl && this._createApiClient) {
  const token = await getAccessToken()
  const apiClient = this._createApiClient(token, { apiUrl: this._apiUrl })
  const baseDataLayer = this._dataLayerFactory({
    apiClient,
    models,
    namespace,
    defaultConvention,
    logger
  })
  context.dataLayer = withSearchEnabledDataLayer(baseDataLayer, { searchGroups, defaultShaper })
  context.analysisLayer = createAnalysisLayerFactory(models, context.dataLayer)
}
return app.handleToolCall(args, context)
```

The `getAccessToken` function comes from the OAuth2 session — it returns the current user's valid access token (refreshing if needed). The gate requires all four of `needsAuth`, `getAccessToken`, `apiUrl`, and `createApiClient`; if any is missing, the handler simply runs without a `dataLayer` in its context. The per-request `apiClient` is wrapped into the `DataLayer` and discarded — the handler context never exposes it, which is how the projection-layer rule is enforced by absence.

### Resource Deduplication

Multiple tools can share the same HTML resource. While `new_model_app` and `edit_model_app` now each own their own URI, deployer-authored apps can still register two tools against one bundle. The registry deduplicates by tracking registered URIs:

```js file=src/registered.js
registerResources(mcpServer) {
  const registered = new Set()
  for (const app of this._apps.values()) {
    if (!app.resourceUri || registered.has(app.resourceUri)) continue
    registered.add(app.resourceUri)
    // ...register once
  }
}
```

```ts file=src/registered.ts
registerResources(mcpServer) {
  const registered = new Set()
  for (const app of this._apps.values()) {
    if (!app.resourceUri || registered.has(app.resourceUri)) continue
    registered.add(app.resourceUri)
    // ...register once
  }
}
```

Apps without a `resourceUri` (data-only tools like `workflow_panel_app_data`) are skipped here — they have a tool surface but no iframe. Each served resource passes through `injectIntoHead()`, which splices the deployment's `themeOverrides` / `headerIcon` style block and kind render hints into the bundled HTML just before `</head>`.

### Model Configuration

There are no per-app model maps to maintain — `createDefaultAppRegistry` is the single configuration surface, and every default app derives its eligibility from it:

```js file=src/filters.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

const appRegistry = createDefaultAppRegistry({
  // Required: the models every app serves + the ui:// namespace.
  modelClasses: { book: Book, location: Location, tag: Tag },
  namespace: 'bookshelf',

  // Optional: per-model form classes. Models without an entry get a
  // synthesized default form (every prompt-visible attribute, in order).
  formClasses: { book: BookForm },

  // Optional: per-model prompt classes — supply form defaults.
  promptClasses: { book: BookPrompt },

  // Optional: trim the surface.
  exclude: ['multi-pick-model-app'],

  // Forwarded to AppRegistry: apiUrl, createApiClient, dataLayer,
  // searchGroups, defaultShaper, headerIcon, themeOverrides, kinds.

  // Boot-validation policy: 'throw' (default) | 'warn' | 'off'.
  validate: 'throw'
})
```

```ts file=src/filters.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

const appRegistry = createDefaultAppRegistry({
  // Required: the models every app serves + the ui:// namespace.
  modelClasses: { book: Book, location: Location, tag: Tag },
  namespace: 'bookshelf',

  // Optional: per-model form classes. Models without an entry get a
  // synthesized default form (every prompt-visible attribute, in order).
  formClasses: { book: BookForm },

  // Optional: per-model prompt classes — supply form defaults.
  promptClasses: { book: BookPrompt },

  // Optional: trim the surface.
  exclude: ['multi-pick-model-app'],

  // Forwarded to AppRegistry: apiUrl, createApiClient, dataLayer,
  // searchGroups, defaultShaper, headerIcon, themeOverrides, kinds.

  // Boot-validation policy: 'throw' (default) | 'warn' | 'off'.
  validate: 'throw'
})
```

Each app then applies its own eligibility gate:

| App | Eligibility gate |
| --- | --- |
| `new_model_app` / `edit_model_app` | Model has a form class — an explicit `formClasses` entry, or a synthesized default with at least one field. Models that would synthesize to zero fields are silently ineligible. |
| `find_model_app` | Every model in `modelClasses`. The text `query` is honored only for models whose search config declares `query`; the Filters popover comes from `searchConfig({ filters })`. |
| `pick_model_app` / `multi_pick_model_app` / `show_model_app` / `view_selection_app` | Every model in `modelClasses`. |

> Search declarations live in the model's `extensions['search']` slice via the `searchConfig({...})` typed helper, and `getSearchConfig` (both from `@mcp-rune/mcp-rune/api-extensions/search`) is the single read site.

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

The framework centralizes this bootstrap in `src/mcp/apps/shared/app-init.js`: `initApp(app)` wires `onerror`, `onteardown`, `ontoolcancelled`, and `onhostcontextchanged`, then applies the initial host context (theme, style variables, fonts, safe-area insets) in one call, so per-app entry points don't repeat the handlers above.

### State Management

Each app maintains minimal client-side state:

| App | State Variables |
| --- | --- |
| New/Edit model form (`shared/model-form/main.js`) | `formSchema`, `modelName`, `formMode`, `submitMode`, `recordId`, `hiddenValues`, `parentContext` |
| `find_model_app` | `listSchema`, `currentRecords`, `currentPage`, `currentPagination`, `modelName`, `currentQuery`, `activeFilters`, `filterDefinitions` |
| `show_model_app` | none — renders directly from each tool result |
| `view_selection_app` | `currentModel`, `currentSchema`, `currentRecords`, `currentFilters`, `filterDefinitions`, `currentView` (`ids` / `filter` / `summary`), `currentTotal` |

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

`src/mcp/apps/shared/base.css` ships one tokenized system with two themes. Light is the default (apps embed in light host surfaces); dark activates via `[data-theme='dark']` on the document root or automatically through `prefers-color-scheme`:

```css
:root,
[data-theme='light'] {
  --app-bg: #ffffff;
  --surface: #fafafb;
  --line-2: #dcdce4;
  --ink: #16161c; /* primary text; --ink-2 … --ink-4 step down */
  --acc: #6b4fe6; /* violet accent */
  --acc-2: #5b3fd6;
  --acc-tint: rgba(124, 92, 255, 0.09);
  --radius-md: 8px;
}
```

Two override channels stack on top of these tokens. The host pushes its style variables via `applyHostStyleVariables()` at runtime, and the deployment brands every app at serve time through the registry seam: `themeOverrides.cssVariables` writes a `:root { … }` block, `themeOverrides.css` is appended verbatim, and `headerIcon` is sugar for setting the `--header-icon` variable — all injected before `</head>` by `AppRegistry.injectIntoHead()`.

---

## 7. Build System

### Vite + Single-File HTML

Apps are built with Vite and `vite-plugin-singlefile`, which inlines all CSS and JavaScript into a single HTML file. This is required because MCP resources must be self-contained.

This build is framework-contributor-only: deployers never run it. The built HTML ships in the npm package, and deployer-authored custom apps are bundled in the deployer's own repo with whatever tool they like (see [section 10](#10-generic-vs-custom-apps)).

### Build Configuration

There is no per-app config map. `src/mcp/apps/vite.config.js` maps `BUILD_TARGET` directly to a sibling app directory — every app ships its iframe entry at `<app>/ui/index.html` and bundles to `dist/<app>.html`:

```js file=src/configs.js
// src/mcp/apps/vite.config.js — no per-app config map
const target = process.env.BUILD_TARGET || 'new-model-app'
const targetRoot = path.resolve(import.meta.dirname, target, 'ui')
// fails fast if <target>/ui/index.html does not exist
const outFile = `${target}.html`
```

```ts file=src/configs.ts
// src/mcp/apps/vite.config.js — no per-app config map
const target = process.env.BUILD_TARGET || 'new-model-app'
const targetRoot = path.resolve(import.meta.dirname, target, 'ui')
// fails fast if <target>/ui/index.html does not exist
const outFile = `${target}.html`
```

Adding a new app to the build is a filesystem-only change: drop in `src/mcp/apps/<new-app>/ui/index.html` and it joins.

### Build Command

```bash
npm run build:all-apps
```

This runs `src/mcp/apps/scripts/build-all.mjs`, which discovers every `src/mcp/apps/<name>/ui/index.html` and runs `BUILD_TARGET=<name> vite build -c src/mcp/apps/vite.config.js` for each (the first build cleans `dist/`, the rest run in parallel with `SKIP_CLEAN=1`). Per-app scripts exist for iterating on a single bundle, e.g. `npm run build:apps:find-model-app`.

Output goes to `src/mcp/apps/dist/<app>.html` (git-tracked); `npm run build:full` copies the bundles into the published `dist/` tree.

### HTML Caching

At runtime, each app factory gets its `getHtml` from `createHtmlLoader(appName)` (`src/mcp/apps/lib/html-loader.ts`), which reads `dist/<appName>.html` once from disk and caches it:

```js file=src/get-html.js
export function createHtmlLoader(appName) {
  const htmlPath = path.join(DIST_DIR, `${appName}.html`)
  let cached = null
  return () => {
    if (!cached) cached = fs.readFileSync(htmlPath, 'utf-8')
    return cached
  }
}
```

```ts file=src/get-html.ts
export function createHtmlLoader(appName: string): () => string {
  const htmlPath = path.join(DIST_DIR, `${appName}.html`)
  let cached: string | null = null
  return () => {
    if (!cached) cached = fs.readFileSync(htmlPath, 'utf-8')
    return cached
  }
}
```

---

## 8. File Structure

<!-- illustration: mcp-apps-architecture#tree -->

```
src/mcp/apps/
├── lib/                               # Shared server-side helpers
│   ├── registry.ts                    # AppRegistry — tools, resources, theme/kind injection
│   ├── create-default-registry.ts     # createDefaultAppRegistry() — 7 default apps + boot validation
│   ├── create-model-form-app.ts       # Factory for new_model_app + edit_model_app
│   ├── bind-app-form.ts               # bindAppForm() — form ⊕ model merge, convention-aware
│   ├── app-form-schema.ts             # generateAppFormSchema() — pure function
│   ├── app-form-helpers.ts            # resolveAssociationOptions(), defaults helpers
│   ├── list-schema.ts                 # generateListSchema() — pure function
│   ├── detail-schema.ts               # generateDetailSchema() — pure function
│   ├── base-app-form.ts               # BaseAppForm — deployer form base class
│   ├── synthesize-form-class.ts       # Default form when formClasses omits a model
│   ├── html-loader.ts                 # createHtmlLoader() — cached dist/<app>.html reads
│   ├── selection-store.ts / selection-tools.ts
│   └── …                              # validators, data stores, formatters, entities
│
├── new-model-app/                     # New-record form (no index.ts — built by
│   └── ui/                            #   lib/create-model-form-app.ts)
│       ├── index.html
│       └── app.js                     # Thin shim → shared/model-form/main.js
│
├── edit-model-app/                    # Edit-record form (same shim pattern)
│   └── ui/
│
├── find-model-app/                    # Browseable table + query + filter popover
│   ├── index.ts                       # Server factory
│   └── ui/
│
├── show-model-app/                    # Record detail cards
│   ├── index.ts
│   └── ui/
│
├── pick-model-app/                    # Type-ahead picker
│   ├── index.ts
│   └── ui/
│
├── multi-pick-model-app/              # Browse-and-select picker
│   ├── index.ts
│   └── ui/
│
├── view-selection-app/                # Inspect + manage the selection store
│   ├── index.ts
│   └── ui/
│
├── workflow-panel-app/                # Opt-in workflow launcher (panel + data tool)
│   ├── index.ts
│   └── ui/
│
├── shared/                            # Cross-app iframe code
│   ├── app-init.js                    # connect + host-context bootstrap
│   ├── base.css                       # Tokenized light/dark theme
│   ├── helpers.js
│   ├── kind-renderers.ts / .runtime.js
│   ├── filter-chips.js / filter-popover.js
│   └── model-form/                    # Shared form UI consumed by new + edit
│       ├── main.js                    # initModelFormApp() — bulk of form code
│       └── styles.css
│
├── scripts/build-all.mjs              # Discovers every <app>/ui/index.html
├── vite.config.js                     # BUILD_TARGET=<app> → dist/<app>.html
└── dist/                              # Built single-file HTML (git-tracked)
    ├── new-model-app.html
    ├── edit-model-app.html
    ├── find-model-app.html
    ├── show-model-app.html
    ├── pick-model-app.html
    ├── multi-pick-model-app.html
    ├── view-selection-app.html
    └── workflow-panel-app.html
```

---

## 9. App Definition Contract

Every app (generic or custom) is a plain object satisfying `AppDefinition` (`src/mcp/apps/lib/registry.ts`). Only `name` and `description` are required:

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Human-readable app name (used when registering the resource) |
| `description` | `string` | Yes | App description for resource listing |
| `resourceUri` | `string` | No | MCP resource URI (e.g., `ui://bookshelf/...`); omit for data-only tools with no iframe |
| `toolName` | `string` | No | MCP tool name (e.g., `new_model_app`); required for `registerApp` and for the tool to register |
| `needsAuth` | `boolean` | No | When true, the handler context gains `dataLayer` + `analysisLayer` built from the session token |
| `visibility` | `string[]` | No | `_meta.ui.visibility`; defaults to `['model', 'app']` — `['app']` hides the tool from the LLM |
| `toolDescription` | `string` | No | Tool description for the LLM |
| `toolInputSchema` | `Object` | No | Zod raw shape for tool parameters |
| `annotations` | `Object` | No | Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) |
| `handleToolCall` | `Function` | No | `(args, context) → Promise<{ content: [...] }>` |
| `getHtml` | `Function` | No | `() → string` — returns single-file HTML for the resource |

The `context` passed to `handleToolCall` always carries `modelLayer` and `formSubmitMode`, plus `dataLayer` and `analysisLayer` when the auth gate passes, `selectionStore` / `formDataStore` when the server wires them, and any `extraContext` contributed by extensions. It never carries a raw API client.

---

## 10. Generic vs Custom Apps

### When to Use Generic

The schema-driven generic apps handle any model that has `attributes` — the form class is synthesized when you don't supply one. Adding a new model requires **zero new HTML** — just a `createDefaultAppRegistry` entry.

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

Custom apps live in the deployer's repo, not the framework's — you bring your own bundle and register it:

1. Build a **single-file HTML bundle** with your own tooling (any bundler works; everything must be inlined — MCP resources are self-contained)
2. Define a plain `AppDefinition` object: `name`, `description`, `toolName`, `resourceUri: 'ui://bookshelf/my-app'`, `toolInputSchema`, `handleToolCall`, and a `getHtml` that returns your bundle
3. Register it on the registry returned by `createDefaultAppRegistry`: `appRegistry.registerApp(myApp)`

Framework contributors adding a default app instead drop `src/mcp/apps/<name>/ui/index.html` (plus an `index.ts` factory) into the framework repo — `npm run build:all-apps` discovers it with no vite-config changes.

---

## 11. Search System Integration

The search view app works alongside the search tool system:

### Discovery Flow

```
1. LLM calls list_models
   → Response includes filterable_search: { available: true, filter_count: N, hint }
   → LLM now knows which models support search-backed filtering

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

| Model shape | Routing |
| --- | --- |
| Declares `query` in `extensions['search']` | POST to the model's search endpoint |
| `api.standalone === false` (nested) | Routed through search to avoid a top-level list call |
| Plain model, no query, just filters | Plain `listNormalized` — GET on the model endpoint |

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

### Step 2: Form and Prompt Configuration (Optional)

Both are optional. Without a form class, the registry synthesizes one from the model's prompt-visible attributes; supply a `BaseAppForm` subclass only when you want to control which fields render and how they group. A prompt class contributes form defaults via `getDefaultFormState()` (and detail-view field ordering via `fieldGroups`):

```js file=src/prompts/project-prompt.js
import { BaseAppForm } from '@mcp-rune/mcp-rune/apps'
import { BasePrompt } from '@mcp-rune/mcp-rune/prompts'

export class ProjectForm extends BaseAppForm {
  static fields = ['name', 'status', 'category_id']
  static fieldsets = {
    identity: { title: 'Project Identity', fields: ['name', 'status', 'category_id'] }
  }
}

export class ProjectPrompt extends BasePrompt {
  getDefaultFormState() {
    return { name: '', status: 'planning', category_id: null }
  }
}
```

```ts file=src/prompts/project-prompt.ts
import { BaseAppForm } from '@mcp-rune/mcp-rune/apps'
import { BasePrompt } from '@mcp-rune/mcp-rune/prompts'

export class ProjectForm extends BaseAppForm {
  static fields = ['name', 'status', 'category_id']
  static fieldsets = {
    identity: { title: 'Project Identity', fields: ['name', 'status', 'category_id'] }
  }
}

export class ProjectPrompt extends BasePrompt {
  getDefaultFormState() {
    return { name: '', status: 'planning', category_id: null }
  }
}
```

### Step 3: Register in App Registry

One `modelClasses` entry in `createDefaultAppRegistry` is the whole registration:

```js file=examples/mcp-apps-architecture-12.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

import { Project } from '../models/project.js'
import { ProjectForm, ProjectPrompt } from '../prompts/project-prompt.js'

const appRegistry = createDefaultAppRegistry({
  modelClasses: { book: Book, project: Project }, // ← the one required entry
  formClasses: { project: ProjectForm }, // optional — synthesized when omitted
  promptClasses: { project: ProjectPrompt }, // optional — form defaults
  namespace: 'bookshelf'
})
// find_model_app routing is derived automatically: models with filters declared
// via `searchConfig({ filters: ... })` in their `extensions['search']` slice get
// the Filters popover; models declaring `query` honor text search.
```

```ts file=examples/mcp-apps-architecture-12.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

import { Project } from '../models/project.js'
import { ProjectForm, ProjectPrompt } from '../prompts/project-prompt.js'

const appRegistry = createDefaultAppRegistry({
  modelClasses: { book: Book, project: Project }, // ← the one required entry
  formClasses: { project: ProjectForm }, // optional — synthesized when omitted
  promptClasses: { project: ProjectPrompt }, // optional — form defaults
  namespace: 'bookshelf'
})
// find_model_app routing is derived automatically: models with filters declared
// via `searchConfig({ filters: ... })` in their `extensions['search']` slice get
// the Filters popover; models declaring `query` honor text search.
```

### Step 4: There Is No Build Step

That's it — the seven generic apps ship prebuilt in the npm package, so all of them (create, update, find, detail, pickers, selection) now work with the new model. Zero new HTML. Boot validation runs inside `createDefaultAppRegistry`, so a typo'd form field, an unknown attribute kind, or an enum without values fails at server start with a formatted report — not at request time.

---

## 13. Dependencies

| Package | Purpose |
| --- | --- |
| `@modelcontextprotocol/ext-apps` | MCP Apps protocol (App class, registerAppTool/registerAppResource) |
| `@modelcontextprotocol/sdk` | Core MCP protocol (McpServer, types) |
| `vite` | Build tool for single-file HTML (framework build only) |
| `vite-plugin-singlefile` | Inlines CSS/JS into single HTML (framework build only) |
| `zod` | Input schema validation |

Exact versions live in the root `package.json` — the table above tracks purpose, not pins.

---

## 14. Design Decisions

### MCP Server as Source of Truth

The MCP server owns all metadata — field kinds, validations, grouping, labels, filter definitions. The backend API provides data, not structure. This keeps the MCP server decoupled from the backend's internal implementation.

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

#### Strategy B: Paired Data Tool (display-only tools)

For tools where the LLM does NOT need the data (e.g., workflow panel, dashboards), the framework pairs two tools: an LLM-visible app tool that returns only a summary, and a `visibility: ['app']` data tool the iframe calls for the full payload. App-initiated `callServerTool` results do **not** enter the LLM context, and the `['app']` visibility keeps the data tool out of the LLM's tool list entirely.

**Server-side** — `createWorkflowPanelApp` returns the `[panelApp, dataApp]` pair:

```js file=examples/mcp-apps-architecture-16.js
const panelApp = {
  toolName: 'workflow_panel_app',
  resourceUri: `ui://${namespace}/workflow-panel-app`,
  // LLM-initiated: minimal summary only
  handleToolCall() {
    return Promise.resolve({
      content: [
        { type: 'text', text: `Workflow panel displayed with ${workflows.length} workflows.` }
      ]
    })
  },
  getHtml
}

const dataApp = {
  toolName: 'workflow_panel_app_data',
  visibility: ['app'], // never offered to the LLM; no resourceUri — tool only
  // App-initiated: full data, invisible to the LLM
  handleToolCall() {
    return Promise.resolve({
      content: [{ type: 'text', text: JSON.stringify({ workflows }) }]
    })
  }
}
```

```ts file=examples/mcp-apps-architecture-16.ts
const panelApp = {
  toolName: 'workflow_panel_app',
  resourceUri: `ui://${namespace}/workflow-panel-app`,
  // LLM-initiated: minimal summary only
  handleToolCall() {
    return Promise.resolve({
      content: [
        { type: 'text', text: `Workflow panel displayed with ${workflows.length} workflows.` }
      ]
    })
  },
  getHtml
}

const dataApp = {
  toolName: 'workflow_panel_app_data',
  visibility: ['app'], // never offered to the LLM; no resourceUri — tool only
  // App-initiated: full data, invisible to the LLM
  handleToolCall() {
    return Promise.resolve({
      content: [{ type: 'text', text: JSON.stringify({ workflows }) }]
    })
  }
}
```

**Client-side** — the iframe fetches from the data tool at connect time:

```js file=src/response.js
const response = await app.callServerTool({
  name: 'workflow_panel_app_data',
  arguments: {}
})
const data = JSON.parse(response.content.find((c) => c.type === 'text').text)
renderWorkflows(data.workflows)
```

```ts file=src/response.ts
const response = await app.callServerTool({
  name: 'workflow_panel_app_data',
  arguments: {}
})
const data = JSON.parse(response.content.find((c) => c.type === 'text').text)
renderWorkflows(data.workflows)
```

### Summary Block Guidelines

- State the count or summary of what was displayed
- Include "Do not repeat or summarize the data" to prevent the LLM from echoing JSON
- Mention interactive capabilities (selection, card clicks, pagination)
- Keep to 1-3 sentences — the goal is minimal LLM context overhead

### Apps by Strategy

| Strategy | App | LLM Context |
| --- | --- | --- |
| A (two-block) | `find_model_app` | JSON + record count + filter/query summary |
| A (two-block) | `view_selection_app` | JSON + selection state + management hint |
| B (paired data tool) | `workflow_panel_app` | Summary only; data via `workflow_panel_app_data` (`visibility: ['app']`) |
