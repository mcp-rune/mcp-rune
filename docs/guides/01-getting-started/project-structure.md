# Project structure

An mcp-rune project has two halves: **your server** (the models, prompts, tools, and domain rules you write) and **the framework** (everything mcp-rune ships). The convention is to keep them clearly separated — your code lives under `your-server/`, mcp-rune's lives under the published package. This guide is the map.

## Your project

A simple-preset mcp-rune project looks like this — `src/` holds the TypeScript you write, `test/` ships one smoke test, and the project root holds `package.json`, `tsconfig.json`, `.env.example`, and a `.gitignore`:

<!-- illustration: project-structure#server -->

```
your-server/                          (you write this)
    │
    ├─ src/
    │   ├─ models/                     Model definitions (one file per model + index.ts)
    │   ├─ prompts/                    Prompt classes (one file per prompt + index.ts)
    │   ├─ config.ts                   ToolRegistry wiring (models · prompts · stub ApiClient)
    │   └─ server.ts                   StdioServer entry point (calls into config.ts)
    ├─ test/
    │   └─ smoke.test.ts               Asserts package.json declares the design-mandated scripts
    ├─ package.json
    ├─ tsconfig.json
    └─ .env.example
```

What lives where:

- **`src/models/`** — One file per model. Each model declares its `attributes` (the source of truth) and its `api` block (endpoint and convention). The framework derives field tables, validators, and JSON schemas from these. The `index.ts` aggregates every model into a single `MODEL_CLASSES` map; the `rune add model` command appends to it for you.
- **`src/prompts/`** — One file per prompt. Prompts group model fields into `fieldGroups` and pick a strategy (`stateless`, `hybrid`, or `stateful`). See the [Sections & Field Groups guide](../03-the-prompt/sections-groups.md). The `index.ts` aggregates them into the `promptRegistry`.
- **`src/config.ts`** — Wires `MODEL_CLASSES` + `promptRegistry` into a `ToolRegistry`. The simple preset installs a throwing `Proxy` as the `ApiClient` so CRUD tools fail with a clear "wire `createApiClient` here" error. Swapping that line is how you point at a real backend.
- **`src/server.ts`** — `StdioServer` entry point. Imports `mcpConfig` from `config.ts` and calls `server.start()`.
- **`test/`** — `vitest` lives here. The bundled `smoke.test.ts` asserts `package.json` declares the framework's expected scripts; add real tests alongside it.

For larger projects you'll grow two more directories: `src/tools/` for bespoke `BaseTool` subclasses (most projects need zero — the polymorphic tools cover the common surface) and `src/domain/` for declarative workflows, business rules, and knowledge entries the LLM can query via `suggest_workflow`, `check_business_rules`, and `get_domain_context`. The simple preset doesn't scaffold them; the advanced preset and the `bookshelf` template do. See [Tool creation](../04-tools/tool-creation.md) and [Domain knowledge](../08-domain-knowledge/domain-knowledge.md) for when to reach for each.

The advanced preset's `--transport both` also scaffolds a second entry point at `src/server-remote.ts` (an `HttpServer` for OAuth-gated HTTP transport) alongside `server.ts`. Both share `config.ts`.

## Try it — walk a fresh scaffold

> Verified against rune CLI 0.11.0 · @mcp-rune/mcp-rune 0.103.1 · Node 24.

Scaffold a throwaway project in `/tmp` and inspect it. Every file, folder, and command line below is captured verbatim from a real run; the layout above describes what you'll see.

**1. Scaffold from scratch**

```bash
cd /tmp
rune new bookshelf-tour --preset simple --models Book --yes --skip-mascot --no-install --no-git
```

Expected output:

```
Scaffolding bookshelf-tour (simple)…
│
◇  Wrote files to /tmp/bookshelf-tour

╭ Next steps ────────────────────────────────╮
│ ▸ cd bookshelf-tour                        │
│ ▸ npm install                              │
│ ▸ npm run start:local                      │
│ ▸ rune inspect  (open MCP Inspector)       │
│                                            │
│ Docs: https://github.com/mcp-rune/mcp-rune │
╰────────────────────────────────────────────╯
```

(The `--yes --skip-mascot --no-install --no-git` flags only exist to make the output reproducible for this tutorial. Drop them in real use to get the wizard, `npm install`, and `git init` automatically.)

**2. Walk the tree**

```bash
cd bookshelf-tour && tree -L 2 -I 'node_modules|.git'
```

Expected output:

```
.
├── package.json
├── README.md
├── src
│   ├── config.ts
│   ├── models
│   ├── prompts
│   └── server.ts
├── test
│   └── smoke.test.ts
└── tsconfig.json

5 directories, 6 files
```

**3. List each folder the layout block named**

```bash
ls src/models src/prompts
```

Expected output:

```
src/models:
book.ts  index.ts

src/prompts:
book-prompt.ts  index.ts
```

Two files per folder: one declaration per model (`book.ts`, plus a prompt that mirrors it), and one `index.ts` that aggregates every declaration into the registry the framework reads. `rune add model Tag` will append `tag.ts` + `tag-prompt.ts` to these folders and patch both `index.ts` files for you — no manual wiring.

