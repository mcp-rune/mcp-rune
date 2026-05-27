# Project structure

An mcp-rune project has two halves: **your server** (the models, prompts, tools, and domain rules you write) and **the framework** (everything mcp-rune ships). The convention is to keep them clearly separated — your code lives under `your-server/`, mcp-rune's lives under the published package. This guide is the map.

## Your project

A typical mcp-rune project looks like this:

```
your-server/                          (you write this)
    │
    ├─ models/                         Model definitions (attributesConfig)
    ├─ prompts/                        Prompt classes (fieldGroups + strategy)
    ├─ tools/                          Custom tools (extend BaseTool)
    ├─ domain/                         Workflows, rules, knowledge
    └─ servers/
        ├─ local.ts                    StdioServer entry point
        └─ remote.ts                   HttpServer entry point
```

What lives where:

- **`models/`** — One file per model. Each model declares its `attributesConfig` (the source of truth) and its `api` block (endpoint conventions). The framework derives field tables, validators, and JSON schemas from these.
- **`prompts/`** — One file per prompt. Prompts group model fields into `fieldGroups` and pick a strategy (`stateless`, `hybrid`, or `stateful`). See the [Sections & Field Groups guide](./sections-groups-guide.md).
- **`tools/`** — Custom tools that go beyond the generic CRUD set. Most projects need zero — the polymorphic tools cover the common surface.
- **`domain/`** — Optional. Declarative workflows, business rules, and knowledge entries the LLM can query via `suggest_workflow`, `check_business_rules`, and `get_domain_context`. See the [Domain Knowledge guide](./domain-knowledge-guide.md).
- **`servers/local.ts`** / **`remote.ts`** — Entry points. `StdioServer` for stdio transport (Claude Desktop, the Inspector); `HttpServer` for remote MCP with OAuth.

## The framework

The published `mcp-rune` package is organized by capability:

```
mcp-rune/                                  (the framework)
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
    └─ db                                  PostgreSQL client
```

These are exposed as subpath exports — `mcp-rune/core`, `mcp-rune/server`, `mcp-rune/tools`, `mcp-rune/api-extensions/search`, etc. — so you only import the surface you need.

> The `api-extensions/*` subpaths are opt-in: importing the _module_ gets you the types and services (`SearchService` etc.), but the contributed MCP tools (`search_records`, `model_action`, `get_filters_guide`) only register when you also pass the extension to `ToolRegistry({ apiExtensions: {...} })`. Pure-REST servers can omit them entirely. See the [Authoring Extensions Guide](./authoring-extensions-guide.md) and [API Extensions Guide](./api-extensions.md).

## Example: the bookshelf

The reference example (see the [Quickstart guide](./quickstart-guide.md) to run it) keeps the structure minimal:

```
bookshelf/
├── models/
│   └── book.ts             Model definition (attributes, types, validation)
├── prompts/
│   └── book-prompt.ts      Prompt with hybrid strategy and field groups
├── config.ts               Server wiring (tool + prompt registries)
├── server.ts               StdioServer entry point
└── tsconfig.json
```

`config.ts` wires the model, prompt, and any custom tools into their registries; `server.ts` calls `createServer(config)` and starts the stdio transport. The whole example is ~150 lines.

## Next

- [Prompt Creation](./prompt-creation-guide.md) — declare a prompt with sections, field groups, and a strategy.
- [Tool Creation](./tool-creation-guide.md) — when (and when not) to write a custom tool.
- [Configuring the API](./api-config-guide.md) — point models at a real backend (REST, Rails, Elasticsearch).
