# About

Why mcp-rune exists, the worldview that shaped it, and how it compares to other MCP frameworks. Read this section if you want to know what kind of framework you're committing to before opening the Quickstart.

**Read in this order:**

1. [Philosophy](./philosophy.md) — the "inscribe small, cast large" worldview, the layer diagram, and the seven principles every API decision is held to.
2. [Why mcp-rune?](./why-mcp-rune.md) — application-level framework vs transport-level wrapper, with the comparison matrix.

## How the rest of the guides are organized

The guides that follow are arranged as a four-part book that mirrors the order you actually build an mcp-rune server. Each part hands off to the next; reading top-to-bottom is the intended path.

- **Part I · Foundations** — [Getting Started](../01-getting-started/), [The Model](../02-the-model/), [The Prompt](../03-the-prompt/), [Tools](../04-tools/), [Apps](../05-apps/). What you write.
- **Part II · The Three Layers Up Close** — [Data, model, and analysis layers](../06-the-three-layers-up-close/), [Auth & Transport](../07-auth-and-transport/). What's behind the interfaces your tools and apps call into.
- **Part III · Intelligence** — [Domain Knowledge](../08-domain-knowledge/), [Retrieval & GraphRAG](../09-retrieval-and-graphrag/). What turns a CRUD server into something an LLM can reason against.
- **Part IV · Extending** — [Extensions](../10-extensions/), [Reference](../11-reference/). How to add new capability without forking.

## Example servers used throughout

Every code snippet in the guides is drawn from one of the example servers in [`mcp-rune-examples`](https://github.com/mcp-rune/examples). You can clone any of them and follow along with a real running server while you read.

| Example | Demonstrates | Used by |
| --- | --- | --- |
| `tasks` | Smallest realistic shape — `Project`, `Task`, `Tag`; belongsTo + hasMany | The Model, The Prompt (trivial illustrations) |
| `bookshelf` | Hand-picked seed data, full polymorphic tool surface, MCP apps | Quickstart, Tools, Apps |
| `bookshelf-graph` | Domain registry + analysis tools + 9 summary strategies over 500 books | Domain Knowledge, Retrieval & GraphRAG, workflows |
| `bookshelf-rest` | Real `DataLayer` swap to HTTP via custom `ApiClient` + convention | Part II — data, api-client, convention, search |
| `bookshelf-remote` | `HttpServer` deployment, static-token auth then OAuth 2.1 | Part II — auth & transport |

The rule we follow when picking an example for a snippet: **the smallest one that exercises the feature**. `tasks` is plenty for "what does a Model look like?"; `bookshelf-graph` earns its complexity when the chapter is about edge extraction or summary strategies.
