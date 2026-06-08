# MCP apps

This is the first chapter of the Apps section. Apps consume the same three layers Tools do (`DataLayer`, `ModelLayer`, `AnalysisLayer` from [chapter 4](../04-tools/the-three-layers.md)) plus a small bidirectional message protocol that lets a sandboxed iframe call back to the server. Once you understand how the protocol works, the next chapter shows how the framework wires it; the chapter after that covers `BaseAppForm` for when the default synthesized form needs customization.

MCP Apps are interactive HTML user interfaces that render inside MCP clients (Claude Desktop, COC, MCP Inspector). They use the `@modelcontextprotocol/ext-apps` extension protocol to communicate bidirectionally with the MCP server.

## Architecture Overview

<!-- illustration: mcp-apps-guide#overview -->

```
┌─ MCP Client (Claude Desktop, COC) ──────────┐
│                                               │
│  ┌─ Sandboxed iframe ──────────────────────┐  │
│  │  MCP App HTML/JS/CSS                    │  │
│  │                                          │  │
│  │  ← ontoolinput (prefill data)           │  │
│  │  ← ontoolresult (schema + defaults)     │  │
│  │  ← onhostcontextchanged (theme)         │  │
│  │                                          │  │
│  │  → callServerTool('validate_form', ...)  │  │
│  │  → callServerTool('create_model', ...)   │  │
│  └──────────────────────────────────────────┘  │
│                                               │
└───────────────────────────────────────────────┘
                    ↕ MCP protocol
┌─ MCP Server ─────────────────────────────────┐
│                                               │
│  Tool: create_book                            │
│    → handleToolCall(args, { apiClient })      │
│    → Returns: { schema, defaults }            │
│                                               │
│  Resource: ui://engineer/create-book          │
│    → Returns: single-file HTML                │
│                                               │
└───────────────────────────────────────────────┘
```

## How MCP Apps Work

### 1. Tool + Resource Registration

Each MCP App consists of two MCP primitives:

- **Tool**: The LLM calls this tool to launch the app (e.g., `create_book`)
- **Resource**: The client fetches HTML from this URI (e.g., `ui://engineer/create-book`)

The tool declares its UI resource via `_meta.ui.resourceUri`, which tells the MCP client to render the HTML in an iframe when the tool is called.

### 2. Protocol Flow

The same HTML app handles both create and update — the mode is determined by the tool result data.

**Create flow:**

```
User: "Create a book"
  ↓
LLM calls create_book_form tool
  ↓
MCP Server: handleToolCall() → returns { schema, defaults, mode: 'create' }
  ↓
App renders empty form with defaults → User fills → create_model
```

**Update flow:**

```
User: "Edit book abc-123"
  ↓
LLM calls update_book_form tool with record_id
  ↓
MCP Server: handleToolCall() → fetches existing record → returns { schema, defaults, mode: 'update', recordId }
  ↓
App renders pre-filled form → User edits → update_model with record_id
```

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
│  Book.attributes         → field types, validations, enums │
│  Book.associations       → which fields need API options   │
│  BookPrompt.fieldGroups  → field grouping (fieldsets)       │
│  BookPrompt.sections     → section titles, ordering        │
│                                                            │
│  generateFormSchema()    → JSON schema (pure, no API)      │
│       │                                                    │
│       │  For association fields only:                      │
│       │  apiClient.get('/locations') → select options      │
│       │  apiClient.get('/tags')      → multiselect options │
│                                                            │
└────────────────────────────────────────────────────────────┘
              ↓ JSON via ontoolresult
