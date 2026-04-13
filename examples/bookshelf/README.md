# Bookshelf — mcp-kit Example

A minimal MCP server that manages a book library. Demonstrates how mcp-kit generates tools, prompts, and documentation from a model definition.

## What You Get

From a single `Book` model (~40 lines) and a `BookPrompt` (~60 lines), mcp-kit generates:

| Tool | Description |
|------|-------------|
| `list_models` | List books with pagination |
| `find_model` | Find a book by ID |
| `create_model` | Create a new book |
| `update_model` | Update a book |
| `delete_model` | Delete a book |
| `search_records` | Search books |
| `get_prompt_guide` | Get the full book creation guide |
| `validate_form` | Validate book attributes |
| `get_form_summary` | Human-readable summary of form state |

## Quick Start

```bash
cd examples/bookshelf
npm install
```

### Run with MCP Inspector

```bash
npx @modelcontextprotocol/inspector -- node server.js
```

This opens the MCP Inspector in your browser where you can explore all registered tools.

### Try It

1. Call `get_prompt_guide` with `{ "model": "book" }` — see the auto-generated creation guide with field tables, validation rules, and workflow steps
2. Call `validate_form` with `{ "model": "book", "attributes": { "title": "Clean Code" } }` — see validation feedback (missing required field: author)
3. Call `list_models` with `{ "model": "book" }` — lists books (requires API backend)

### Connect from Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bookshelf": {
      "command": "node",
      "args": ["/path/to/mcp-kit/examples/bookshelf/server.js"],
      "env": {
        "ACCESS_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Project Structure

```
bookshelf/
├── models/
│   └── book.js           # Model definition (attributesConfig)
├── prompts/
│   └── book-prompt.js    # Prompt with hybrid strategy
├── config.js             # Server wiring (registries + createServer)
├── server.js             # StdioServer entry point
└── package.json
```

## Notes

- **Strategy tools** (`get_prompt_guide`, `validate_form`, `get_form_summary`) work immediately — no API backend needed
- **CRUD tools** (`list_models`, `create_model`, etc.) require an API backend to handle the actual HTTP calls. Inject your API client in `config.js`
- This example uses the **hybrid** prompt strategy (suitable for 5-10 fields). For simpler models use `stateless`, for complex models (20+ fields) use `stateful`

## Next Steps

- Add more models (e.g., `Author`, `Category`)
- Add OAuth for remote access (`HttpServer` + `OAuthService`)
- Add MCP Apps for interactive forms (`AppRegistry`)
- Add domain workflows for multi-step operations
- See the [mcp-kit docs](../../docs/) for guides on each feature