**4. Confirm the typecheck and smoke test pass before you change anything**

```bash
npm install --no-audit --no-fund
npm run typecheck
npm run test
```

The typecheck prints nothing on success; the test prints `1 passed`. Both run in well under a minute on a fresh machine. If either fails on a clean scaffold, file a bug against `@mcp-rune/create` — that's the scaffold's own contract, asserted by `test/smoke.test.ts`.

**Observe:** there's no `tools/` folder, no `domain/` folder, no `createApiClient` factory. The simple preset is deliberately minimal — the polymorphic tools cover CRUD, the stub `ApiClient` makes CRUD attempts fail with a pointed error, and you grow the project from there by adding models with `rune add model` and wiring real services in `config.ts`.

## The framework

The published `mcp-rune` package surfaces its capabilities through a flat list of **subpath exports** — one entry per concern, so you only pull in the surface you actually need. The authoritative list is the `"exports"` field in `package.json`; verbatim today:

<!-- illustration: project-structure#framework -->

```
@mcp-rune/mcp-rune/
    │
    ├─ core                       Framework primitives — ApiClient type, Config,
    │                             env helpers, response helpers, startup tracker
    ├─ models                     BaseModel, AttributeDefinition, AssociationConfig,
    │                             kind descriptors
    ├─ prompts                    BasePrompt, PromptContentBuilder, derivePromptSchema
    ├─ tools                      BaseTool, ToolRegistry, categories, interceptors
    ├─ apps                       AppRegistry, generic app factories
    │   └─ kind-renderers         DOM renderers (getKindRenderer, registerKindRenderer)
    ├─ server                     StdioServer, HttpServer, createServer
    ├─ data-layer                 DataLayer interface + in-memory stub
    ├─ model-service              ModelService, EndpointResolver (default DataLayer)
    ├─ api-conventions            BaseConvention, jsonApiConvention, defaultConvention
    ├─ api-extensions             ApiExtension contract
    │   ├─ custom-actions         Built-in: non-CRUD verbs on models
    │   └─ search                 Built-in: SearchService, SearchRequestShaper,
    │                             search_records + get_filters_guide tools
    ├─ domain                     DomainRegistry, BusinessRule, WorkflowDefinition
    ├─ extensions                 HttpExtension contract
    │   ├─ cimd                   Built-in: Client ID Metadata Document
    │   └─ center-of-control      Built-in: OAuth control plane
    ├─ oauth2                     OAuthService, token store
    ├─ runtime                    Logger, tracing, error tracking, embeddings,
    │                             vectorStorage, requestContext, toolOutputAdapters
    │   └─ vendor/pgvector        createPgvectorAdapter — pgvector-backed storage
    └─ db                         setPool, query — minimal PG client
        └─ migrations             Versioned SQL migrations as a JS array
```

Each entry is a stable seam: renaming or moving an internal file does not break consumers. See [Subpath imports](../11-reference/subpath-imports.md) for per-subpath import examples.

> Three things to know on first read.
>
> **The `api-extensions/*` subpaths are opt-in.** Importing the module gets you the types and services (`SearchService`, etc.), but the contributed MCP tools (`search_records`, `model_action`, `get_filters_guide`) only register when you also pass the extension to `ToolRegistry({ apiExtensions: {...} })`. Pure-REST servers can omit them entirely. See [API extensions](../10-extensions/api-extensions.md) and [Authoring extensions](../10-extensions/authoring-extensions.md).
>
> **`core` no longer contains `BaseModel`.** Earlier releases re-exported it there; today the model-domain layer lives behind the `models` subpath, and `core` is reserved for framework primitives (helpers, env, the `ApiClient` type definition). Scaffolded projects already import from the right place; if you have older code, swap `@mcp-rune/mcp-rune/core` → `@mcp-rune/mcp-rune/models` for `BaseModel`-related symbols.
>
> **Internal vs public.** The map above is the public surface. Internally the code is split across `src/core/`, `src/mcp/` (the bulk — `models/`, `model-layer/`, `data-layer/`, `analysis-layer/`, `prompts/`, `tools/`, `apps/`, `domain/`, etc.), `src/runtime/`, `src/extensions/`, `src/oauth2/`, and `src/db/`. The mapping from subpath to internal folder is in `package.json`. [Definition vs consumption](../02-the-model/definition-vs-consumption.md) explains why declaration and consumption sit in sibling folders inside `src/mcp/`.

## Example: the bookshelf

The reference example (see the [Quickstart guide](./quickstart.md) to run it) keeps the structure minimal:

<!-- illustration: project-structure#bookshelf -->

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

- [Prompt Creation](../03-the-prompt/prompt-creation.md) — declare a prompt with sections, field groups, and a strategy.
- [Tool Creation](../04-tools/tool-creation.md) — when (and when not) to write a custom tool.
- [API configuration](../06-the-three-layers-up-close/api-configuration.md) — point models at a real backend (REST, Rails, Elasticsearch).