┌─ Generic Form MCP App ────────────────────────────────────┐
│  Receives schema → dynamically renders form               │
│  Validates via callServerTool('validate_form')            │
│  Submits via callServerTool('create_model')               │
└────────────────────────────────────────────────────────────┘
```

### Why Schema-Driven?

The MCP server **already has** all metadata needed to render a form:

| What's needed       | Where it lives                 | Example                                      |
| ------------------- | ------------------------------ | -------------------------------------------- |
| Field types, labels | `Model.attributes`             | `title: { type: 'string', label: 'Title' }`  |
| Enum options        | `Model.attributes`             | `status: { enumValues: ['unread', ...] }`    |
| Validations         | `Model.attributes`             | `rating: { validation: { min: 1, max: 5 } }` |
| Field grouping      | `Prompt.fieldGroups`           | `identity: { fields: ['title', 'author'] }`  |
| Section titles      | `Prompt.sections`              | `identity: { title: 'Book Identity' }`       |
| Defaults            | `Prompt.getDefaultFormState()` | `{ status: 'unread' }`                       |
| Associations        | `Model.associations`           | `belongsTo: { location }`                    |

The **only** thing from the Rails API is association option values (the user's locations, tags) — fetched at form-open time with the user's access token.

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

| Schema Type      | HTML Rendered             | Source                                     |
| ---------------- | ------------------------- | ------------------------------------------ |
| `text`           | `<input type="text">`     | `type: 'string'`                           |
| `number`         | `<input type="number">`   | `type: 'integer'` or `type: 'number'`      |
| `url`            | `<input type="url">`      | `format: 'URL'`                            |
| `date`           | `<input type="date">`     | `type: 'date'`                             |
| `textarea`       | `<textarea>`              | `type: 'text'`                             |
| `select`         | `<select>`                | `type: 'enum'` or `belongsTo` association  |
| `multiselect`    | Checkbox list             | `type: 'array'` with `hasMany` association |
| `checkbox_group` | Checkbox group            | `type: 'array'` with `enumValues`          |
| `checkbox`       | `<input type="checkbox">` | `type: 'boolean'`                          |
| `file`           | Skipped                   | `format: 'base64'`                         |

## Adding a New Model Form

Adding a form for a new model requires **zero new HTML** — just one entry in the app registry. Both create and update forms are generated automatically.

### Step 1: Ensure Model Has Attributes and Associations

```js file=src/project.js
// src/engineer/models/project.js
export class Project extends BaseModel {
  static api = { endpoint: 'projects' }

  static associations = {
    belongsTo: {
      category: { rel: 'category', target_model: 'category' }
    }
  }

  static attributes = {
    name: {
      type: 'string',
      required: true,
      description: 'Project name',
      examples: ['My App']
    },
    status: {
      type: 'enum',
      enumValues: ['planning', 'active', 'completed'],
      default: 'planning',
      description: 'Project status'
    },
    category_id: {
      type: 'integer',
      label: 'Category',
      description: 'Category this project belongs to'
    }
    // ...
  }
}
```

```ts file=src/project.ts
// src/engineer/models/project.js
export class Project extends BaseModel {
  static api = { endpoint: 'projects' }

  static associations = {
    belongsTo: {
      category: { rel: 'category', target_model: 'category' }
    }
  }

  static attributes = {
    name: {
      type: 'string',
      required: true,
      description: 'Project name',
      examples: ['My App']
    },
    status: {
      type: 'enum',
      enumValues: ['planning', 'active', 'completed'],
      default: 'planning',
      description: 'Project status'
    },
    category_id: {
      type: 'integer',
      label: 'Category',
      description: 'Category this project belongs to'
    }
    // ...
  }
}
```

### Step 2: Ensure Prompt Has fieldGroups and sections

```js file=src/prompts/project-prompt.js
// src/engineer/prompts/project_prompt.js
export class ProjectPrompt extends BasePrompt {
  static strategy = 'hybrid'
  static title = 'Create Project'

  static fieldGroups = {
    identity: {
      fields: ['name', 'status', 'category_id'],
      context: 'Project Identity'
    }
  }

  static sections = {
    identity: {
      title: 'Project Identity',
      groups: ['identity'],
      required: true
    }
  }

  getDefaultFormState() {
    return { name: '', status: 'planning', category_id: null }
  }
}
```

```ts file=src/prompts/project-prompt.ts
// src/engineer/prompts/project_prompt.js
export class ProjectPrompt extends BasePrompt {
  static strategy = 'hybrid'
  static title = 'Create Project'

  static fieldGroups = {
    identity: {
      fields: ['name', 'status', 'category_id'],
      context: 'Project Identity'
    }
  }

