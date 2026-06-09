<p align="center">
  <a href="https://mcp-rune.dev">
    <img src="https://raw.githubusercontent.com/mcp-rune/mcp-rune/master/docs/assets/readme-banner.svg" alt="mcp-rune — derive an MCP server from your schema" width="100%" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/mcp-rune/mcp-rune/actions/workflows/ci.yml"><img src="https://github.com/mcp-rune/mcp-rune/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@mcp-rune/mcp-rune"><img src="https://img.shields.io/npm/v/@mcp-rune/mcp-rune?color=7c5cff&label=npm&logo=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/MCP-2025--11--25-blue" alt="MCP Spec" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <a href="https://github.com/mcp-rune/mcp-rune/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-007ec6" alt="MIT license" /></a>
  <a href="https://discord.gg/fxM2yndabX"><img src="https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white" alt="Join the Discord" /></a>
  [![Socket Badge](https://badge.socket.dev/npm/package/@mcp-rune/mcp-rune/0.102.0)](https://badge.socket.dev/npm/package/@mcp-rune/mcp-rune/0.102.0)
</p>

<h3 align="center">
  <a href="https://mcp-rune.dev"><code>mcp-rune.dev</code></a>
</h3>

<p align="center">
  <a href="https://mcp-rune.dev/docs">Documentation</a> ·
  <a href="https://mcp-rune.dev/docs/quickstart">Quickstart</a> ·
  <a href="https://github.com/mcp-rune/examples">Examples</a> ·
  <a href="https://discord.gg/fxM2yndabX">Discord</a> ·
  <a href="https://github.com/mcp-rune/mcp-rune">GitHub</a>
</p>

<p align="center">
  Building an <a href="https://modelcontextprotocol.io">MCP</a> server by hand means writing N tool handlers, N schemas,<br />
  OAuth from scratch, and an agent that still guesses your business rules.<br />
  <br />
  <strong>mcp-rune</strong> derives all of that from one model definition. Define your models once —<br />
  it derives the prompts, tools, apps and docs an agent needs, then indexes your<br />
  whole dataset so the agent retrieves <strong>by meaning, not raw rows</strong>.<br />
  <strong>One spec, an entire server.</strong>
</p>

<br />

## Install

```bash
npm install @mcp-rune/mcp-rune
```

New here? Start with the **[Quickstart](https://mcp-rune.dev/docs/quickstart)** — a real MCP server running in under ten minutes, no database or backend required.

Want to poke at a running example first? Scaffold the **[bookshelf example](https://github.com/mcp-rune/examples/tree/main/bookshelf)** with one command — a 30-line model, a complete server:

```bash
npx @mcp-rune/create new my-app --template bookshelf
```

## A taste

Write a model. That's the spec.

```ts
import { BaseModel } from '@mcp-rune/mcp-rune'

export class Book extends BaseModel {
  static override attributes = {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    status: { type: 'enum', values: ['reading', 'done'] },
    rating: { type: 'integer', validation: { min: 1, max: 5 } }
  }
}
```

From that one declaration, mcp-rune registers the full agent surface — and the tool list **does not grow** as you add models:

- **Generic CRUD tools** — `list_models`, `find_records`, `create_model`, `update_model`, `delete_model` cover every model you define.
- **Prompts agents can follow** — sections, validation, enum tables and turn-taking, derived from your attributes.
- **Interactive MCP Apps** — schema-driven create/edit/search UIs rendered inside Claude Desktop. No per-model HTML.
- **OAuth 2.0, spec-compliant** — discovery the way Inspector and strict clients expect (RFC 6749 / 8414 / 8707 / 9728).
- **Docs, generated** — every model and tool documents itself.

Both TypeScript and JavaScript are first-class — every example in the docs ships in both.

## Retrieval that understands your domain

Most MCP servers can only hand the agent raw rows. mcp-rune indexes an entire dataset **three ways** — vectors, a relationship graph, and your domain vocabulary — then answers by meaning, aggregate, filter, or stratified sample. The agent reasons over _findings_, never the whole table.

- **Recall by meaning** — page summaries and stored findings are embedded with `all-MiniLM-L6-v2` (384-dim) into local **pgvector**; the `semantic` mode ranks by cosine distance, no keywords.
- **Walk the relationships** — multi-hop ingest follows associations across models and stores the **edges**; the GraphRAG-aware summary strategies read that graph, not just flat fields.
- **Grounded in your terms** — a registry of **concepts** and **business rules** grounds every finding in your vocabulary.
- **Act without re-exposing** — `analysis_act` mutates a filtered subset server-side; matched IDs never return to the agent's context.

Six tools — `analysis_ingest` · `analysis_query` · `analysis_store` · `analysis_act` · `analysis_summarize` · `analysis_clear` — opt-in via `ANALYSIS_ENABLED=true`. **Off by default** — nothing loads, nothing runs, no startup cost until you turn it on. Local embeddings: **no external vector DB, no embedding API.**

## Documentation

Visit the **[official documentation](https://mcp-rune.dev/docs)** for the full guide library. Good places to start:

- **[Quickstart](https://mcp-rune.dev/docs/quickstart)** — your first server in ten minutes
- **[Project structure](https://mcp-rune.dev/docs/project-structure)** — where models, prompts, tools and apps live
- **[Prompt creation](https://mcp-rune.dev/docs/prompt-creation)** — the DSL that turns attributes into agent-fillable forms
- **[MCP Apps](https://mcp-rune.dev/docs/mcp-apps)** — interactive HTML UIs inside the client
- **[Analysis & GraphRAG](https://mcp-rune.dev/docs/analysis-quickstart)** — bring up pgvector and query thousands of records by meaning
- **[Data layer](https://mcp-rune.dev/docs/data-layer)** — the seam between the framework and any backend

## Support

Having trouble? Ask in the official **[mcp-rune Discord](https://discord.gg/fxM2yndabX)** — the community is happy to help you get unstuck.

For partnerships, security reports, or anything 1:1, email **[david@mcp-rune.dev](mailto:david@mcp-rune.dev)**.

## Contributing

**New contributors welcome!** Check out the **[Contributors Guide](https://github.com/mcp-rune/mcp-rune/blob/master/CONTRIBUTING.md)** to get started, then browse the **[good first issues](https://github.com/mcp-rune/mcp-rune/labels/good%20first%20issue)**.

Join us on **[Discord](https://discord.gg/fxM2yndabX)** to meet other contributors — we'll help you land your first contribution in no time.

## License

[MIT](https://github.com/mcp-rune/mcp-rune/blob/master/LICENSE) © the mcp-rune authors. **No telemetry. Self-hosted by default.**

<p align="center">
  <sub>Built in the open · <a href="https://github.com/mcp-rune/mcp-rune">Star us on GitHub</a> ✦</sub>
</p>
