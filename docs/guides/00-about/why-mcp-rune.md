# Why mcp-rune?

Every MCP framework today works at the **transport/tool** level. You register tools, handle HTTP, write one handler per operation per model. 10 models × 5 CRUD operations = 50 hand-written tool handlers. Tool lists bloat, LLM tool selection degrades, and you're maintaining boilerplate across every model.

mcp-rune works at the **application** level. You describe your domain, the framework builds the MCP surface:

```
  You write                         mcp-rune generates
 ┌──────────────────┐     ┌────────────────────────────────────────┐
 │  Model           │────▶│  Polymorphic CRUD tools (8 tools       │
 │  attributesConfig│     │    serve ALL models, not N × 5)        │
 └──────────────────┘     ├────────────────────────────────────────┤
 ┌──────────────────┐     │  Prompt guide with validation          │
 │  Prompt          │────▶│    (stateless / hybrid / stateful)     │
 │  fieldGroups     │     ├────────────────────────────────────────┤
 │  sections        │     │  Interactive Apps (form, list,         │
 └──────────────────┘     │    detail, search, autocomplete)       │
                          ├────────────────────────────────────────┤
                          │  Field documentation & reference       │
                          │    tables (auto-generated from config) │
                          └────────────────────────────────────────┘
```

## How it compares

|                                        | Protocol wrappers | API converters | **mcp-rune** |
| -------------------------------------- | :---------------: | :------------: | :----------: |
| Transport (stdio + HTTP)               |        ✅         |       ✅       |      ✅      |
| Tool registration & schema             |        ✅         |       ✅       |      ✅      |
| OAuth 2.1 + PKCE                       |        ⚠️         |       ❌       |      ✅      |
| Polymorphic CRUD from model config     |        ❌         |       ⚠️       |      ✅      |
| Bulk operations (batch CRUD)           |        ❌         |       ❌       |      ✅      |
| API convention abstraction             |        ❌         |       ❌       |      ✅      |
| Prompt strategies (form validation)    |        ❌         |       ❌       |      ✅      |
| Schema-driven interactive Apps         |        ⚠️         |       ❌       |      ✅      |
| Search adapters                        |        ❌         |       ❌       |      ✅      |
| Domain workflows & business rules      |        ❌         |       ❌       |      ✅      |
| Analysis & GraphRAG summary strategies |        ❌         |       ❌       |      ✅      |
| Documentation generation pipeline      |        ❌         |       ❌       |      ✅      |

## Versus specific alternatives

### vs. `@modelcontextprotocol/sdk`

The official SDK provides protocol primitives. mcp-rune builds on top — same protocol compliance plus an application framework. Use the SDK for a single custom tool. Use mcp-rune when you have models, CRUD, forms, and documentation.

### vs. `mcp-framework`

mcp-framework adds CLI scaffolding and directory-based tool discovery. mcp-rune adds a full model-driven architecture — one tool per operation serving all models, prompt strategies, interactive apps, search adapters.

### vs. FastMCP (Python)

FastMCP is the dominant Python framework with excellent DX. mcp-rune is the Node.js counterpart with a higher-level model-driven approach. FastMCP wraps functions as tools. mcp-rune derives entire tool suites from model definitions. They complement each other — FastMCP for Python, mcp-rune for Node.js.

### vs. Stainless / FastAPI-MCP

API converters generate tools from OpenAPI specs. mcp-rune goes the other direction — you define models and the framework handles both the MCP surface and the API communication, including payload conventions and search adapters.

## When mcp-rune isn't the right fit

- You need a single, bespoke tool with no model-level structure — use the official SDK directly.
- You already have an OpenAPI spec and want a thin tool wrapper around it — use an API converter.
- Your runtime isn't Node.js — see FastMCP (Python) or the official SDKs for other languages.

If your MCP server has models, forms, validation logic, and grows over time, that's exactly the shape mcp-rune was extracted to handle. See the [Quickstart](../01-getting-started/quickstart.md) to get a real server running in under ten minutes.
