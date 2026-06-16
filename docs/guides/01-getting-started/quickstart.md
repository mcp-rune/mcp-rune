# Quickstart

Get a real MCP server running in under ten minutes. You'll install the `rune` CLI, scaffold a from-scratch server with one model, and exercise the auto-generated polymorphic tool set through the MCP Inspector — no database, no API backend, no auth setup.

The Rails analogy: one declaration, one fan-out.

<!-- illustration: quickstart#fan -->

```
       What you write                  What the framework derives
   ┌──────────────────┐             ┌──────────────────────────┐
   │ class Book       │             │ 9 polymorphic tools      │
   │   extends        │             │   list_models,           │
   │   BaseModel      │             │   find_records,          │
   │                  │             │   create_/update_/       │
   │ attributes = {   │  ────────▶  │   delete_model,          │
   │   name,          │  derivation │   bulk_action_models,    │
   │   description    │             │   get_prompt_guide,      │
   │ }                │             │   validate_form,         │
   │                  │             │   get_form_summary       │
   │                  │             │                          │
   │                  │             │ Prompt + form validation │
   │                  │             │ Auto-generated docs      │
   └──────────────────┘             └──────────────────────────┘
```

Add a second model and the same nine tools serve it too — that's the "polymorphic" promise; the LLM's tool list does not grow with your domain.

## Install the CLI

The `rune` CLI scaffolds new mcp-rune projects, runs them under the MCP Inspector, and manages their lifecycle. Install it globally:

```bash
npm install -g @mcp-rune/create
```

Prefer no global install? `npx @mcp-rune/create new …` and `npm create @mcp-rune@latest …` work the same way; see the [CLI README](https://github.com/mcp-rune/mcp-rune-cli#production-installation) for the one-shot forms.

## Scaffold a server

Create a server from scratch with the simple preset (stdio transport, no database, CRUD on the models you declare):

```bash
rune new my-server --preset simple --models Book
cd my-server
npm install
```

Run interactively without flags and the wizard's single question — _"How would you like to start?"_ — defaults to **Quick start** (the same simple preset). Pass `--yes` to accept every default; pass `--models Book,Tag` to scaffold more than one model. The full prompt/flag matrix lives in the [CLI README](https://github.com/mcp-rune/mcp-rune-cli#flags--prompts).

Then open the project in the MCP Inspector:

```bash
npm run inspect
```

The Inspector opens in your browser, pre-wired to your scaffolded server. You're now connected to a working MCP server with one model (`Book`), the default prompt strategy, and all nine polymorphic tools registered.

## Try a tool

> Verified against rune CLI 0.11.0 · @mcp-rune/mcp-rune 0.103.3 · Node 24.

Inside the Inspector, call these three in order. Each one reads the `Book` declaration directly — no backend wiring needed — so the output below should match exactly.

**1. `list_models` with `{}`** — discovers the `book` schema.

```json
[
  {
    "name": "book",
    "endpoint": "books",
    "description": "A Book record",
    "attributes": ["name", "description"],
    "required_attributes": ["name"],
    "read_only": false
  }
]
```

**2. `get_prompt_guide` with `{ "guide_name": "book" }`** — the auto-generated creation guide an LLM reads to fill the form. Every word of it is derived from `src/models/book.ts`; no template lives anywhere else.

**3. `validate_form` with `{ "model": "book", "fields": {} }`** — structured validation feedback for an empty submission:

```json
{
  "valid": false,
  "ready_to_submit": false,
  "errors": [{ "field": "name", "message": "Name is required" }],
  "warnings": [],
  "computed": {},
  "fields": {}
}
```

Call it again with `{ "model": "book", "fields": { "name": "Dune" } }` and it flips to `"valid": true, "ready_to_submit": true`. Same code path, driven by the `required: true` flag on the `name` attribute.

Three tools, zero backend code, all derived from the four-line `attributes:` block. That's the polymorphic promise.

## Want a fuller demo?

The bookshelf example template ships with three seed books, the full polymorphic tool set, interactive MCP apps, an optional 5,000-book corpus for analysis strategies (`distribution`, `coverage`, `anomaly`, `temporal`, `entity-extraction`), and optional GraphRAG wiring — zero external setup. Scaffold it instead of (or alongside) `my-server`:

```bash
rune new bookshelf-demo --template bookshelf
```

See the [CLI README · Templates](https://github.com/mcp-rune/mcp-rune-cli#templates) section for the full template list and the [`mcp-rune/examples/bookshelf`](https://github.com/mcp-rune/examples/tree/main/bookshelf) source for what the template generates.

## Connect to Claude Desktop

To talk to the same server from Claude Desktop, drop this block into `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/my-server/src/server.ts"]
    }
  }
}
```

Replace `/abs/path/to/my-server` with the absolute path to the scaffolded project (the simple-preset entry point lives at `src/server.ts`). Restart Claude Desktop and the `my-server` server will appear in the tool picker.

## What you got

From a single model declaration in `my-server/src/models/book.ts`, the framework registered the polymorphic tool set:

- **Discovery & form strategy** — `list_models`, `get_prompt_guide`, `validate_form`, `get_form_summary`
- **CRUD** — `find_records`, `create_model`, `update_model`, `delete_model`, `bulk_action_models`

The four discovery/strategy tools work out of the box because they read the `Book` declaration directly. The five CRUD tools route through an `ApiClient`, which the simple preset deliberately leaves as a throwing `Proxy` stub — try `find_records({"model":"book"})` and you'll see the seam: _"No ApiClient configured. Wire `createApiClient` in `src/config.ts` before using auth-gated tools."_ That error is the pointer to the next chapter, not a bug.

Add a second model with `rune add model Tag --attrs name:string,color:string` (or scaffold with `--models Book,Tag` from the start) and the same nine tools serve it too. For interactive MCP apps, analysis, GraphRAG, and HTTP+OAuth transport, scaffold the **advanced** preset or the **bookshelf** template above.

## Going further

Replace the stub `ApiClient` in `src/server.ts` with a real `createApiClient` factory and the same tools, prompts, and apps light up against your backend without touching the model declaration. Three guides walk the wiring: [API configuration](../06-the-three-layers-up-close/api-configuration.md) for the `static api` block every CRUD call reads, [API client](../06-the-three-layers-up-close/api-client.md) for the HTTP contract, and [Data layer](../06-the-three-layers-up-close/data-layer.md) ("Swapping the Adapter") for the swap pattern itself.

## Next

- [Analysis Quickstart](../09-retrieval-and-graphrag/analysis-quickstart.md) — Part 2: bring up pgvector with one `docker compose` block, point the bookshelf at the 5,000-book dataset, and exercise every summary strategy through `analysis_ingest` + `analysis_summarize`.
- [Project structure](./project-structure.md) — where models, prompts, tools, apps, and the domain registry live in a generated mcp-rune project.
- [Prompt creation](../03-the-prompt/prompt-creation.md) — the DSL that turns model attributes into agent-fillable forms.
- [MCP apps](../05-apps/mcp-apps.md) — interactive HTML UIs rendered inside Claude Desktop.
- [Data layer](../06-the-three-layers-up-close/data-layer.md) — the seam between the projection layer and any concrete data backend (in-memory, HTTP, custom).
