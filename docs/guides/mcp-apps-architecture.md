# MCP Apps Architecture Guide

A deep reference for the interactive UI system built on the `@modelcontextprotocol/ext-apps` extension protocol.

---

## 1. What Are MCP Apps?

MCP Apps are sandboxed HTML applications rendered inside MCP clients (Claude Desktop, COC, MCP Inspector). They provide visual, interactive interfaces — forms, tables, detail cards, search views — that communicate bidirectionally with the MCP server over the MCP protocol.

Unlike traditional web apps, MCP Apps have no server of their own. They are **single-file HTML bundles** served as MCP resources and controlled entirely by MCP tool calls.

### Core Primitives

Every MCP App is composed of two MCP primitives:

| Primitive    | Purpose                           | Example                    |
| ------------ | --------------------------------- | -------------------------- |
| **Tool**     | LLM calls this to launch/interact | `create_model_form`        |
| **Resource** | Client fetches HTML from this URI | `ui://engineer/model-form` |

The tool declares its UI resource via `_meta.ui.resourceUri`. When the LLM calls the tool, the MCP client:

1. Fetches the HTML resource
2. Renders it in a sandboxed iframe
3. Delivers the tool result to the app via `ontoolresult`

---

## 2. System Architecture

### High-Level Flow

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
│  │    → callServerTool('list_records_app', {...})   │   │
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
│    ├── create_model_form  → ui://engineer/model-form  │
│    ├── update_model_form  → ui://engineer/model-form  │
│    ├── list_records_app     → ui://engineer/list-records-view│
│    ├── view_record        → ui://engineer/record-detail│
│    └── search_records_app→ ui://engineer/search-view  │
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

## 3. The Five Apps

### App Catalog

| App            | Tool Name            | Resource URI                      | Auth | Purpose                                   |
| -------------- | -------------------- | --------------------------------- | ---- | ----------------------------------------- |
| Create Form    | `create_model_form`  | `ui://engineer/model-form`        | Yes  | Interactive form to create records        |
| Update Form    | `update_model_form`  | `ui://engineer/model-form`        | Yes  | Interactive form to edit records          |
| Browse Records | `list_records_app`   | `ui://engineer/list-records-view` | Yes  | Paginated table with text search          |
| Record Detail  | `view_record`        | `ui://engineer/record-detail`     | Yes  | Read-only detail card for a single record |
| Search Results | `search_records_app` | `ui://engineer/search-view`       | Yes  | Filtered search with active filter chips  |

Note: Create Form and Update Form share the same HTML resource (`model-form.html`) — the mode is determined by the tool result data.

### App Data Flows

#### Create Form

```
User: "Create a book"
  ↓
LLM calls create_model_form({ model: 'book' })
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
LLM calls update_model_form({ model: 'book', record_id: 'abc-123' })
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

#### Browse Records

```
User: "Show me all books"
  ↓
LLM calls list_records_app({ model: 'book' })
  ↓
Server:
  1. generateListSchema(Book) → { columns, searchFields }
  2. apiClient.get('books', { page: 1 }) → records
  ↓
Returns: { schema, records, pagination }
  ↓
App renders table → Row click → callServerTool('update_model_form')
                  → Search → callServerTool('list_records_app', { search })
                  → Paginate → callServerTool('list_records_app', { page })
```

#### Record Detail

```
User: "Show book abc-123"
  ↓
LLM calls view_record({ model: 'book', id: 'abc-123' })
  ↓
Server:
  1. generateDetailSchema(Book, BookPrompt?) → { fields, fieldsets? }
  2. apiClient.get('books/abc-123') → record
  ↓
Returns: { schema, record }
  ↓
App renders read-only detail card with sections, badges, stars
```

#### Search Results

```
User: "Find active titles by licensor X"
  ↓
LLM calls get_filters_guide({ model: 'title' }) → learns filters
LLM calls search_records({ model: 'title', filters: { status: 'active', licensor_id: 'X' } })
LLM calls search_records_app({ model: 'title', filters: { status: 'active', licensor_id: 'X' } })
  ↓
Server:
  1. generateListSchema(Title) → { columns }
  2. apiClient.post('titles/search', { filters, page }) → records
  3. Title.filters → filterDefinitions
  ↓
Returns: { schema, records, pagination, activeFilters, filterDefinitions }
  ↓
App renders:
  - Filter chips (removable tags: "Status: Active", "Licensor: X")
  - Results table
  - Pagination (preserves filters across pages)
  - Remove chip → re-search without that filter