  static sections = {
    identity: {
      title: 'Project Identity',
      groups: ['identity'],
      required: true
    }
  }

  getDefaultFormState() {
    return { name: '', status: 'planning', category_id: null }
  }
}
```

### Step 3: Register in App Registry

Add an entry to `MODEL_FORM_CONFIGS` in `src/engineer/apps/index.js`. Both `create_project_form` and `update_project_form` tools are generated automatically:

```js file=examples/mcp-apps-guide-03.js
// src/engineer/apps/index.js — MODEL_FORM_CONFIGS array
{
  ModelClass: Project,
  PromptClass: ProjectPrompt,
  slug: 'project',
  prefillSchema: {
    name: z.string().describe('Pre-fill the project name').optional()
  }
}
```

```ts file=examples/mcp-apps-guide-03.ts
// src/engineer/apps/index.js — MODEL_FORM_CONFIGS array
{
  ModelClass: Project,
  PromptClass: ProjectPrompt,
  slug: 'project',
  prefillSchema: {
    name: z.string().describe('Pre-fill the project name').optional()
  }
}
```

### Step 4: Register in Prompt Registry

```js file=examples/mcp-apps-guide-04.js
// src/engineer/prompts/registry.js
create_project: {
  promptClass: ProjectPrompt,
  model: 'project',
  toolDocDescription: 'For creating projects',
  appToolName: 'create_project_form'  // Links prompt to MCP App
}
```

```ts file=examples/mcp-apps-guide-04.ts
// src/engineer/prompts/registry.js
create_project: {
  promptClass: ProjectPrompt,
  model: 'project',
  toolDocDescription: 'For creating projects',
  appToolName: 'create_project_form'  // Links prompt to MCP App
}
```

### Step 5: Rebuild

```bash
npm run build:engineer:apps
```

That's it. The generic form app handles the rest — fieldsets, validation, submission, theming.

## File Structure

<!-- illustration: mcp-apps-guide#tree2 -->

```
src/mcp/apps/
├── new-model-app/              # Create-record form
│   ├── index.ts                # Factory + handleToolCall (server)
│   └── ui/                     # Thin shim → shared/model-form/main.js
│       ├── index.html
│       └── app.js
├── edit-model-app/             # Edit-record form (mirrors new-model-app)
│   ├── index.ts
│   └── ui/
├── find-model-app/             # Browseable table — query + filter popover + selection
│   ├── index.ts
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
├── lib/                        # Shared server-side helpers
│   ├── app-form-schema.ts      # generateFormSchema() — pure function
│   ├── list-schema.ts          # generateListSchema() — list/table schema
│   ├── detail-schema.ts        # generateDetailSchema() — record detail schema
│   ├── form-app-helpers.ts     # Shared helpers for new/edit form factories
│   ├── selection-store.ts      # SelectionStore — session-scoped Map
│   ├── selection-tools.ts      # createSelectionTools() — per-app selection
│   ├── registry.ts             # AppRegistry + createAppRegistry
│   └── …                       # types, helpers, formatters, etc.
├── shared/                     # Shared client-side JS/CSS for ui/ folders
│   ├── base.css, app-init.js, helpers.js, formatters.{js,runtime.js}, …
│   └── model-form/             # Shared form UI consumed by new + edit
│       ├── main.js             # initModelFormApp() — bulk of form code
│       └── styles.css
├── vite.config.js              # Build config (multi-target single-file HTML)
└── dist/                       # Built outputs (one HTML per app)
    ├── new-model-app.html
    ├── edit-model-app.html
    ├── find-model-app.html
    ├── show-model-app.html
    ├── view-selection-app.html
    ├── pick-model-app.html
    └── multi-pick-model-app.html
