<p align="center">
  <a href="https://github.com/mcp-rune/mcp-rune/actions/workflows/ci.yml"><img src="https://github.com/mcp-rune/mcp-rune/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/MCP-2025--11--25-blue" alt="MCP Spec" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-green" alt="Node.js" />
  <img src="https://img.shields.io/badge/license-MIT-brightgreen" alt="License" />
</p>

# mcp-rune

**The framework for model-driven MCP servers.** Declare your models once. mcp-rune derives the tools, prompts, interactive apps, GraphRAG analysis layer, semantic search, OAuth 2.1, and auto-generated docs — from the same spec. _Inscribe small. Cast large._

> 📚 **Full documentation:** [mcp-rune.dev](https://mcp-rune.dev) &nbsp;·&nbsp; [Quickstart](https://mcp-rune.dev/docs/quickstart) &nbsp;·&nbsp; [Guides](https://mcp-rune.dev/docs) &nbsp;·&nbsp; [Roadmap](https://mcp-rune.dev/roadmap)

## What you get from 10 lines

```typescript
import { BaseModel } from '@mcp-rune/mcp-rune/core'
import type { AttributeDefinition } from '@mcp-rune/mcp-rune/core'

export class Book extends BaseModel {
  static override endpoint = 'books'
  static override attributes: Record<string, AttributeDefinition> = {
    title: { type: 'string', required: true, description: 'Book title' },
    author: { type: 'string', required: true, description: 'Author name' },
    status: { type: 'enum', enumValues: ['unread', 'reading', 'completed'], default: 'unread' },
    rating: { type: 'integer', description: 'Rating 1-5', validation: { min: 1, max: 5 } }
  }
}
```

A complete MCP server — **derived, never hand-written:**

| Surface                     | What the client sees                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **8 polymorphic tools**     | `list_models` · `find_records` · `create_model` · `update_model` · `delete_model` · `search_records` · `bulk_action_models` · `get_filters_guide` |
| **7 interactive MCP Apps**  | Forms, tables, type-ahead pickers, multi-selects, detail cards — sandboxed HTML rendered inside Claude Desktop / Cursor / VS Code                 |
| **Prompt with validation**  | `BookPrompt` — stateless / hybrid / stateful strategies that adapt to form complexity                                                             |
| **GraphRAG analysis layer** | Nine summary strategies over embedded records + a relationship graph — map-reduce thousands of rows into themes without flooding context          |
| **OAuth 2.1 + PKCE**        | RFC 9728 PRM · RFC 8414 metadata · RFC 7591 DCR · RFC 7636 PKCE · RFC 8707 audience-bound tokens                                                  |
| **Auto-generated docs**     | Field reference, workflow diagrams, and the filter guide — emitted from the same `attributes` block                                               |

Add a second model. Same eight tools serve it too. **Ten models, still 8 tools. A hundred models, still 8 tools.** Tool count is O(1) in your domain; the LLM's context stays clean.

## Why this works

Every other MCP framework operates at the **transport / tool** level — one handler per operation per model. Ten models × five CRUD verbs = fifty hand-written handlers; tool lists overflow the picker; LLM tool selection degrades.

mcp-rune operates at the **application** level. You describe the domain; the framework derives the surface. The model is the single source of truth — change it, and tools, prompts, apps, search filters, and docs re-derive in lockstep.

A _rune_ is a compact, declarative inscription that produces effects larger than itself. In mcp-rune, every primitive — `BaseModel`, `BasePrompt`, `AppRegistry`, `DomainRegistry`, `ApiExtension` — fits on a screen. The framework is the casting engine.

## GraphRAG, batteries included

Most MCP servers hand the agent CRUD and stop. mcp-rune ships an analysis layer that lets the agent answer _"what are people complaining about this quarter?"_ against ten thousand records without dragging raw rows into its context window.

```
RETRIEVAL / GRAPHRAG PIPELINE          MiniLM-L6-v2 · 384-dim · local pgvector

  ① INGEST          ② INDEX (GraphRAG)     ③ QUERY            ④ ANSWER
  ----------        ------------------     -------            --------
  your API     ┌──> vectors                analysis_query     findings[]
  paginate ≤50 ├──> edges (multi-hop)       describe · agg     stored &
  one call     └──> domain (concepts        filter · sample    recallable
                    + business rules)       semantic           0 raw rows
                                                               in context
```

- **Local embeddings** — `all-MiniLM-L6-v2`, 384-dim, in your Postgres + pgvector. No embedding API. No vector-DB service. No network round-trip per record.
- **Multi-hop ingest** follows the edges you declared on your models — the agent sees a relationship graph, not a flat dump.
- **Domain-aware summaries** ground findings in your vocabulary via a `DomainRegistry` of concepts and business rules.
- **Nine composable summary strategies** — five field-level (`distribution` · `coverage` · `anomaly` · `temporal` · `entity-extraction`) and four GraphRAG-aware (`concept-touch` · `relationship-coverage` · `semantic-cluster` · `rule-violation`).
- **Stratified + proximity sampling** spreads samples evenly across buckets or time windows instead of clustering on the densest day.

→ [Retrieval & GraphRAG overview](https://mcp-rune.dev/docs/retrieval-graphrag) · [Analysis quickstart](https://mcp-rune.dev/docs/analysis-quickstart)

## Feature surface

|                                |                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Polymorphic CRUD & bulk**    | 8 tools serve every model, including batch create / update / delete and compound-ID nested resources                                              |
| **Prompt DSL**                 | Declarative sections + field groups; stateless / hybrid / stateful strategies for 20+ field workflows                                             |
| **Interactive MCP Apps**       | Schema-derived HTML forms in a sandboxed `ui://` iframe; bidirectional `ontoolinput` / `ontoolresult` channels                                    |
| **Domain intelligence**        | `DomainConcept`, `BusinessRule`, `WorkflowDefinition`, `DiagramTemplate` — a declarative registry the LLM reaches for                             |
| **Multi-step workflows**       | `get_workflow_step` + `contextHints` drive long-running, LLM-piloted fetch-analyze loops                                                          |
| **GraphRAG analysis**          | Local pgvector embeddings + 9 summary strategies + stratified / proximity sampling                                                                |
| **OAuth 2.1 + PKCE**           | RFC 6749 · 7591 · 7636 · 8414 · 8707 · 9728 + OIDC Core — spec-grade, no shortcuts                                                                |
| **Dual transport**             | `StdioServer` (local desktop) and `HttpServer` (multi-user, OAuth-protected) from one factory                                                     |
| **Four backend seams**         | Custom `DataLayer`, `ApiClient`, `ApiConvention`, and `SearchAdapter` — replace a built-in default without forking                                |
| **Three extension shapes**     | `HttpExtension` (routes + middleware), `ApiExtension` (verbs / tools beyond CRUD), `ToolFlowExtension` (tool-surface modifiers + runtime context) |
| **Observability**              | Structured Winston logs, Langfuse tracing, Sentry error tracking, request-ID correlation across the pipeline                                      |
| **Transient context protocol** | Server-to-client signal collapsing stale tool results once a follow-up call has consumed them                                                     |

## How it compares

|                                                      | Protocol Wrappers | API Converters | **mcp-rune** |
| ---------------------------------------------------- | :---------------: | :------------: | :----------: |
| Transport (stdio + HTTP)                             |        ✅         |       ✅       |      ✅      |
| Tool registration & schema                           |        ✅         |       ✅       |      ✅      |
| OAuth 2.1 + PKCE                                     |        ⚠️         |       ❌       |      ✅      |
| Polymorphic CRUD from model config                   |        ❌         |       ⚠️       |      ✅      |
| Bulk operations (batch CRUD)                         |        ❌         |       ❌       |      ✅      |
| API convention abstraction (HAL · JSON:API · custom) |        ❌         |       ❌       |      ✅      |
| Prompt strategies (form validation)                  |        ❌         |       ❌       |      ✅      |
| Schema-driven interactive MCP Apps                   |        ⚠️         |       ❌       |      ✅      |
| Search adapter abstraction                           |        ❌         |       ❌       |      ✅      |
| Domain workflows & business rules                    |        ❌         |       ❌       |      ✅      |
| Analysis & GraphRAG summary strategies               |        ❌         |       ❌       |      ✅      |
| Documentation generation pipeline                    |        ❌         |       ❌       |      ✅      |

## Install

```bash
git clone https://github.com/mcp-rune/mcp-rune.git
cd mcp-rune/examples/bookshelf && npm install
npx tsx server.ts
```

Boots the [bookshelf example](examples/bookshelf/) — a 30-line model exposing every framework surface via the in-memory `DataLayer`. Node ≥ 24.

Wire it into Claude Desktop / Cursor / VS Code in the [Quickstart](https://mcp-rune.dev/docs/quickstart). Bring up pgvector and walk the analysis layer end to end in the [Analysis Quickstart](https://mcp-rune.dev/docs/analysis-quickstart).

## Documentation

The site organizes 34 guides across 11 sections; the source mirrors the site IA — browse on GitHub at [`docs/guides/`](docs/guides/).

- **Start here** — [Quickstart](https://mcp-rune.dev/docs/quickstart) · [Project structure](https://mcp-rune.dev/docs/project-structure)
- **Core DSL** — [Prompt creation](https://mcp-rune.dev/docs/prompt-creation) · [Sections & field groups](https://mcp-rune.dev/docs/sections-groups) · [Stateful strategies](https://mcp-rune.dev/docs/stateful)
- **Apps & UI** — [MCP Apps](https://mcp-rune.dev/docs/mcp-apps) · [Apps architecture](https://mcp-rune.dev/docs/mcp-apps-arch) · [Search filters](https://mcp-rune.dev/docs/search-filters)
- **Analysis** — [GraphRAG overview](https://mcp-rune.dev/docs/retrieval-graphrag) · [Analysis memories](https://mcp-rune.dev/docs/analysis-memories) · [Summary strategies](https://mcp-rune.dev/docs/summary-strategies)
- **Backends** — [Custom DataLayer](https://mcp-rune.dev/docs/data-layer) · [Custom API convention](https://mcp-rune.dev/docs/api-convention) · [Custom search adapter](https://mcp-rune.dev/docs/search-adapter)
- **Extensions** — [Overview](https://mcp-rune.dev/docs/extensibility) · [Recipes cookbook](https://mcp-rune.dev/docs/extension-recipes) · [Authoring](https://mcp-rune.dev/docs/authoring-extensions)
- **Auth** — [OAuth 2.0 discovery](https://mcp-rune.dev/docs/oauth2-discovery)

## Tech stack

TypeScript 5.9 (strict) · Node.js ≥ 24 (ESM) · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (spec 2025-11-25) · Zod v4 · Express 5 · `openid-client` · PostgreSQL + `pgvector` (analysis layer) · Vitest

## Community

- **Discussions** — [github.com/mcp-rune/mcp-rune/discussions](https://github.com/mcp-rune/mcp-rune/discussions)
- **Issues** — [github.com/mcp-rune/mcp-rune/issues](https://github.com/mcp-rune/mcp-rune/issues)
- **Contributing** — see [CONTRIBUTING.md](CONTRIBUTING.md) and [DEVELOPMENT.md](DEVELOPMENT.md)

## License

MIT © David Sáenz — see [LICENSE](LICENSE).
