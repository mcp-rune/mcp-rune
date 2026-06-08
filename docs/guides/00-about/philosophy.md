# Philosophy

> _Inscribe small. Cast large._

mcp-rune is opinionated, model-driven, and unapologetically Rails-flavored. This page collects the worldview that shapes every API decision in the framework — the why behind the conventions, the diagram of layers it generates, and the principles the codebase is held to.

## Why "mcp-rune"?

A rune is a compact, declarative symbol that produces powerful effects far larger than itself. In mcp-rune, **everything you write is a rune**.

You inscribe declarations:

- a **model** — what your domain looks like
- a **prompt** — how the LLM should reason about it
- an **app** — how humans interact with it
- a **workflow** — how operations chain together

Each inscription fits on one screen. The framework is the runic system: an alphabet of conventions (`BaseModel`, `BasePrompt`, `BaseAppForm`, `DomainRegistry`) and a casting engine that turns those inscriptions into a complete MCP server — tools, validation pipelines, UI, OAuth, observability, documentation.

The model is the foundational rune. Prompts, tools, apps, forms, search, retrieval, and docs all derive their structure from it — the framework's single source of truth. Each other kind of inscription then adds its own dimension: prompts add reasoning, apps add interaction, workflows add orchestration.

## Architecture

mcp-rune is a two-tier system. You author a thin shell of declarations; the framework provides the engine that turns those declarations into a working MCP server.

```
your-server/                          (you write this)
    │
    ├─ models/                         Model definitions (BaseModel subclasses)
    ├─ prompts/                        Prompt classes (fieldGroups + strategy)
    ├─ tools/                          Custom tools (extend BaseTool)
    ├─ apps/                           Custom apps (extend BaseAppForm, optional)
    ├─ domain/                         Workflows, rules, knowledge
    └─ server.ts                       StdioServer or HttpServer entry point

mcp-rune/                              (the framework)
    │
    ├─ src/mcp/
    │   ├─ models/                     What a Model IS — BaseModel + the kinds/ registry
    │   ├─ model-layer/                What CONSUMES a Model — per-model-bound reads
    │   ├─ data-layer/                 Backend I/O seam — DataLayer + adapters + api-extensions
    │   ├─ analysis-layer/             Per-model analysis projections (edges, embeddings)
    │   ├─ prompts/                    What a Prompt IS — BasePrompt + builders + generators
    │   ├─ prompt-layer/               What CONSUMES a Prompt — registry, cache, validator
    │   ├─ apps/                       Schema-driven interactive UIs
    │   ├─ tools/                      Polymorphic CRUD + form-strategy tools
    │   ├─ domain/                     Concepts, business rules, workflows
    │   ├─ extensions/                 HttpExtension / ToolFlowExtension hooks
    │   └─ server-factory.ts           createServer composition root
    ├─ src/runtime/                    Logger, tracing, error tracking
    ├─ src/oauth2/                     OAuthService, token store, RFC-compliant adapters
    └─ src/db/                         PostgreSQL client (analysis layer)
```

A rendered version of this stack lives on the [mcp-rune.dev landing page](https://mcp-rune.dev/#architecture).

## Three peer per-model layers

Tools, apps, prompts, and api-extensions reach the rest of the framework through **three peer interfaces**, each one bound (or rebound) per model and per request as needed.

<!-- TODO(diagram): three-layer DI fan-out — Tool/App at top, three arrows down to DataLayer / ModelLayer(name) / AnalysisLayer(name), each connecting back to the Model declaration in src/mcp/models/. -->

```
              ┌──────────────────────────┐
              │  Tool / App / Prompt     │  (projection layer — what you write)
              └────┬──────────┬────────┬─┘
                   │          │        │
       this.dataLayer  this.modelLayer  this.analysisLayer
       (per request)  (name) per call   (name) per call
                   │          │        │
        ┌──────────▼──┐  ┌────▼────┐  ┌▼─────────────┐
        │  DataLayer  │  │ Model-  │  │ Analysis-    │
        │  backend    │  │ Layer   │  │ Layer        │
        │  I/O        │  │ reads   │  │ projections  │
        └──────────┬──┘  └────┬────┘  └──┬───────────┘
                   │          │          │
                   ▼          ▼          ▼
                ┌──────────────────────────┐
                │      Model declaration   │  (src/mcp/models/)
                └──────────────────────────┘
```

- **`DataLayer`** — per-authenticated-request backend I/O. Tools and apps call `this.dataLayer.find()`, `.list()`, `.searchNormalized()`, `.dispatch()`. Built-in implementations: in-memory stub, `ModelService` (HTTP via `ApiClient`), `SearchEnabledDataLayer` wrapper.
- **`ModelLayer`** — per-model-bound, synchronous reads against the model's static config. Surface: `kindFor(attr)`, `resolveDerivedFields(records)`, `validFieldNames()`, `promptSchema()`, `checkRequired(params)`. Constructed via `modelLayer(name)`; no I/O, no DB.
- **`AnalysisLayer`** — per-model-bound, per-request analysis projections that carry the authenticated `DataLayer` for any I/O they need. Surface today: `extractEdges(record)`, `buildEmbeddingText(record)`. Designed to host `walkHops`, `summarize`, `buildStratifier` next.

Projection-layer code never imports the underlying helpers (`ModelService`, `ApiClient`, `resolveDerivedFields`, `extractEdgesFromRecord`, …) directly. The boundary is enforced by `no-restricted-imports` in `eslint.config.js`. See [`AGENTS.md`](../../../AGENTS.md) for the canonical rules.

## Definition vs consumption

The folder layout reflects a deliberate split: **what a thing IS** lives separately from **what consumes it**.

| Declaration        | Consumption                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `src/mcp/models/`  | `src/mcp/model-layer/`, `src/mcp/data-layer/`, `src/mcp/analysis-layer/` |
| `src/mcp/prompts/` | `src/mcp/prompt-layer/`                                                  |

`models/` holds `base-model.ts`, `model-definitions.ts`, and the `kinds/` registry — purely descriptive. Helpers that read or transform a model belong in `model-layer/` or its peers. Same dichotomy for `prompts/` vs `prompt-layer/`. When future seams arrive (an `auth-layer`, a `workflow-layer`), they will follow the same pattern: a sibling consumption folder, never new helpers dumped into the declaration folder.

## Design principles

The framework is held to seven invariants. They are the test you can apply to any proposed API change:

- **Model is the single source of truth** — model declarations drive tools, prompts, forms, and docs. Change the model, everything downstream re-derives.
- **Convention over configuration** — sensible defaults, override when needed. The default path should always be the short path.
- **Polymorphic tools** — 9 bundled tools (6 CRUD + 3 form-strategy) serve all models, keeping LLM context clean. Adding the eleventh model does not add a tenth tool.
- **Category-driven auth** — tools declare a category, the framework infers auth requirements. You never wire auth on a per-tool basis.
- **API-agnostic** — pluggable `DataLayer`, conventions, and search request shapers for any REST backend. The framework knows nothing about your wire format until you tell it.
- **Layer discipline** — projection-layer code consumes `DataLayer`, `ModelLayer`, `AnalysisLayer` only. Concrete adapters and internal helpers stay behind the interface. The eslint guard makes this a build error, not a guideline.
- **Pure framework** — zero domain knowledge; your server adds the domain. mcp-rune ships no built-in business concepts.

See [Why mcp-rune?](./why-mcp-rune.md) for how these principles compare against alternative MCP framework choices. Once you're convinced this is the right shape, [the Quickstart](../01-getting-started/quickstart.md) puts a real server in front of you in under ten minutes.