```

## Key Components

### `generateFormSchema(ModelClass, PromptClass)` — `src/mcp/apps/lib/app-form-schema.ts`

Pure function that generates a form schema from model attributes and prompt configuration. No API calls, no side effects.

**Input:** Model class + Prompt class
**Output:** `{ model, title, fieldsets, fields }`

Maps model attribute types to form field types, resolves association metadata, preserves validation rules and defaults.

### `createNewModelApp(options)` / `createEditModelApp(options)` — `src/mcp/apps/{new,edit}-model-app/index.ts`

Two factory functions, one per tool, that produce MCP App definitions:

- `resourceUri` — MCP resource URI for the HTML (`ui://{ns}/new-model-app` / `…/edit-model-app`)
- `toolName` — MCP tool name (`new_model_app` / `edit_model_app`)
- `handleToolCall(args, { dataLayer })` — Generates schema + fetches association options
- `getHtml()` — Returns the built single-file HTML for that app

**`new_model_app`**: builds defaults from `PromptClass.getDefaultFormState()`, merges pre-fill args, resolves a parent-context banner when nested.
**`edit_model_app`**: fetches the existing record from the API via `record_id`, uses record data as defaults.

Both bundles wrap the same `src/mcp/apps/shared/model-form/main.js` client module, so they render identical UI. The runtime mode (`'create'` / `'update'`) is set from the server's tool result, not from the bundle.

### `AppRegistry` — `src/engineer/apps/index.js`

Registry that manages app registrations. Key methods:

- `registerTools(mcpServer, { getAccessToken })` — Registers tool handlers with auth context
- `registerResources(mcpServer)` — Registers HTML resources

For apps with `needsAuth: true`, the registry creates an authenticated API client from the session's access token and passes it to `handleToolCall`.

### Client-side App — `src/mcp/apps/shared/model-form/main.js`

Generic form renderer (called by both `new-model-app/ui/app.js` and `edit-model-app/ui/app.js`) that:

1. Receives schema via `ontoolresult`
2. Dynamically creates fieldsets and fields based on schema
3. Handles all field types (text, number, select, multiselect, checkbox_group, etc.)
4. Validates via `callServerTool('validate_form')`
5. Submits via `callServerTool('create_model')`
6. Applies host theme via `applyDocumentTheme()` and `applyHostStyleVariables()`

## Building

MCP Apps are built into single-file HTML bundles using Vite + `vite-plugin-singlefile`:

```bash
# Build engineer apps
npm run build:engineer:apps

# Build diagrams apps
npm run build:diagrams:apps
```

The build inlines all CSS and JavaScript into a single `dist/index.html` file, which is read by the server at module load time and served via the MCP resources protocol.

**Important:** After modifying any file in `shared/model-form/` (or in a per-app `ui/` folder), you must rebuild before the changes take effect.

## Theming

MCP Apps receive theme information from the host via `onhostcontextchanged`. The CSS uses `light-dark()` with distinct values for each color scheme:

```css
:root {
  color-scheme: light dark;
  --color-text-primary: light-dark(#2c2c2c, #d4d4d4);
  --color-background-primary: light-dark(#f5f2ed, #1c1c1e);
  --color-accent: #c4704b;
  --surface: light-dark(#eae6df, #2a2a2c);
  --border: light-dark(#d1ccc4, #3a3a3c);
  --input-bg: light-dark(#ffffff, #2a2a2c);
  /* ... */
}
```

The palette uses warm parchment cream for light mode and neutral dark grays for dark mode, with a terracotta accent (`#c4704b`) that complements Claude Desktop's aesthetic. The host can further override these variables via `applyHostStyleVariables()`.

## Integration with Prompts

MCP Apps are linked to prompts via the `appToolName` property in the prompt registry:

```js file=examples/mcp-apps-guide-05.js
// prompts/registry.js
create_book: {
  promptClass: BookPrompt,
  model: 'book',
  appToolName: 'create_book_form'  // Links to MCP App tool
}
```

```ts file=examples/mcp-apps-guide-05.ts
// prompts/registry.js
create_book: {
  promptClass: BookPrompt,
  model: 'book',
  appToolName: 'create_book_form'  // Links to MCP App tool
}
```

When a user asks to create a model, the `get_prompt_guide` tool checks `getAppEnabledPrompts()` and offers three options:

1. **Interactive Form** → Calls the MCP App tool (e.g., `create_book`)
2. **Guided** → Uses the prompt system for step-by-step LLM guidance
3. **Quick** → Minimal prompt, direct creation