```

---

## 4. Schema Generation Layer

Schema generators are **pure functions** — no API calls, no side effects. They transform model/prompt configuration into JSON schemas that the client-side app renders dynamically.

### Schema Generators

| Generator                | Input                     | Output                                    | Used By                     |
| ------------------------ | ------------------------- | ----------------------------------------- | --------------------------- |
| `generateFormSchema()`   | ModelClass + PromptClass  | `{ model, title, fieldsets, fields }`     | Create/Update Form          |
| `generateListSchema()`   | ModelClass                | `{ model, title, columns, searchFields }` | Browse Records, Search View |
| `generateDetailSchema()` | ModelClass + PromptClass? | `{ model, title, fields, fieldsets? }`    | Record Detail               |

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

```javascript
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

```javascript
// AppRegistry.registerTools():
if (app.needsAuth && getAccessToken && this._apiUrl) {
  const token = await getAccessToken()
  context.apiClient = createApiClient(token, { apiUrl: this._apiUrl })
}
return app.handleToolCall(args, context)
```

The `getAccessToken` function comes from the OAuth2 session — it returns the current user's valid access token (refreshing if needed).

### Resource Deduplication

Multiple tools can share the same HTML resource. For example, `create_model_form` and `update_model_form` both use `ui://engineer/model-form`. The registry deduplicates by tracking registered URIs:

```javascript
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

```javascript
const FORM_MODEL_CLASSES = { activity: Activity, book: Book, ... }
const FORM_PROMPT_CLASSES = { activity: ActivityPrompt, book: BookPrompt, ... }
// Browse view excludes models with static filters (those go to search view only):
const LIST_VIEW_MODELS = Object.fromEntries(
  Object.entries(FORM_MODEL_CLASSES).filter(([, M]) =>
    !M.filters || Object.keys(M.filters).length === 0
  )
)

// Search view includes only models with static filters:
const SEARCH_VIEW_MODELS = Object.fromEntries(
  Object.entries(FORM_MODEL_CLASSES).filter(([, M]) =>
    M.filters && Object.keys(M.filters).length > 0
  )
)
```

---

## 6. Client-Side Architecture

### App Connection Pattern

All client-side apps follow the same initialization pattern:

```javascript
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

| App            | State Variables                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Model Form     | `formSchema`, `currentMode`, `recordId`                                                          |
| Browse Records | `listSchema`, `currentRecords`, `currentPage`, `modelName`                                       |
| Record Detail  | `detailSchema`, `record`                                                                         |
| Search View    | `listSchema`, `currentRecords`, `currentPage`, `modelName`, `activeFilters`, `filterDefinitions` |

### Dynamic Rendering

The model form app dynamically creates HTML elements from the schema:

```javascript
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

Table-based apps (list_records_app, search_records_app) paginate by calling their own tool:

```javascript
async function fetchPage(page) {
  await app.callServerTool({
    name: 'list_records_app', // or 'search_records_app'
    arguments: { model: modelName, page, ...extraArgs }
  })
  // ontoolresult fires → re-renders table
}
```

The search view preserves `activeFilters` across pagination calls.

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

```javascript
// src/engineer/apps/vite.config.js
const configs = {
  'model-form': { root: 'model-form-ui', outFile: 'model-form.html' },
  'list-view': { root: 'list-view-ui', outFile: 'list-view.html' },
  'record-detail': { root: 'record-detail-ui', outFile: 'record-detail.html' },
  'search-view': { root: 'search-view-ui', outFile: 'search-view.html' },
  'create-book': { root: 'create-book-ui', outFile: 'create-book.html' }
}
```

### Build Command

```bash
npm run build:engineer:apps
```

This runs sequentially for each target:

```
BUILD_TARGET=model-form vite build
BUILD_TARGET=list-view vite build
BUILD_TARGET=record-detail vite build
BUILD_TARGET=search-view vite build
BUILD_TARGET=create-book vite build
```

Output goes to `src/engineer/apps/dist/` (git-tracked).

### HTML Caching

At runtime, each app reads its HTML once from disk and caches it:

```javascript
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

```
lib/mcp/apps/                          # Schema generators (shared across servers)
├── form-schema.js                     # generateFormSchema() — pure function
├── list-schema.js                     # generateListSchema() — pure function
└── detail-schema.js                   # generateDetailSchema() — pure function

src/engineer/apps/                     # Engineer server apps
├── index.js                           # AppRegistry + createAppRegistry()
│
├── model-form.js                      # Create/Update form factory
├── model-form-ui/                     # Form client-side
│   ├── index.html
│   ├── app.js                         # Dynamic form renderer
│   └── styles.css
│
├── list-view.js                       # Browse records factory
├── list-view-ui/                      # List client-side
│   ├── index.html
│   ├── app.js                         # Table renderer with search/pagination
│   └── styles.css
│
├── record-detail.js                   # Record detail factory
├── record-detail-ui/                  # Detail client-side
│   ├── index.html
│   ├── app.js                         # Sectioned detail card renderer
│   └── styles.css
│
├── search-view.js                     # Search results factory
├── search-view-ui/                    # Search client-side
│   ├── index.html
│   ├── app.js                         # Filter chips + table + pagination
│   └── styles.css
│
├── create-book.js                     # Custom app example
├── create-book-ui/                    # Custom app client-side
│   ├── index.html
│   ├── app.js
│   └── styles.css
│
├── vite.config.js                     # Multi-target build config
└── dist/                              # Built single-file HTML (git-tracked)
    ├── model-form.html
    ├── list-view.html
    ├── record-detail.html
    ├── search-view.html
    └── create-book.html
```

