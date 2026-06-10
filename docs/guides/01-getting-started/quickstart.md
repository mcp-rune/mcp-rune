# Quickstart

Get a real MCP server running in under ten minutes. You'll install the `rune`
CLI, scaffold a from-scratch server with one model, and exercise the
auto-generated polymorphic tool set through the MCP Inspector — no database,
no API backend, no auth setup. The scaffold is wired to an **in-memory
`DataLayer` adapter** that ships with the framework, so every CRUD tool works
out of the box.

The Rails analogy: one declaration, one fan-out.

<!-- illustration: quickstart#fan -->

```
       What you write                  What the framework derives
   ┌──────────────────┐             ┌──────────────────────────┐
   │ class Book       │             │ 8 polymorphic tools      │
   │   extends        │             │   list_models,           │
   │   BaseModel      │             │   find_records,          │
   │                  │             │   create_/update_/       │
   │ attributes = {   │  ────────▶  │   delete_model,          │
   │   title,         │  derivation │   search_records,        │
   │   author,        │             │   get_filters_guide,     │
   │   status,        │             │   bulk_action_models     │
   │   rating         │             │                          │
   │ }                │             │ Prompt + form validation │
   │                  │             │ 7 schema-driven apps     │
   │                  │             │ Auto-generated docs      │
   └──────────────────┘             └──────────────────────────┘
```

Add a second model and the same eight tools serve it too — that's the
"polymorphic" promise; the LLM's tool list does not grow with your domain.

## Install the CLI

The `rune` CLI scaffolds new mcp-rune projects, runs them under the MCP
Inspector, and manages their lifecycle. Install it globally:

```bash
npm install -g @mcp-rune/create
```

> **Pre-publish note**: `@mcp-rune/create` is not on npm yet. Until it is,
> follow [Local development](https://github.com/mcp-rune/mcp-rune-cli#local-development)
> in the CLI README — clone the repo, `npm link`, and you'll have the same
> `rune` command on your path.

Prefer no global install? `npx @mcp-rune/create new …` and
`npm create @mcp-rune@latest …` work the same way; see the
[CLI README](https://github.com/mcp-rune/mcp-rune-cli#production-installation)
for the one-shot forms.

## Scaffold a server

Create a server from scratch with the simple preset (stdio transport, no
database, CRUD on the models you declare):

```bash
rune new my-server --preset simple --models Note
cd my-server
```

Run interactively without flags and the wizard's single question — _"How
would you like to start?"_ — defaults to **Quick start** (the same simple
preset). Pass `--yes` to accept every default; pass `--models Note,Tag` to
scaffold more than one model. The full prompt/flag matrix lives in the
[CLI README](https://github.com/mcp-rune/mcp-rune-cli#flags--prompts).

Then open the project in the MCP Inspector:

```bash
rune inspect
```

The Inspector opens in your browser, pre-wired to your scaffolded server.
You're now connected to a working MCP server with one model (`Note`), the
default prompt strategy, and all polymorphic data tools — backed by an
in-memory store with no seed data.

## Try a tool

Inside the Inspector, call these in order to see the value loop:

1. **`list_models`** with `{}` — discovers the `note` schema (2 fields, 1
   required).
2. **`get_prompt_guide`** with `{ "guide_name": "note" }` — returns the
   auto-generated creation guide an LLM would use to fill the form.
3. **`validate_form`** with `{ "model": "note", "fields": { "name": "First note" } }`
   — structured validation feedback for a partial submission.
4. **`find_records`** with `{ "model": "note" }` — returns an empty list;
   the in-memory store starts empty.
5. **`create_model`** with
   `{ "model": "note", "attributes": { "name": "First note", "description": "Hello, mcp-rune." } }`
   — creates the first note; `find_records` now returns one.

The first three tools are derived directly from the model definition the CLI
generated for you (`models/note.ts`). The last two exercise the in-memory
adapter wired in `config.ts` — the same code path that hits HTTP in
production, just with a different `DataLayer` factory.

## Want a fuller demo?

The bookshelf example template ships with three seed books, the full
polymorphic tool set, interactive MCP apps, an optional 5,000-book corpus
for analysis strategies (`distribution`, `coverage`, `anomaly`, `temporal`,
`entity-extraction`), and optional GraphRAG wiring — zero external setup.
Scaffold it instead of (or alongside) `my-server`:

```bash
rune new bookshelf-demo --template bookshelf
```

See the [CLI README · Templates](https://github.com/mcp-rune/mcp-rune-cli#templates)
section for the full template list and the
[`mcp-rune/examples/bookshelf`](https://github.com/mcp-rune/examples/tree/main/bookshelf)
source for what the template generates.

## Connect to Claude Desktop

To talk to the same server from Claude Desktop, drop this block into
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/my-server/server.ts"]
    }
  }
}
```

Replace `/abs/path/to/my-server` with the absolute path to the scaffolded
project. Restart Claude Desktop and the `my-server` server will appear in
the tool picker.

## What you got

From a single model declaration in `my-server/models/note.ts`, the framework
registered the polymorphic data tool set — all working immediately, no
backend needed:

- **Discovery & strategy** — `list_models`, `get_prompt_guide`,
  `validate_form`, `get_form_summary`
- **CRUD** — `find_records`, `create_model`, `update_model`, `delete_model`,
  `bulk_action_models`

Add a second model with `rune add model Tag` (or scaffold with
`--models Note,Tag` from the start) and the same tools serve it too — that's
the polymorphic promise. For interactive MCP apps, analysis, GraphRAG, and
HTTP+OAuth transport, scaffold the **advanced** preset or the **bookshelf**
template above.

## Going further

The in-memory adapter is real `DataLayer` code, not a shim — it's the same
adapter the framework's own tests use. State lives in process memory and
resets when the server restarts; that's the only difference from a
production deployment.

To wire to a real backend, replace `createInMemoryDataLayer({ fixtures })`
in `config.ts` with the default `ModelService` + `ApiClient` factory and
provide a real `createApiClient`. The seam is one line; tools, prompts, and
apps don't change. See
[Data layer](../06-the-three-layers-up-close/data-layer.md) ("Swapping the Adapter") and
[API client](../06-the-three-layers-up-close/api-client.md) for the full pattern.

## Next

- [Analysis Quickstart](../09-retrieval-and-graphrag/analysis-quickstart.md) — Part 2: bring up
  pgvector with one `docker compose` block, point the bookshelf at the
  5,000-book dataset, and exercise every summary strategy through
  `analysis_ingest` + `analysis_summarize`.
- [Project structure](./project-structure.md) — where models, prompts,
  tools, apps, and the domain registry live in a generated mcp-rune project.
- [Prompt creation](../03-the-prompt/prompt-creation.md) — the DSL that turns model
  attributes into agent-fillable forms.
- [MCP apps](../05-apps/mcp-apps.md) — interactive HTML UIs rendered inside
  Claude Desktop.
- [Data layer](../06-the-three-layers-up-close/data-layer.md) — the seam between the projection
  layer and any concrete data backend (in-memory, HTTP, custom).
