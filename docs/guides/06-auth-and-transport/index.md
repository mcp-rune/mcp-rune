# Auth & Transport

OAuth 2.0 the spec-compliant way, plus the dual transport story (stdio for local, HTTP for multi-user) and the observability primitives built on top.

**Read in this order:**

1. [OAuth 2.0 Discovery](./oauth2-discovery.md) — RFC 9728 PRM · RFC 8414 server metadata · RFC 7591 DCR · RFC 7636 PKCE · RFC 8707 resource indicators
2. [Transport & Observability](./transport.md) — `StdioServer` vs `HttpServer` from one factory; structured logging, distributed tracing, error tracking, request-ID correlation
