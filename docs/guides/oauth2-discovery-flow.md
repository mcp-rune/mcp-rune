# OAuth 2.0 Discovery Flow

This document describes the OAuth 2.0 flow implemented by the MCP servers in this repository, with explicit citations of the RFCs each route implements. It is the canonical, current reference for the HTTP transport's authentication story.

## Overview

Any MCP server that enables OAuth via `lib/mcp/http-server.js` acts as an **OAuth 2.0 Resource Server**. It:

- Exposes RFC 9728 Protected Resource Metadata so clients can discover the authorization server.
- **Proxies** authorization-server metadata (RFC 8414), Dynamic Client Registration (RFC 7591), authorize/token endpoints (RFC 6749), and forwards PKCE (RFC 7636) and resource indicators (RFC 8707) parameters transparently to an upstream authorization server.
- Validates bearer tokens on `/mcp` via token introspection against the authorization server.

The MCP server never issues tokens itself (except via the M2M `/mcp/m2m/token` convenience endpoint, which is a thin wrapper around the authorization server's Client Credentials grant). All user authentication and token issuance happens on the authorization server; the MCP server is a thin, spec-compliant façade.

## RFC Map

| RFC                               | Title                                                | Route(s) exposed                                                                             | Implementation                                                                      |
| --------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| RFC 6749                          | The OAuth 2.0 Authorization Framework                | `GET /oauth/authorize`, `POST /oauth/token`                                                  | `lib/mcp/middleware/oauth-router.js` — authorize handler, token proxy               |
| RFC 7591                          | OAuth 2.0 Dynamic Client Registration Protocol (DCR) | `POST /oauth/register`                                                                       | `lib/mcp/middleware/oauth-router.js`                                                |
| RFC 7636                          | Proof Key for Code Exchange (PKCE)                   | Forwarded through `/oauth/authorize` and `/oauth/token`                                      | Client provides `code_challenge`/`code_verifier`; parameters pass through unchanged |
| RFC 8414                          | OAuth 2.0 Authorization Server Metadata              | `GET /.well-known/oauth-authorization-server`, `GET /.well-known/openid-configuration`       | `lib/mcp/middleware/oauth-router.js` — server metadata, openid alias                |
| RFC 8707                          | Resource Indicators for OAuth 2.0                    | `resource` query/body param forwarded on authorize + token                                   | `lib/oauth2/service.js`                                                             |
| RFC 9728                          | OAuth 2.0 Protected Resource Metadata                | `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-protected-resource/mcp` | `lib/mcp/middleware/oauth-router.js` — both forms share one handler                 |
| MCP Authorization spec 2025-06-18 | MCP-specific framing of the above                    | `WWW-Authenticate` on `/mcp` with `resource_metadata` parameter                              | `lib/mcp/middleware/oauth-router.js` — `sendUnauthorized()`                         |

## End-to-End Discovery Flow

<!-- illustration: oauth2-discovery-flow#flow -->

```
Client                                    MCP Server                         Auth Server
──────                                    ──────────                         ───────────
  │  POST /mcp (no token)                    │                                  │
  │ ───────────────────────────────────────▶ │                                  │
  │                  401 Unauthorized        │                                  │
  │  WWW-Authenticate: Bearer                │                                  │
  │    resource_metadata=                    │                                  │
  │      "…/.well-known/oauth-protected-     │                                  │
  │       resource/mcp"        (RFC 9728 §3.1)                                  │
  │ ◀─────────────────────────────────────── │                                  │
  │                                          │                                  │
  │  GET /.well-known/oauth-protected-       │                                  │
  │      resource/mcp           (RFC 9728 §3.1)                                 │
  │ ───────────────────────────────────────▶ │                                  │
  │  { resource, authorization_servers }     │                                  │
  │ ◀─────────────────────────────────────── │                                  │
  │                                          │                                  │
  │  GET /.well-known/oauth-authorization-   │                                  │
  │      server                   (RFC 8414) │                                  │
  │ ───────────────────────────────────────▶ │ ── fetch upstream ─────────────▶ │
  │  { endpoints rewritten to MCP server }   │ ◀─────────────────────────────── │
  │ ◀─────────────────────────────────────── │                                  │
  │                                          │                                  │
  │  POST /oauth/register         (RFC 7591 — DCR, proxied)                     │
  │ ───────────────────────────────────────▶ │ ─────────── proxied ───────────▶ │
  │  { client_id, client_secret }            │ ◀─────────────────────────────── │
  │ ◀─────────────────────────────────────── │                                  │
  │                                          │                                  │
  │  GET /oauth/authorize         (RFC 6749 + RFC 7636 PKCE + RFC 8707 resource)│
  │ ───────────────────────────────────────▶ │ ─── 302 redirect ──────────────▶ │
  │                                          │                                  │
  │  (user authenticates on auth server; auth server redirects back to          │
  │   MCP server's /oauth/callback with auth code)                              │
  │                                          │                                  │
  │  POST /oauth/token            (RFC 6749 + PKCE + resource indicator)        │
  │ ───────────────────────────────────────▶ │ ─────────── proxied ───────────▶ │
  │  { access_token, refresh_token }         │ ◀─────────────────────────────── │
  │ ◀─────────────────────────────────────── │                                  │
  │                                          │                                  │
  │  POST /mcp + Authorization: Bearer …     │                                  │
  │ ───────────────────────────────────────▶ │ ─── introspect (cached) ───────▶ │
  │  Session created, MCP tools served       │ ◀─────────────────────────────── │
```

## RFC 9728 §3.1 Path-Insertion and the "Why Two Routes?" Quirk

RFC 9728 §3.1 defines how to build the Protected Resource Metadata URL for a resource whose URL has a **non-root path**:

> The well-known path component (`.well-known/oauth-protected-resource`) is inserted **between the origin and the resource path**, not appended at the root.

Example for this repo:

| Resource URL (the `/mcp` endpoint)      | Canonical metadata URL (RFC 9728 §3.1)                                       |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `http://localhost:4100/mcp`             | `http://localhost:4100/.well-known/oauth-protected-resource/mcp`             |
| `https://example.com/my-mcp-server/mcp` | `https://example.com/.well-known/oauth-protected-resource/my-mcp-server/mcp` |

`buildResourceMetadataUrl()` in `lib/mcp/middleware/oauth-router.js` constructs this form, and `sendUnauthorized()` advertises it in the `WWW-Authenticate: Bearer resource_metadata="…"` header whenever `/mcp` is hit without a token.

### Both forms are served

The router registers the same handler on **two paths**:

1. `/.well-known/oauth-protected-resource` — origin-only, legacy/fallback form.
2. `/.well-known/oauth-protected-resource/mcp` — RFC 9728 §3.1 canonical form for the `${baseUrl}/mcp` resource.

**Why serve both?** Because the two groups of clients in the wild behave differently:

- **Strict clients** (aligned with MCP spec 2025-06-18) parse the `resource_metadata` parameter from the `WWW-Authenticate` header and fetch it verbatim. They hit the `/mcp`-suffixed URL and expect a 200. If the server did not serve this form, these clients would fail discovery entirely.
- **MCP Inspector** (up to current versions) implements an extra-spec fallback: if the path-suffixed URL 404s, it retries the origin-only URL. This behavior is **not required by RFC 9728** and must not be relied upon in new client implementations. We serve the origin-only form so the existing Inspector workflow keeps working.

### Diagnostic: the two log lines

If your logs show this pair:

```
GET /.well-known/oauth-protected-resource       → 200 / 304
GET /.well-known/oauth-protected-resource/mcp   → 404
```

…the server is advertising the §3.1 URL in `WWW-Authenticate` but not serving it. MCP Inspector hides the problem via its fallback, but strict clients break. The fix is exactly what this repo now does: register both forms with the same handler. See `lib/mcp/middleware/oauth-router.js` around the `protectedResourceHandler` definition and the `__tests__/lib/mcp/middleware/oauth-router.spec.js` spec that covers the §3.1 path.

## Path-Prefixed Deployments (`/my-mcp-server/mcp` rather than `/mcp`)

`.well-known` URIs are **origin-scoped** by RFC 8615 and re-affirmed by RFC 9728 §3.1: they live at the root of the host, with the resource path appended _after_ the well-known segment, never nested inside a sub-path. That means a server reverse-proxied under a non-root path **cannot** serve its own Protected Resource Metadata at the canonical URL — the framework's HTTP listener simply never sees requests for `/.well-known/...` once an upstream proxy is routing only `/my-mcp-server/*` to it.

When `HttpServer` is constructed with a non-empty `pathPrefix`, the OAuth router auto-skips registering the PRM endpoints (`serveProtectedResourceMetadata: false`). The `WWW-Authenticate` header continues to advertise the correct origin-rooted URL via `buildResourceMetadataUrl()`, and the operator is responsible for serving that URL from the reverse proxy.

Example for a deployment at `https://example.com/my-mcp-server/mcp`:

| Element                                         | Value                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Resource URL                                    | `https://example.com/my-mcp-server/mcp`                                                                 |
| Canonical PRM URL (RFC 9728 §3.1)               | `https://example.com/.well-known/oauth-protected-resource/my-mcp-server/mcp`                            |
| `WWW-Authenticate` (emitted by mcp-rune on 401) | `Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/my-mcp-server/mcp"` |
| Served by                                       | **Upstream reverse proxy**, _not_ mcp-rune                                                              |

Minimal nginx snippet to serve the PRM JSON at the origin root:

```nginx
location = /.well-known/oauth-protected-resource/my-mcp-server/mcp {
    default_type application/json;
    add_header Access-Control-Allow-Origin *;
    return 200 '{"resource":"https://example.com/my-mcp-server/mcp","authorization_servers":["https://example.com"]}';
}
```

For the root-mount case (`pathPrefix` empty / unset), nothing changes: mcp-rune serves both PRM forms itself.

## Unauthorized Response Contract

Every request to `/mcp` without a valid bearer token receives:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"
Content-Type: application/json

{ "error": "unauthorized", "error_description": "Authentication required. See WWW-Authenticate header for authorization server details." }
```

This matches MCP spec 2025-06-18 (`§ Authorization`) and RFC 9728 §5.1. The `resource_metadata` URL is always the §3.1 path-inserted form.

## Related Files

| File                                                | Role                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `lib/mcp/middleware/oauth-router.js`                | Express router with all OAuth routes + `buildResourceMetadataUrl` / `sendUnauthorized` helpers                     |
| `lib/mcp/http-server.js`                            | HTTP server entry point; mounts the OAuth router and invokes `sendUnauthorized` on unauthenticated `/mcp` requests |
| `lib/oauth2/service.js`                             | OAuth client logic: token introspection, client-credentials grant, resource indicator handling                     |
| `__tests__/lib/mcp/middleware/oauth-router.spec.js` | Route-level unit tests, including RFC 9728 §3.1 coverage                                                           |
| `docs/authorization-coverage.md`                    | Conformance coverage matrix — maps test cases to RFC sections                                                      |
