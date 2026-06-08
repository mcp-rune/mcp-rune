# Transport & Observability

mcp-rune supports both MCP transports from the same server factory — your tools, prompts, and apps work identically whether they run locally over stdio or remotely over HTTP. Production-grade logging, tracing, and error tracking are wired into the framework via vendor-agnostic facades so you can swap adapters without changing call sites.

## Dual transport

Use `StdioServer` for local development (the host process spawns mcp-rune as a child — Claude Desktop, Cursor, VS Code):

```ts file=examples/transport-01.ts
import { StdioServer } from '@mcp-rune/mcp-rune/server'

new StdioServer({
  accessToken: process.env.ACCESS_TOKEN,
  mcp: mcpConfig
}).start()
```

```js file=examples/transport-01.js
import { StdioServer } from '@mcp-rune/mcp-rune/server'
new StdioServer({
  accessToken: process.env.ACCESS_TOKEN,
  mcp: mcpConfig
}).start()
```

Use `HttpServer` for remote, multi-user deployments protected by OAuth:

```ts file=examples/transport-02.ts
import { HttpServer } from '@mcp-rune/mcp-rune/server'

new HttpServer({
  port: 4100,
  oauth,
  mcp: mcpConfig
}).start()
```

```js file=examples/transport-02.js
import { HttpServer } from '@mcp-rune/mcp-rune/server'
new HttpServer({
  port: 4100,
  oauth,
  mcp: mcpConfig
}).start()
```

Both servers accept the same `mcp` configuration. Tool/prompt/app registries are transport-agnostic; the only reason to branch on transport is when you wire surface-level concerns like rate limiting (`HttpServer` only) or token sources (`StdioServer` uses an env var, `HttpServer` uses the OAuth flow).

See the [OAuth 2.0 Discovery guide](./oauth2-discovery.md) for the auth story attached to `HttpServer`.

## Observability

Five built-in capabilities cover the production basics:

- **Structured logging** — Winston with JSON and text formats, daily file rotation when `LOG_FILE_ENABLED=true`. Configure verbosity with `LOG_LEVEL` and console format with `LOG_FORMAT`.
- **Distributed tracing** — vendor-agnostic facade with a Langfuse adapter included. Wire a different backend by implementing the tracing interface.
- **Error tracking** — same facade pattern, with a Sentry adapter included.
- **Request ID correlation** — `X-Request-ID` flows across all services so you can stitch together a single request across logs, traces, and errors.
- **Embeddings** — local `all-MiniLM-L6-v2` model for semantic search; no network round-trip and no per-call cost. Optional, used by the analysis layer.

```ts file=examples/transport-03.ts
import { logger, tracing, errorTracking } from '@mcp-rune/mcp-rune/services'

logger.info({ msg: 'request received', requestId, model: 'book' })

await tracing.withSpan('create_book', async (span) => {
  span.setAttribute('user.id', userId)
  return await createBook(input)
})

errorTracking.captureException(err, { tags: { tool: 'create_model' } })
```

```js file=examples/transport-03.js
import { logger, tracing, errorTracking } from '@mcp-rune/mcp-rune/services'
logger.info({ msg: 'request received', requestId, model: 'book' })
await tracing.withSpan('create_book', async (span) => {
  span.setAttribute('user.id', userId)
  return await createBook(input)
})
errorTracking.captureException(err, { tags: { tool: 'create_model' } })
```

See [`database-reference.md`](../11-reference/database-reference.md) for the full environment-variable reference covering log level, log format, and database options.
