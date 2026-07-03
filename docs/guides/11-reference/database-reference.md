# Database reference

mcp-rune uses PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension for token storage, operation memory, and analysis features. Database features are **opt-in** — if `DATABASE_URL` is not set, everything works without a database (stdio mode, no OAuth, no analysis tools).

This chapter is the **schema reference**: which tables exist, what they store, which environment variables drive them. For how to run the migrations that create these tables, see [Database setup](./database-setup.md).

## Tables

| Table | Feature group | Purpose |
| --- | --- | --- |
| `oauth_sessions` | `core` | OAuth2 token storage (access/refresh tokens per session) |
| `tool_memories` | `core` | Semantic operation memory (384-dim embeddings via pgvector) |
| `analysis_memories` | `analysis` | Analysis findings with embeddings (ephemeral or persistent) |
| `ingested_records` | `analysis` | Temporary dataset storage plus per-record embeddings (7-day default retention) |
| `ingested_edges` | `analysis` | Typed edges between ingested records (GraphRAG substrate; shares the ingested-records retention) |

The `Feature group` column is what `getPendingMigrations`/`assertMigrationsCurrent` scope against (see [Database setup](./database-setup.md)). The `core` tables are created whenever you run migrations against a `DATABASE_URL`; the `analysis` tables are created when the analysis feature is included. Whether the analysis _tools_ are registered is a separate registry decision — `initVectorStorage({ adapter })` plus `new ToolRegistry({ vectorStorageEnabled: true, toolClasses: { ...ANALYSIS_TOOL_CLASSES } })` — not something the framework infers from an environment variable.

## Environment variables

The framework itself reads only the logging variables below (via `frameworkConfigSchema`). `DATABASE_URL` and `ANALYSIS_ENABLED` are **deployer conventions** the scaffolded runner and your own `config` wire — the framework never reads `process.env.DATABASE_URL` or `process.env.ANALYSIS_ENABLED`. The Postgres pool is injected explicitly via `setPool`, and analysis tools are registered through the registry, so these two rows document the convention the scaffold follows, not framework-internal reads.

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection string. Convention: the scaffolded runner passes it to the pgvector adapter and `setPool`. When unset, the runner starts without a database (stdio mode, no OAuth, no analysis). |
| `ANALYSIS_ENABLED` | `false` | Convention: the scaffolded runner reads this to decide whether to run the `analysis` migrations, call `initVectorStorage`, and spread `ANALYSIS_TOOL_CLASSES` into the registry. The six analysis tools are `analysis_ingest`, `analysis_query`, `analysis_summarize`, `analysis_store`, `analysis_act`, `analysis_clear`. |
| `LOG_LEVEL` | `info` | Logging verbosity: `debug`, `info`, `warn`, `error`. |
| `LOG_FORMAT` | `text` | Console log format: `text` (human-readable key=value pairs) or `json` (structured JSON for Loki/Grafana). |
| `LOG_FILE_FORMAT` | inherits `LOG_FORMAT` | File log format, independent of the console format when set. |
| `LOG_FILE_ENABLED` | `false` | Set to `true` to enable daily-rotated file logging (7-day retention). |

Colorized console output is auto-detected: on when stderr is a TTY, off when captured by a host app or piped to a log collector. The standard [`NO_COLOR`](https://no-color.org) and [`FORCE_COLOR`](https://force-color.org) env vars override detection — set `FORCE_COLOR=1` when running under wrappers like `concurrently` that pipe stderr.

> **Tip:** For local development, run with verbose output:
>
> ```bash
> LOG_LEVEL=debug npx tsx my-app/server.ts
> ```

## See also

- **[Database setup](./database-setup.md)** — how to run migrations (CLI path and manual path), feature gating, upgrading, and troubleshooting.
- [Analysis Memories](../09-retrieval-and-graphrag/analysis-memories.md) — the session lifecycle that uses `analysis_memories` and `ingested_records`.
- [OAuth 2.0 Discovery](../07-auth-and-transport/oauth2-discovery.md) — the flow that populates `oauth_sessions`.
