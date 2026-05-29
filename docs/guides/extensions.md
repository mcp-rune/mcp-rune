---
extension:
  kind: plugin
  what: Author HTTP extensions (routes + middleware)
---

# Extensions

mcp-rune supports **opt-in HTTP extensions** that add routes and route-scoped middleware on top of the framework's built-in OAuth, status, and MCP transport endpoints. Use extensions to ship optional features (a built-in example is [CIMD](../../src/extensions/cimd.ts)) without pulling them into the framework's core surface.

This guide covers the `HttpExtension` API. There is currently no separate `McpExtension` for protocol-level concerns; that interface will be added if and when a real consumer needs it.

## What an HttpExtension is

An `HttpExtension` is an object with a `register(ctx)` function. The framework calls `register()` once during `HttpServer` construction, hands it a pre-created Express `Router` and a narrowed context object, and mounts the resulting router at the server's path prefix.

Extensions are HTTP-layer features: routes, route-scoped middleware, response handlers. They are **not** the place for MCP protocol concerns (tools, prompts, resources) — those belong to the registries passed to `createServer()`.

## What the framework guarantees

mcp-rune never auto-registers an extension. There is no plugin discovery, no scanning of `node_modules`, no env-var sniffing that wires things up behind your back, no convention-based loading. An extension runs **if and only if** you pass it in the `extensions` option on `HttpServer`. Conversely, if you don't pass it, it definitely is not running.

This is deliberate: the answer to "what is actually serving requests in this server?" is always answerable by reading one call site — the `new HttpServer({...})` constructor argument. No surprises from `node_modules`, no implicit behavior from environment variables, no plugin manifest hidden in a config file.