---

## 9. App Definition Contract

Every app (generic or custom) is a plain object with these properties:

| Property          | Type       | Required | Description                                   |
| ----------------- | ---------- | -------- | --------------------------------------------- |
| `resourceUri`     | `string`   | Yes      | MCP resource URI (e.g., `ui://engineer/...`)  |
| `toolName`        | `string`   | Yes      | MCP tool name (e.g., `create_model_form`)     |
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
   → Usage rule hints: "call search_records_app to display visually"

4. LLM calls search_records_app({ model, filters })  [app tool, auth required]
   → Renders visual table with filter chips in the host
```

### Tool Precedence

- `search_records` is the **preferred** tool for models with `filterable_search`
- `find_records` usage rules direct LLM to prefer `search_records` for filterable models
- `find_records` remains the tool for ID lookups and simple text search on non-filterable models

### Search View vs Browse Records

| Aspect        | `list_records_app`                       | `search_records_app`                  |
| ------------- | ---------------------------------------- | ------------------------------------- |
| Data source   | GET `{endpoint}`                         | POST `{endpoint}/search`              |
| Input         | `model`, `search?`, `page?`              | `model`, `filters`, `page?`           |
| Filtering     | Single text search field                 | Multi-criteria ES filters             |
| UI            | Search input + table                     | Filter chips + table                  |
| Available for | Only models **without** `static filters` | Only models **with** `static filters` |

---

## 12. Adding a New Model to Apps

### Step 1: Model Configuration

Ensure the model has `attributes`, `endpoint`, and optionally `associations`:

```javascript
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

```javascript
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

```javascript
import { Project } from '../models/project.js'
import { ProjectPrompt } from '../prompts/project_prompt.js'

const FORM_MODEL_CLASSES = { ..., project: Project }
const FORM_PROMPT_CLASSES = { ..., project: ProjectPrompt }
// LIST_VIEW_MODELS and SEARCH_VIEW_MODELS are derived automatically from FORM_MODEL_CLASSES.
// Models with `static filters` go to search view; models without go to browse view.
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

### Separate Search App

Search results use a dedicated app (`search_records_app`) rather than overloading `list_records_app`. The split is structural — models with `static filters` are **only** available in `search_records_app`, models without filters are only in `list_records_app`. This eliminates routing ambiguity at the schema level.

### Conditional Registration

The search view app is only registered when models with `static filters` exist. This avoids exposing a non-functional tool:

```javascript
if (Object.keys(SEARCH_VIEW_MODELS).length > 0) {
  apps.push(createSearchViewApp({ modelClasses: SEARCH_VIEW_MODELS }))
}
```

## 15. Tool Response Pattern: UI Data vs LLM Context

When an MCP App tool returns `{ content: [...] }`, the host delivers **all** content blocks to the LLM conversation context. If the tool returns full JSON (records, schemas, workflow definitions), that entire payload ends up in the LLM context — even though the user already sees the data rendered in the app UI.

### Two Strategies

#### Strategy A: Two-Block Response (data tools)

For tools where the LLM needs the data for follow-up (e.g., record lists, search results), return two blocks:

| Block            | Audience         | Content                                           |
| ---------------- | ---------------- | ------------------------------------------------- |
| 1st `text` block | UI app + LLM     | Full JSON payload: schema, records, metadata      |
| 2nd `text` block | LLM context only | Minimal summary: count, status, interaction hints |

```javascript
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

```javascript
const data = JSON.parse(result.content.find((c) => c.type === 'text').text)
```

#### Strategy B: App-Initiated Data Fetch (display-only tools)

For tools where the LLM does NOT need the data (e.g., workflow panel, dashboards), return only a summary from the tool and have the app fetch data via `callServerTool`. App-initiated `callServerTool` results do **not** enter the LLM context.

**Server-side** — branch on an internal `action` parameter:

```javascript
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

```javascript
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
| A (two-block) | `list_records_app`   | JSON + record count + selection hint        |
| A (two-block) | `search_records_app` | JSON + record count + filter summary        |
| B (app-fetch) | `workflow_panel`     | Summary only (N workflows, click to launch) |
