# Auth & Transport

Part II covered what's _behind_ the three layers your tools and apps call into. This chapter covers the surrounding concerns: **who can call your server** (OAuth 2.0, the spec-compliant way), and **how they reach it** (stdio for local desktop, HTTP for multi-user). Both are configured at the same composition root in `server.ts`; one factory produces either shape.

The `bookshelf-remote` example is the running example here — it boots as an `HttpServer`, ships with a static-token auth shortcut for local development, and demonstrates how to swap the static token for full OAuth 2.1 discovery without touching tools, prompts, or apps.

**Read in this order:**

1. [OAuth 2.0 Discovery](./oauth2-discovery.md) — RFC 9728 PRM · RFC 8414 server metadata · RFC 7591 DCR · RFC 7636 PKCE · RFC 8707 resource indicators.
2. [Transport & observability](./transport.md) — `StdioServer` vs `HttpServer` from one factory; structured logging, distributed tracing, error tracking, request-ID correlation.

When you finish this section, the framework's mechanical concerns are covered. Part III ([Domain knowledge](../08-domain-knowledge/), [Retrieval & GraphRAG](../09-retrieval-and-graphrag/)) is where the framework earns its keep on something more interesting than CRUD: declarative domain rules and analysis-grade retrieval that grounds LLM answers in your data.
