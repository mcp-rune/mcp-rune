# Feature surface (archive)

> Archive of the pre-redesign `README.md` sections that didn't fit the new npm-page-shaped landing. Kept here for the curious browsing the repo on GitHub. **Not linked from `index.md` or the website nav** — content intentionally lives in the repo only.

## Feature surface

|  |  |
| --- | --- |
| **Polymorphic CRUD & bulk** | 8 tools serve every model, including batch create / update / delete and compound-ID nested resources |
| **Prompt DSL** | Declarative sections + field groups; stateless / hybrid / stateful strategies for 20+ field workflows |
| **Interactive MCP Apps** | Schema-derived HTML forms in a sandboxed `ui://` iframe; bidirectional `ontoolinput` / `ontoolresult` channels |
| **Domain intelligence** | `DomainConcept`, `BusinessRule`, `WorkflowDefinition`, `DiagramTemplate` — a declarative registry the LLM reaches for |
| **Multi-step workflows** | `get_workflow_step` + `contextHints` drive long-running, LLM-piloted fetch-analyze loops |
| **GraphRAG analysis** | Local pgvector embeddings + 9 summary strategies + stratified / proximity sampling |
| **OAuth 2.1 + PKCE** | RFC 6749 · 7591 · 7636 · 8414 · 8707 · 9728 + OIDC Core — spec-grade, no shortcuts |
| **Dual transport** | `StdioServer` (local desktop) and `HttpServer` (multi-user, OAuth-protected) from one factory |
| **Four backend seams** | Custom `DataLayer`, `ApiClient`, `ApiConvention`, and `SearchRequestShaper` — replace a built-in default without forking |
| **Three extension shapes** | `HttpExtension` (routes + middleware), `ApiExtension` (verbs / tools beyond CRUD), `ToolFlowExtension` (tool-surface modifiers + runtime context) |
| **Observability** | Structured Winston logs, Langfuse tracing, Sentry error tracking, request-ID correlation across the pipeline |
| **Transient context protocol** | Server-to-client signal collapsing stale tool results once a follow-up call has consumed them |

## Tech stack

TypeScript 5.9 (strict) · Node.js ≥ 24 (ESM) · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (spec 2025-11-25) · Zod v4 · Express 5 · `openid-client` · PostgreSQL + `pgvector` (analysis layer) · Vitest

## Community

- **Discussions** — [github.com/mcp-rune/mcp-rune/discussions](https://github.com/mcp-rune/mcp-rune/discussions)
- **Issues** — [github.com/mcp-rune/mcp-rune/issues](https://github.com/mcp-rune/mcp-rune/issues)
- **Contributing** — see [CONTRIBUTING.md](../../../CONTRIBUTING.md) and [DEVELOPMENT.md](../../../DEVELOPMENT.md)
