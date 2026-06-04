// pages/project-structure.mjs
//
// Authoring source for the project-structure guide's illustrations.
// Ported from the pilot's project-structure.html. Three tree figures:
// the server you write, the mcp-rune framework, and the bookshelf
// reference example.

import { colorizeTree } from '../illus.mjs'

// Build the "your server — what you write" tree.
// Verbatim ASCII from the pilot's #src-server block.
function buildServerFigure() {
  const ascii = `your-server/                          (you write this)
    │
    ├─ models/                         Model definitions (attributesConfig)
    ├─ prompts/                        Prompt classes (fieldGroups + strategy)
    ├─ tools/                          Custom tools (extend BaseTool)
    ├─ domain/                         Workflows, rules, knowledge
    └─ servers/
        ├─ local.ts                    StdioServer entry point
        └─ remote.ts                   HttpServer entry point`

  const altText =
    'Directory tree of your-server/ containing models/ (attributesConfig), ' +
    'prompts/ (fieldGroups + strategy), tools/ (custom tools extending ' +
    'BaseTool), domain/ (workflows, rules, knowledge), and servers/ with ' +
    'local.ts (StdioServer) and remote.ts (HttpServer).'

  return { svg: colorizeTree(ascii), alt: altText }
}

// Build the "mcp-rune — organized by capability" tree.
// Verbatim ASCII from the pilot's #src-framework block.
function buildFrameworkFigure() {
  const ascii = `mcp-rune/                                  (the framework)
    │
    ├─ core                                BaseModel, ApiClient, helpers, validators,
    │                                      derived-fields
    ├─ server                              StdioServer, HttpServer, createServer
    ├─ tools                               BaseTool, CRUD tools, categories
    ├─ mcp/services                        ModelService, EndpointResolver
    ├─ prompts                             BasePrompt, strategies, pipeline
    ├─ apps                                AppRegistry, generic app factories
    ├─ domain                              Workflows, knowledge, business rules
    ├─ extensions                          HttpExtension framework
    │   └─ cimd                            Built-in HTTP extension (CIMD)
    ├─ api-extensions                      ApiExtension framework
    │   ├─ custom-actions                  Built-in: non-CRUD verbs on models
    │   └─ search                          Built-in: SearchService, adapters,
    │                                      search_records + get_filters_guide tools
    ├─ oauth2                              OAuthService, token store
    ├─ services                            Logger, tracing, error tracking
    └─ db                                  PostgreSQL client`

  const altText =
    'Directory tree of the mcp-rune framework organised by capability: ' +
    'core (BaseModel, ApiClient, helpers, validators, derived-fields), ' +
    'server (StdioServer, HttpServer, createServer), tools (BaseTool, ' +
    'CRUD tools, categories), mcp/services (ModelService, ' +
    'EndpointResolver), prompts (BasePrompt, strategies, pipeline), ' +
    'apps (AppRegistry, generic factories), domain (workflows, ' +
    'knowledge, rules), extensions/cimd (HttpExtension framework + ' +
    'built-in CIMD), api-extensions with custom-actions and search ' +
    'built-ins, oauth2 (OAuthService, token store), services (logger, ' +
    'tracing, error tracking), and db (PostgreSQL client).'

  return { svg: colorizeTree(ascii), alt: altText }
}

// Build the "bookshelf — the reference example" tree.
// Verbatim ASCII from the pilot's #src-bookshelf block.
function buildBookshelfFigure() {
  const ascii = `bookshelf/
├── models/
│   └── book.ts             Model definition (attributes, types, validation)
├── prompts/
│   └── book-prompt.ts      Prompt with hybrid strategy and field groups
├── config.ts               Server wiring (tool + prompt registries)
├── server.ts               StdioServer entry point
└── tsconfig.json`

  const altText =
    'Directory tree of the bookshelf reference example: models/book.ts ' +
    '(model definition with attributes, types, validation), ' +
    'prompts/book-prompt.ts (hybrid strategy and field groups), ' +
    'config.ts (server wiring for tool and prompt registries), ' +
    'server.ts (StdioServer entry point), and tsconfig.json.'

  return { svg: colorizeTree(ascii), alt: altText }
}

export const server = buildServerFigure()
export const framework = buildFrameworkFigure()
export const bookshelf = buildBookshelfFigure()
