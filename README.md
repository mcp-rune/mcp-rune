<p align="center">
  <a href="https://github.com/mcp-rune/mcp-rune/actions/workflows/ci.yml"><img src="https://github.com/mcp-rune/mcp-rune/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/MCP-2025--11--25-blue" alt="MCP Spec" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-green" alt="Node.js" />
</p>

# mcp-rune

**The framework for model-driven MCP servers.** Declare your models once. mcp-rune derives the prompts agents can follow, generic CRUD tools, GraphRAG analysis, semantic search, OAuth 2.0, and rich MCP Apps — from the same spec.

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

| Surface                     | What the LLM client sees                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **8 polymorphic tools**     | `list_models` · `find_records` · `create_model` · `update_model` · `delete_model` · `search_records` · `bulk_action_models` · `get_filters_guide` |
| **7 interactive MCP Apps**  | Forms, tables, type-ahead pickers, multi-selects, selection inspector — rendered as real UI inside Claude Desktop / Cursor / VS Code              |
| **Prompt with validation**  | `BookPrompt` — stateless / hybrid / stateful strategies that adapt to form complexity                                                             |
| **GraphRAG analysis layer** | Nine summary strategies over embedded records + a relationship graph — map-reduce thousands of rows into themes without flooding context          |
| **OAuth 2.1 + PKCE**        | Spec-compliant: RFC 9728 PRM · RFC 7591 DCR · RFC 8707 audience-bound tokens                                                                      |
| **Auto-generated docs**     | Field reference + workflow diagrams emitted from the same `attributesConfig`                                                                      |

Add a second model. Same eight tools serve it too. **Ten models, still 8 tools. A hundred models, still 8 tools.** The LLM's context stays clean.

## GraphRAG, batteries included

Most MCP servers hand the agent CRUD and stop. mcp-rune ships an analysis layer that lets the agent answer _"what are people complaining about this quarter?"_ against ten thousand records without dragging raw rows into its context window.

Records get embedded locally (`all-MiniLM-L6-v2`, no network round-trip). Ingestion follows the edges you declared on your models — multi-hop. Findings persist as ephemeral (1h) or long-lived memories the agent recalls by meaning. Nine composable summary strategies cover both families:

- **Field-level:** `distribution` · `coverage` · `anomaly` · `temporal` · `entity-extraction`
- **Graph-aware:** `concept-touch` · `relationship-coverage` · `semantic-cluster` · `rule-violation`

→ [Analysis quickstart](https://mcp-rune.dev/docs/analysis-quickstart) — bring up pgvector and walk every strategy end to end.

## Why mcp-rune?

Every other MCP framework operates at the **transport/tool** level — one handler per operation per model. Ten models × five CRUD verbs = fifty hand-written handlers; tool lists overflow the picker; LLM tool selection degrades.

mcp-rune operates at the **application** level. You describe the domain; the framework derives the surface. The model is the single source of truth — change it, and tools, prompts, apps, and docs re-derive in lockstep.

## Install

```bash
git clone https://github.com/mcp-rune/mcp-rune.git
cd mcp-rune/examples/bookshelf && npm install
npx tsx server.ts
```

This boots the [bookshelf example](examples/bookshelf/) — a single 30-line model exposing every framework surface (tools, prompts, validation, apps, docs) via the in-memory `DataLayer`. Node ≥24 required. Wiring up Claude Desktop / Cursor / VS Code lives in the [Quickstart guide](https://mcp-rune.dev/docs/quickstart).

## Community

- **Discussions** — [github.com/mcp-rune/mcp-rune/discussions](https://github.com/mcp-rune/mcp-rune/discussions)
- **Issues** — [github.com/mcp-rune/mcp-rune/issues](https://github.com/mcp-rune/mcp-rune/issues)
- **Contributing** — see [CONTRIBUTING.md](CONTRIBUTING.md) and [DEVELOPMENT.md](DEVELOPMENT.md)

## License

MIT © David Sáenz — see [LICENSE](LICENSE).