## Dependencies

| Package                          | Version | Purpose                                       |
| -------------------------------- | ------- | --------------------------------------------- |
| `@modelcontextprotocol/ext-apps` | ^1.2.0  | MCP Apps protocol (App class, server helpers) |
| `@modelcontextprotocol/sdk`      | ^1.25.1 | Core MCP protocol (McpServer, types)          |
| `vite`                           | ^7.3.1  | Build tool for single-file HTML               |
| `vite-plugin-singlefile`         | ^2.3.0  | Inlines CSS/JS into single HTML               |
| `zod`                            | ^4.2.1  | Input schema validation                       |

## Building a Custom (Hardcoded) MCP App

The generic schema-driven approach handles most model forms. However, if you need a fully custom UI — unique layout, specialized interactions, non-CRUD workflows — you can build a hardcoded MCP App from scratch. Below is a reference based on the original `create_book` app (before it was replaced by the generic form).

### Server-Side: App Definition

A custom app is a plain object with `handleToolCall` and `getHtml`. No schema generation — you control everything.

```js file=src/get-html.js
// src/engineer/apps/custom-example.js
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
    resourceUri: 'ui://engineer/custom-tool',
    toolName: 'custom_tool',
    name: 'Custom Tool',
    description: 'A fully custom interactive UI',
    toolDescription: 'Show a custom interactive form.',
    needsAuth: false, // set true if handleToolCall needs apiClient

    toolInputSchema: {
      title: z.string().describe('Pre-fill the title').optional()
    },

    handleToolCall(args = {}) {
      // Return whatever JSON your client-side app expects
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              model: 'custom',
              defaults: { title: args.title || '' },
              statusOptions: ['draft', 'published'],
              formatOptions: ['html', 'pdf']
            })
          }
        ]
      }
    },

    getHtml
  }
}
```

```ts file=src/get-html.ts
// src/engineer/apps/custom-example.js
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
    resourceUri: 'ui://engineer/custom-tool',
    toolName: 'custom_tool',
    name: 'Custom Tool',
    description: 'A fully custom interactive UI',
    toolDescription: 'Show a custom interactive form.',
    needsAuth: false, // set true if handleToolCall needs apiClient

    toolInputSchema: {
      title: z.string().describe('Pre-fill the title').optional()
    },

    handleToolCall(args = {}) {
      // Return whatever JSON your client-side app expects
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              model: 'custom',
              defaults: { title: args.title || '' },
              statusOptions: ['draft', 'published'],
              formatOptions: ['html', 'pdf']
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

```js file=src/prefill-form.js
// src/engineer/apps/custom-ui/app.js
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts
} from '@modelcontextprotocol/ext-apps'

const app = new App({ name: 'Custom Tool', version: '1.0.0' })

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

// Validate via MCP tool
document.getElementById('btn-validate').addEventListener('click', async () => {
  const fields = collectFormData()
  const result = await app.callServerTool({
    name: 'validate_form',
    arguments: { model: 'custom', fields }
  })
  // Handle validation result...
})

// Submit via MCP tool
document.getElementById('btn-submit').addEventListener('click', async () => {
  const fields = collectFormData()
  const result = await app.callServerTool({
    name: 'create_model',
    arguments: { model: 'custom', attributes: fields }
  })
  // Handle creation result...
})
```

```ts file=src/prefill-form.ts
// src/engineer/apps/custom-ui/app.js
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts
} from '@modelcontextprotocol/ext-apps'

const app = new App({ name: 'Custom Tool', version: '1.0.0' })

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

// Validate via MCP tool
document.getElementById('btn-validate').addEventListener('click', async () => {
  const fields = collectFormData()
  const result = await app.callServerTool({
    name: 'validate_form',
    arguments: { model: 'custom', fields }
  })
  // Handle validation result...
})

