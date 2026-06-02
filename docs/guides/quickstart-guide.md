# Quickstart

Get a real MCP server running in under ten minutes. mcp-rune ships an example
server (the _bookshelf_) that exposes the full framework surface — tools,
prompts, validation, interactive apps, and documentation — all generated
from a single 30-line model definition. No database, no API backend, no
auth setup required: the example is wired to an **in-memory `DataLayer`
adapter** that ships with the framework, so every CRUD tool works out of
the box.

## Install

Clone the repo and start the bookshelf example through the MCP Inspector:

```bash
git clone https://github.com/mcp-rune/mcp-rune.git
cd mcp-rune/examples/bookshelf
npm install
npx @modelcontextprotocol/inspector -- npx tsx server.ts
```

The Inspector opens in your browser. You're now connected to a working MCP
server with one model (`Book`), a hybrid prompt strategy, all polymorphic
data tools, and six interactive apps — backed by an in-memory store
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
`examples/bookshelf/models/book.ts`. The last two exercise the in-memory
adapter wired in `examples/bookshelf/config.ts` — the same code path that
hits HTTP in production, just with a different `DataLayer` factory.

## Connect to Claude Desktop

To talk to the same server from Claude Desktop, drop this block into
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bookshelf": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-rune/examples/bookshelf/server.ts"]
    }
  }
}
```

Replace `/path/to/mcp-rune` with the absolute path to your clone. Restart
Claude Desktop and the `bookshelf` server will appear in the tool picker.

## What you got

From `examples/bookshelf/models/book.ts` (a 30-line file), the framework
registered nine tools — all working immediately, no backend needed:

- **Discovery & strategy** — `list_models`, `get_prompt_guide`,
  `validate_form`, `get_form_summary`
- **CRUD** — `find_records`, `create_model`, `update_model`, `delete_model`,
  `bulk_action_models`

Plus six interactive MCP apps (list view, record detail, create/update
forms, multi-pick-model-app picker, search view, autocomplete picker) wired via
`createDefaultAppRegistry`. The bookshelf example's full source is ~150
lines total. See
[`examples/bookshelf/`](https://github.com/mcp-rune/mcp-rune/tree/main/examples/bookshelf)
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
[Data layer](./data-layer-guide.md) ("Swapping the Adapter") and
[API client](./api-client-guide.md) for the full pattern.

## Next

- [Project structure](./project-structure-guide.md) — where models, prompts,
  tools, apps, and the domain registry live in a generated mcp-rune project.
- [Prompt creation](./prompt-creation-guide.md) — the DSL that turns model
  attributes into agent-fillable forms.
- [MCP apps](./mcp-apps-guide.md) — interactive HTML UIs rendered inside
  Claude Desktop.
- [Data layer](./data-layer-guide.md) — the seam between the projection
  layer and any concrete data backend (in-memory, HTTP, custom).