The built-in `cimdExtension` (see [The built-in CIMD extension](#the-built-in-cimd-extension) below) follows this contract like any third-party extension would: it ships in the framework's package, but mcp-rune itself does not enable it. The consumer decides.

## The registration contract

Register extensions through the `extensions` option on `HttpServer`. The shape is `{ [name]: HttpExtension }` — a plain object keyed by an identifier you choose.

```ts
import { HttpServer } from '@mcp-rune/mcp-rune/server'
import { cimdExtension } from '@mcp-rune/mcp-rune/extensions/cimd'

new HttpServer({
  port: 3000,
  oauth: new OAuthService({
    /* ... */
  }),
  mcp: {
    /* ... */
  },
  extensions: {
    cimd: cimdExtension({ redirectUris: ['https://app.example.com/cb'] })
  }
})
```

The key (`'cimd'` above) is the extension's identifier for the lifetime of this server. It is:

- **Used for log lines** (`Extension "cimd" registered`).
- **The dedupe primitive** — object semantics guarantee you cannot register the same key twice.
- **Stable** — built-in extensions document their conventional key. For your own extensions, pick something descriptive (`'rate-limit-by-tenant'`, `'admin-routes'`).

Registration happens in object insertion order, which is the order JavaScript guarantees for string keys.

## The context object

```ts
interface HttpExtensionContext {
  name: string // the key you registered the extension under
  router: Router // pre-created Express Router, mounted at pathPrefix
  baseUrl: string // server origin + pathPrefix, no trailing slash
  pathPrefix: string // '' or e.g. '/api'
  mcpName: string // mcp.name from HttpServer config
  oauth: OAuthService | null // null in token mode
  logger: typeof logger
}
```

What the context deliberately does **not** expose:

- The raw Express `app`. Extensions get a fresh `Router` they own; they cannot mutate global middleware, error handlers, or body parsers.
- The MCP server instance or session store. Those are per-session concerns; HTTP extensions are server-lifetime.
- Direct access to other extensions' state.

This narrowing is deliberate. It is the framework's contract: extensions can break their own routes, but they cannot break the host.

## `requires` capabilities

Declare host capabilities your extension depends on:

```ts
export function myExtension(): HttpExtension {
  return {
    requires: ['oauth'],
    register(ctx) {
      /* ... */
    }
  }
}
```

Currently the only capability is `'oauth'`, which asserts that the host was constructed with an `OAuthService`. If the host is in token mode and an extension declares `requires: ['oauth']`, `HttpServer` throws at construction time with the extension's key in the message. Boot-time failure is the right default — a missing capability surfacing as a 404 at runtime is harder to diagnose than a clear startup error.

## Mount ordering and isolation guarantees

Extensions mount **after** the built-in OAuth router and the status router, and **before** the MCP transport endpoint:

```
1. Global middleware (CORS, security headers, body parsers, request ID, logger)
2. OAuth router (well-known endpoints, /oauth/*)              -- built-in
3. Status router (/health, /cache-stats)                       -- built-in
4. Your extensions, in object insertion order                  -- opt-in
5. /mcp transport route (auth + handler)                       -- built-in
6. Error handler                                               -- built-in
```

Consequences:

- An extension that registers `/oauth/client-metadata.json` will **never** be reached — the built-in OAuth router matches first.
- An extension that registers `/mcp` will **never** intercept MCP traffic — the framework's per-route `app.all(${prefix}/mcp, ...)` is added after extensions but Express still routes the framework's exact-path handler regardless. Either way, the MCP transport is protected.
- Two extensions registering the same path: the one declared first in the object wins.

## A worked example

A request-ID echo extension that adds a small helper endpoint at `/whoami` for debugging:

```ts
import type { HttpExtension } from '@mcp-rune/mcp-rune/extensions'

export function whoamiExtension(): HttpExtension {
  return {
    register(ctx) {
      ctx.router.get('/whoami', (req, res) => {
        ctx.logger.info('whoami requested', {
          service: ctx.mcpName,
          requestId: (req as { requestId?: string }).requestId
        })
        res.json({
          server: ctx.mcpName,
          baseUrl: ctx.baseUrl,
          oauthMode: ctx.oauth !== null
        })
      })
    }
  }
}

// Register:
new HttpServer({
  port: 3000,
  oauth,
  mcp,
  extensions: {
    whoami: whoamiExtension()
  }
})
```

That's a complete extension — interface, factory, registration. No decorators, no DI container, no plugin manifest.

## The built-in CIMD extension

CIMD (Client ID Metadata Document) support ships as a built-in extension. The MCP server publishes a JSON metadata document at `GET /oauth/client-metadata.json` so upstream authorization servers can dereference it as a `client_id` and auto-register the OAuth client — eliminating DCR or pre-registration in test environments.

```ts
import { cimdExtension } from '@mcp-rune/mcp-rune/extensions/cimd'

new HttpServer({
  oauth,
  mcp,
  extensions: {
    cimd: cimdExtension({
      redirectUris: ['https://app.example.com/callback'],
      clientName: 'My MCP Server', // defaults to mcp.name
      scope: 'read write' // defaults to oauth.scopes
    })
  }
})
```

When `cimdExtension()` is called with no options, all fields fall back to defaults derived from the host's `baseUrl`, `mcp.name`, and `oauth.scopes`.

**Why this is an extension, not a core feature**: the MCP Authorization spec's CIMD model has the downstream MCP client host its own metadata document. mcp-rune's implementation is the inverse — the _server_ hosts a single static document. That's a convenience for testing CIMD end-to-end against authorization servers and for accommodating MCP clients (e.g. Opencode) that don't host CIMD themselves. It is not what a strict reading of the spec wants, so the framework makes you opt in.

Source: [`src/extensions/cimd.ts`](../../src/extensions/cimd.ts).

## Stability

The `HttpExtensionContext` shape is **pre-1.0**: it may change in any minor release. Breaking changes will be called out prominently in `CHANGELOG.md` and migration steps will be in the release notes.

Post-1.0, shape changes will be major-version bumps. If you publish an extension as a separate package, pin a `peerDependencies` range that matches the API version you built against:

```json
{
  "peerDependencies": {
    "@mcp-rune/mcp-rune": "^1.0.0"
  }
}
```
