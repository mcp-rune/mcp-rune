# Database Reference

mcp-rune uses PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension for token storage, operation memory, and analysis features. Database features are **opt-in** — if `DATABASE_URL` is not set, everything works without a database (stdio mode, no OAuth, no analysis tools).

## Tables

| Table               | Feature    | Required when           | Purpose                                                        |
| ------------------- | ---------- | ----------------------- | -------------------------------------------------------------- |
| `oauth_sessions`    | `core`     | `DATABASE_URL` set      | OAuth2 token storage (access/refresh tokens per session)       |
| `tool_memories`     | `core`     | `DATABASE_URL` set      | Semantic operation memory (384-dim embeddings via pgvector)    |
| `analysis_memories` | `analysis` | `ANALYSIS_ENABLED=true` | Analysis findings with embeddings (ephemeral 1h or persistent) |
| `ingested_records`  | `analysis` | `ANALYSIS_ENABLED=true` | Temporary dataset storage for large-scale analysis (1h expiry) |

## Running migrations

mcp-rune exports migration SQL via `@mcp-rune/mcp-rune/db/migrations`. Write a migration runner that suits your project — here's a minimal example you can drop into a `scripts/migrate.ts`:

```ts file=src/pool.ts
import pg from 'pg'
import { migrations } from '@mcp-rune/mcp-rune/db/migrations'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)

const { rows } = await client.query('SELECT version FROM schema_migrations')
const applied = new Set(rows.map((r) => r.version))

for (const migration of migrations) {
  if (applied.has(migration.version)) continue

  await client.query('BEGIN')
  await client.query(migration.up)
  await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
    migration.version,
    migration.name
  ])
  await client.query('COMMIT')
  console.log(`Applied: ${migration.version}_${migration.name}`)
}

client.release()
await pool.end()
```

```js file=src/pool.js
import pg from 'pg'
import { migrations } from '@mcp-rune/mcp-rune/db/migrations'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()
await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)
const { rows } = await client.query('SELECT version FROM schema_migrations')
const applied = new Set(rows.map((r) => r.version))
for (const migration of migrations) {
  if (applied.has(migration.version)) continue
  await client.query('BEGIN')
  await client.query(migration.up)
  await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
    migration.version,
    migration.name
  ])
  await client.query('COMMIT')
  console.log(`Applied: ${migration.version}_${migration.name}`)
}
client.release()
await pool.end()
```

To apply only a subset — for example, skip analysis tables when `ANALYSIS_ENABLED` is false:

```ts file=src/needed.ts
const needed = migrations.filter(
  (m) => m.feature === 'core' || process.env.ANALYSIS_ENABLED === 'true'
)
```

```js file=src/needed.js
const needed = migrations.filter(
  (m) => m.feature === 'core' || process.env.ANALYSIS_ENABLED === 'true'
)
```

## Environment variables

| Variable           | Default | Description                                                                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | —       | PostgreSQL connection string. When unset, all database features are disabled.                                             |
| `ANALYSIS_ENABLED` | `false` | Enable analysis tools (`analysis_ingest`, `analysis_query`, `analysis_store`, `analysis_clear`). Requires `DATABASE_URL`. |
| `LOG_LEVEL`        | `info`  | Logging verbosity: `debug`, `info`, `warn`, `error`.                                                                      |
| `LOG_FORMAT`       | `text`  | Console log format: `text` (human-readable key=value pairs) or `json` (structured JSON for Loki/Grafana).                 |
| `LOG_FILE_ENABLED` | `false` | Set to `true` to enable daily-rotated file logging (7-day retention).                                                     |

Colorized console output is auto-detected: on when stderr is a TTY, off when captured by a host app or piped to a log collector. The standard [`NO_COLOR`](https://no-color.org) and [`FORCE_COLOR`](https://force-color.org) env vars override detection — set `FORCE_COLOR=1` when running under wrappers like `concurrently` that pipe stderr.

> **Tip:** For local development, run with verbose output:
>
> ```bash
> LOG_LEVEL=debug npx tsx my-app/server.ts
> ```

See [Analysis Memories](../09-retrieval-and-graphrag/analysis-memories.md) for the session lifecycle that uses `analysis_memories` and `ingested_records`, and the [OAuth 2.0 Discovery](../07-auth-and-transport/oauth2-discovery.md) guide for the flow that populates `oauth_sessions`.
