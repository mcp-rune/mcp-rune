# Database setup

This is the how-to for running mcp-rune's database migrations end-to-end. For the schema reference (which tables exist, which columns, what environment variables drive them), see [Database reference](./database-reference.md).

## Who runs migrations?

**You do.** mcp-rune ships migration SQL via the `@mcp-rune/mcp-rune/db/migrations` subpath import; it does **not** run the migrations automatically when your server starts. The framework deliberately leaves the runner to deployers so you can fit migrations into your existing release process — your CI, your blue/green flow, your "halt writes, migrate, resume writes" runbook.

If you used `rune new` to scaffold the project, the CLI has already wired up a runner script for you. If you didn't, the same pattern is two dozen lines of `pg.Pool` code — see the manual path below.

> Database features are **opt-in.** When `DATABASE_URL` is not set, mcp-rune runs without OAuth session storage, operation memory, or analysis tools. No migrations are needed in that mode.

## The easy path: `rune new`

The [`rune new`](https://github.com/dsaenz/mcp-rune-cli) CLI scaffolds the runner, configures `DATABASE_URL`, verifies the connection, and runs the migrations as part of the project-creation flow. When you select an analysis-enabled preset, the CLI prompts you to choose:

| Choice                      | What happens                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use docker-compose pgvector | The CLI starts the scaffolded `docker-compose.yml` (Postgres + pgvector), writes the docker URL to `.env`, waits for the DB to be ready, runs `npm run db:migrate`.           |
| Use existing `DATABASE_URL` | The CLI prompts for the URL, writes it to `.env`, runs `SELECT 1` to verify, then runs `npm run db:migrate`.                                                                  |
| Skip                        | The scaffolded project includes a `db-migrate.ts` and a `db:migrate` npm script; you can run them later with `npm run db:migrate` (or restart this flow with `rune db init`). |

After scaffold, the runner stays in your repo at `src/scripts/db-migrate.ts`. Re-run it any time you upgrade mcp-rune and pick up new migrations:

```bash
npm run db:migrate
```

The script tracks applied versions in a `schema_migrations` table and is idempotent — running it against an up-to-date database is a no-op.

## The manual path

If you didn't scaffold with the CLI, or you want a custom runner (for example, embedding migrations in a Rails task or a CI step), import the `migrations` array and feed it to your own pg client. The minimal viable runner:

```ts file=src/scripts/migrate.ts
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

```js file=src/scripts/migrate.js
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

The `Migration` shape exported alongside the array is:

```ts
interface Migration {
  version: string // '001', '002', …
  name: string // 'create_oauth_sessions', …
  feature: 'core' | 'analysis' // see "Feature gating" below
  up: string // SQL DDL — CREATE TABLE, CREATE INDEX, etc.
}
```

There is no `down` SQL. Rollback is the deployer's responsibility — write a reverse migration in your own runner if your release process needs it.

## Feature gating

Every migration is tagged with `feature: 'core'` or `feature: 'analysis'`. Apply only what you need:

```ts file=src/scripts/needed.ts
const needed = migrations.filter(
  (m) => m.feature === 'core' || process.env.ANALYSIS_ENABLED === 'true'
)
```

```js file=src/scripts/needed.js
const needed = migrations.filter(
  (m) => m.feature === 'core' || process.env.ANALYSIS_ENABLED === 'true'
)
```

| Feature group | When required           | Tables                                                    |
| ------------- | ----------------------- | --------------------------------------------------------- |
| `core`        | `DATABASE_URL` is set   | `oauth_sessions`, `tool_memories`                         |
| `analysis`    | `ANALYSIS_ENABLED=true` | `analysis_memories`, `ingested_records`, `ingested_edges` |

A server running stdio without OAuth and without analysis tools needs no migrations at all.

## Upgrading mcp-rune

When a new mcp-rune release adds migrations, the upgrade flow is:

1. Bump `@mcp-rune/mcp-rune` in `package.json`, install.
2. Re-run your migration runner. New entries in the `migrations` array are applied; existing entries are skipped because `schema_migrations.version` already contains them.
3. Restart the server.

The runner is idempotent by version, so it is safe to run on every deploy.

## Troubleshooting

**`ERROR: extension "vector" is not available`** — migration 002 creates the pgvector extension. Make sure your Postgres image bundles it (the official `pgvector/pgvector:pg16` image, or install `postgresql-16-pgvector` on a system Postgres). The scaffolded `docker-compose.yml` uses the right image.

**`permission denied to create extension "vector"`** — `CREATE EXTENSION` requires a superuser by default. Either run migrations as a superuser, or have a DBA run `CREATE EXTENSION vector` once outside the runner, then drop the `CREATE EXTENSION IF NOT EXISTS` line from migration 002 in your fork (or skip it conditionally before running the array).

**`ECONNREFUSED` against the docker URL** — the Postgres container takes a few seconds to accept connections after `docker compose up`. The CLI's `rune new` flow waits for it; if you run `npm run db:migrate` manually right after `docker compose up`, give it ~5 seconds.

**Migrations apply but server still errors on OAuth tables** — check that `DATABASE_URL` in your process environment matches the one you ran migrations against. The two paths can diverge if you have `.env` and shell variables overlapping.

## See also

- [Database reference](./database-reference.md) — the table-by-table schema reference and the full environment-variable list.
- [Analysis Memories](../09-retrieval-and-graphrag/analysis-memories.md) — the session lifecycle that uses `analysis_memories` and `ingested_records`.
- [OAuth 2.0 Discovery](../07-auth-and-transport/oauth2-discovery.md) — the flow that populates `oauth_sessions`.