// Submit via MCP tool
document.getElementById('btn-submit').addEventListener('click', async () => {
  const fields = collectFormData()
  const result = await app.callServerTool({
    name: 'create_model',
    arguments: { model: 'custom', attributes: fields }
  })
  // Handle creation result...
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

Custom apps are registered the same way — add them to the `apps` array passed to `AppRegistry`:

```js file=src/apps/custom-app.js
// In createAppRegistry or similar
const customApp = createCustomApp()
const apps = [...modelFormApps, customApp]
return new AppRegistry(apps, { apiUrl })
```

```ts file=src/apps/custom-app.ts
// In createAppRegistry or similar
const customApp = createCustomApp()
const apps = [...modelFormApps, customApp]
return new AppRegistry(apps, { apiUrl })
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

| Function                                            | Purpose                                                  |
| --------------------------------------------------- | -------------------------------------------------------- |
| `getAvailableColumnNames(ModelClass)`               | Returns column name array for tool description inventory |
| `applyColumnSelection(schema, columns, ModelClass)` | Filters schema columns to requested subset with fallback |
| `generateListSchema(ModelClass)`                    | Generates full schema with all inferred columns          |
| `inferColumns(ModelClass)`                          | Determines which attributes become table columns         |

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

Four model-visible tools let the LLM read and edit the selection store directly. Each is shared across every app (registered once via `createSharedSelectionTools()` and deduplicated by `AppRegistry`).

| Tool                    | Schema                     | Behavior                                                                                                                |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `get_selection`         | `{ model? }`               | Reads the stored selection for one model, or every model when `model` is omitted.                                       |
| `add_to_selection`      | `{ model, ids: string[] }` | Unions IDs with the existing ids-mode selection. Errors when either side is filter-mode.                                |
| `remove_from_selection` | `{ model, ids: string[] }` | Drops IDs from the ids-mode selection. No-op for filter-mode. Removing every remaining ID clears the entry.             |
| `clear_selection`       | `{ model? }`               | Clears one model when `model` is supplied, every model when omitted.                                                    |
| `materialize_selection` | `{ model }`                | For a filter-mode entry, calls `dataLayer.searchNormalized` with the stored filters and rewrites the entry as ids-mode. |

`materialize_selection` is the bridge between the two modes — once filter-mode is materialized, individual rows can be pruned with `remove_from_selection`. The implementation lives in `selection-tools.ts` and consumes only `dataLayer` and `selectionStore` from context; it never imports `SearchService`.

### Key Files

| File                                         | Purpose                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/mcp/apps/lib/selection-store.ts`        | `SelectionStore` class — session-scoped Map with `set({ strategy })`, `removeIds` |
| `src/mcp/apps/lib/selection-tools.ts`        | `createSelectionTools()` + `createSharedSelectionTools()` factories               |
| `src/mcp/apps/find-model-app/index.ts`       | Calls `createSelectionTools('select_find_records', …)`                            |
| `src/mcp/apps/view-selection-app/index.ts`   | Calls `createSelectionTools('select_view_records', …)` + reads selection store    |
| `src/mcp/apps/pick-model-app/index.ts`       | Calls `createSelectionTools('select_autocomplete_records', …)`                    |
| `src/mcp/apps/multi-pick-model-app/index.ts` | Calls `createSelectionTools('select_multi_records', …)`                           |

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

The MCP server owns all form metadata — field types, validations, grouping, labels. The Rails API is only used to:

1. Fetch association options (locations, tags) at form-open time
2. Validate submissions (`validate_form` → Rails validates on create)
3. Create records (`create_model` → `POST /api/v1/books`)

This keeps the MCP server decoupled from the Rails app's internal structure.

### Single Generic Renderer

One HTML/JS/CSS app handles all model forms. Adding a new model requires zero new UI code — just a registry entry. This eliminates the maintenance burden of per-model hardcoded forms.

### Association Resolution at Form-Open Time

Association options (e.g., user's locations) are fetched when the form opens, not at schema generation time. This ensures:

- Options are always fresh (no caching issues)
- User-scoped data (only the current user's locations appear)
- Graceful degradation (if API call fails, field renders as empty select)

## Related Guides

- **[Model Form Customization Guide](./model-form.md)** — Horizontal layout, field group layouts (`row`, future types), responsive behavior, and the rendering pipeline from prompt config to CSS
