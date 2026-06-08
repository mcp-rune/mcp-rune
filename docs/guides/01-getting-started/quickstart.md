# Quickstart

Get a real MCP server running in under ten minutes. The [`bookshelf`
example](https://github.com/mcp-rune/examples/tree/main/bookshelf) exposes the
full framework surface — tools, prompts, validation, interactive apps, and
documentation — all generated from a single 30-line model definition. No
database, no API backend, no auth setup required: the example is wired to an
**in-memory `DataLayer` adapter** that ships with the framework, so every CRUD
tool works out of the box.

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

## Install

Scaffold the bookshelf example via the official CLI and start it through the
MCP Inspector:

```bash
npx @mcp-rune/create new my-app --template bookshelf
cd my-app
npx @modelcontextprotocol/inspector -- npx tsx server.ts
```

The CLI fetches the template from
[`mcp-rune/examples`](https://github.com/mcp-rune/examples) and runs
`npm install` for you. To skip the install step, pass `--no-install`.

The Inspector opens in your browser. You're now connected to a working MCP
server with one model (`Book`), a hybrid prompt strategy, all polymorphic
data tools, and seven interactive apps — backed by an in-memory store
pre-seeded with three books.

## Try a tool

Inside the Inspector, call these in order to see the value loop:

1. **`list_models`** with `{}` — discovers the `book` schema (5 fields, 2
   required, one enum).
2. **`get_prompt_guide`** with `{ "guide_name": "book" }` — returns the
   auto-generated creation guide an LLM would use to fill the form.
3. **`validate_form`** with `{ "model": "book", "fields": { "title": "Clean Code" } }`
   — structured validation feedback for a partial submission.
4. **`find_records`** with `{ "model": "book" }` — lists the three seed
   books from the in-memory store.
5. **`create_model`** with
   `{ "model": "book", "attributes": { "title": "Refactoring", "author": "Martin Fowler", "rating": 5 } }`
   — actually creates a fourth book; `find_records` now returns four.

The first three tools are derived directly from the model definition in
`my-app/models/book.ts`. The last two exercise the in-memory adapter wired in
`my-app/config.ts` — the same code path that hits HTTP in production, just
with a different `DataLayer` factory.

## Load a bigger dataset

Three books makes the loop legible but doesn't show what the framework
does once a real dataset arrives. The bookshelf example takes a
`BOOKSHELF_DATASET` env var that swaps the seed fixtures for a
**5,000-book** corpus designed to give every built-in summary strategy
(`distribution`, `coverage`, `anomaly`, `temporal`, `entity-extraction`)
something meaningful to say:

```bash
# Procedurally generated, deterministic — same output every run.
BOOKSHELF_DATASET=large npx tsx server.ts

# Same dataset, but loaded from fixtures/books.5000.json via the
# framework's loadFixturesFromJson helper.
BOOKSHELF_DATASET=json npx tsx server.ts
```

Inside the Inspector, paginate through the new corpus:

```jsonc
find_records({ model: "book", page: 1, per_page: 50 })
// → 50 records out of 5000 total · 100 pages
```

The records carry deliberately varied shape — most books have a
`rating`, ~25% don't (for `coverage`); ~1% carry a wildly high `pages`
count (for `anomaly`); `created_at` and `updated_at` span ~24 months
with a 60-day gap (for `temporal`); each book has a `genre_id` foreign
key (for `entity-extraction`). The generator lives at
[`bookshelf/fixtures/generate-books.ts`](https://github.com/mcp-rune/examples/blob/main/bookshelf/fixtures/generate-books.ts)
in the examples repo; `books.5000.json` next to it is just
`generateBookFixtures(5000)` serialized.

Want to load your own data? `loadFixturesFromJson(path)` accepts both
`{ <model>: { <id>: record } }` and `{ <model>: [record, …] }` (auto-keyed
by `record.id`).

## Connect to Claude Desktop

To talk to the same server from Claude Desktop, drop this block into
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bookshelf": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/my-app/server.ts"]
    }
  }
}
```

Replace `/abs/path/to/my-app` with the absolute path to the scaffolded project.
Restart Claude Desktop and the `bookshelf` server will appear in the tool
picker.

## What you got

From `my-app/models/book.ts` (a 30-line file), the framework registered nine
tools — all working immediately, no backend needed:

- **Discovery & strategy** — `list_models`, `get_prompt_guide`,
  `validate_form`, `get_form_summary`
- **CRUD** — `find_records`, `create_model`, `update_model`, `delete_model`,
  `bulk_action_models`

Plus seven interactive MCP apps (`find_model_app`, `show_model_app`,
`new_model_app`, `edit_model_app`, `pick_model_app`, `multi_pick_model_app`,
`view_selection_app`) wired via `createDefaultAppRegistry`. The bookshelf
example's full source is ~150 lines total. Browse it at
[`mcp-rune/examples/bookshelf`](https://github.com/mcp-rune/examples/tree/main/bookshelf)
for the model, prompt, and server wiring.

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
