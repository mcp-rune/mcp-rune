# Quickstart

Get a real MCP server running in under ten minutes. mcp-rune ships an example server (the _bookshelf_) that exposes the full framework surface — tools, prompts, validation, and documentation — all generated from a single 30-line model definition. No database, no API backend required.

## Install

Clone the repo and start the bookshelf example through the MCP Inspector:

```bash
git clone https://github.com/mcp-rune/mcp-rune.git
cd mcp-rune/examples/bookshelf
npm install
npx @modelcontextprotocol/inspector -- npx tsx server.ts
```

The Inspector opens in your browser. You're now connected to a working MCP server with one model (`Book`), a hybrid prompt strategy, and all polymorphic tools registered.

## Try a tool

Inside the Inspector, call:

1. **`get_prompt_guide`** with `{ "model": "book" }` — see the auto-generated creation guide that an LLM would use to fill the form.
2. **`validate_form`** with `{ "model": "book", "attributes": { "title": "Clean Code" } }` — see structured validation feedback for a partial submission.

Both tools work without any external service. They're derived from the model definition in `examples/bookshelf/models/book.ts`.

## Connect to Claude Desktop

To talk to the same server from Claude Desktop, drop this block into `claude_desktop_config.json`:

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

Replace `/path/to/mcp-rune` with the absolute path to your clone. Restart Claude Desktop and the `bookshelf` server will appear in the tool picker.

## What you got

From `examples/bookshelf/models/book.ts` (a 30-line file), the framework registered:

- **Tools that work immediately** (no API backend) — `list_models`, `get_prompt_guide`, `validate_form`, `get_form_summary`, `get_filters_guide`.
- **Tools that need an API backend** — `create_model`, `find_model`, `update_model`, `delete_model`, `search_records`, `bulk_action_models`.

The bookshelf example's full source is ~150 lines total. See [`examples/bookshelf/`](https://github.com/mcp-rune/mcp-rune/tree/main/examples/bookshelf) for the model, prompt, and server wiring.

## Next

- [Project structure](./project-structure-guide.md) — where models, prompts, tools, apps, and the domain registry live in a generated mcp-rune project.
- [Prompt Creation](./prompt-creation-guide.md) — the DSL that turns model attributes into agent-fillable forms.
- [MCP Apps](./mcp-apps-guide.md) — interactive HTML UIs rendered inside Claude Desktop.
