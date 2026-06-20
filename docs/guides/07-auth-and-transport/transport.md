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

- **Structured logging** — Winston with JSON and text formats, daily file rotation when `LOG_FILE_ENABLED=true`. At bootstrap the logger honors `LOG_LEVEL`, `LOG_FORMAT`, `LOG_FILE_FORMAT`, `LOG_FILE_ENABLED`, and `NODE_ENV` directly (the usual convention for a logging subsystem, so `LOG_LEVEL=debug npx tsx server.ts` just works). To bring these under your validated config object instead, spread `frameworkConfigSchema` (from `@mcp-rune/mcp-rune/core`) into your schema and call `configureLogging(config.logging)` after `loadConfig()` — injected values then supersede the env. See [Config schema](#config-schema).
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

## Config schema

`loadConfig(schema)` (from `@mcp-rune/mcp-rune/core`) reads env vars through one declarative schema, collects **all** validation errors at once, masks sensitive values in `toString()`, and returns a frozen config object. The framework reads no env vars of its own for app/business config — you inject everything via constructors — with one deliberate exception: the logger.

The logger honors the standard logging env vars at bootstrap (so logging works before any config is loaded, and `LOG_LEVEL=debug` behaves as expected). To fold those vars into your validated config instead, spread `frameworkConfigSchema` and hand the result to `configureLogging()` — the injected values then supersede the bootstrap, and there is no silent env fallback for anything you declared:

```ts
import { loadConfig, frameworkConfigSchema } from '@mcp-rune/mcp-rune/core'
import { logger } from '@mcp-rune/mcp-rune/runtime'

export const config = loadConfig({
  ...frameworkConfigSchema, // logging.{level,format,fileFormat,fileEnabled}, runtime.environment
  api: { url: { env: 'API_URL', default: 'http://localhost:4001' } }
  // ...rest of your app schema
})

logger.configureLogging({
  ...config.logging,
  production: config.runtime.environment === 'production'
})
```
