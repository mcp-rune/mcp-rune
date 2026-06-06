# Philosophy

> _Inscribe small. Cast large._

mcp-rune is opinionated, model-driven, and unapologetically Rails-flavored. This page collects the worldview that shapes every API decision in the framework — the why behind the conventions, the diagram of layers it generates, and the seven principles the codebase is held to.

## Why "mcp-rune"?

A rune is a compact, declarative symbol that produces powerful effects far larger than itself. In mcp-rune, **everything you write is a rune**.

You inscribe declarations:

- a **model** — what your domain looks like
- a **prompt** — how the LLM should reason about it
- an **app** — how humans interact with it
- a **workflow** — how operations chain together

Each inscription fits on one screen. The framework is the runic system: an alphabet of conventions (`BaseModel`, `BasePrompt`, `AppRegistry`, `DomainRegistry`) and a casting engine that turns those inscriptions into a complete MCP server — tools, validation pipelines, UI, OAuth, observability, documentation.

The model is the foundational rune — prompts and apps derive their structure from it (the framework's single source of truth). But each kind of inscription adds its own dimension: prompts add reasoning, apps add interaction, workflows add orchestration.

## Architecture

mcp-rune is a two-tier system. You author a thin shell of declarations; the framework provides the engine that turns those declarations into a working MCP server.

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

mcp-rune/                              (the framework)
    │
    ├─ core                            BaseModel, ApiConfig, helpers, validators
    ├─ server                          StdioServer, HttpServer, createServer
    ├─ tools                           BaseTool, CRUD tools, categories
    ├─ mcp/services                    ModelService, EndpointResolver
    ├─ prompts                         BasePrompt, strategies, pipeline
    ├─ apps                            AppRegistry, 7 generic app factories
    ├─ domain                          Workflows, knowledge, business rules
    ├─ search                          SearchService, SearchRequestShaper
    ├─ oauth2                          OAuthService, token store
    ├─ services                        Logger, tracing, error tracking
    └─ db                              PostgreSQL client
```

A rendered version of this stack lives on the [mcp-rune.dev landing page](https://mcp-rune.dev/#architecture).

## Design principles

The framework is held to seven invariants. They are the test you can apply to any proposed API change:

- **Model is the single source of truth** — `attributesConfig` drives tools, prompts, forms, and docs. Change the model, everything downstream re-derives.
- **Convention over configuration** — sensible defaults, override when needed. The default path should always be the short path.
- **Polymorphic tools** — 8 tools serve all models, keeping LLM context clean. Adding the eleventh model does not add an eleventh tool.
- **Category-driven auth** — tools declare a category, the framework infers auth requirements. You never wire auth on a per-tool basis.
- **API-agnostic** — pluggable conventions and search adapters for any REST backend. The framework knows nothing about your wire format until you tell it.
- **Dependency injection** — the framework never reads env vars or hardcodes URLs. Everything is a constructor argument, so tests don't need a temp filesystem.
- **Pure framework** — zero domain knowledge; your server adds the domain. mcp-rune ships no built-in business concepts.

See [Why mcp-rune?](./why-mcp-rune.md) for how these principles compare against alternative MCP framework choices.
