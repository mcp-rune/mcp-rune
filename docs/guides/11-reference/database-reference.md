# Database reference

mcp-rune uses PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension for token storage, operation memory, and analysis features. Database features are **opt-in** — if `DATABASE_URL` is not set, everything works without a database (stdio mode, no OAuth, no analysis tools).

This chapter is the **schema reference**: which tables exist, what they store, which environment variables drive them. For how to run the migrations that create these tables, see [Database setup](./database-setup.md).

## Tables

| Table | Feature | Required when | Purpose |
| --- | --- | --- | --- |
| `oauth_sessions` | `core` | `DATABASE_URL` set | OAuth2 token storage (access/refresh tokens per session) |
| `tool_memories` | `core` | `DATABASE_URL` set | Semantic operation memory (384-dim embeddings via pgvector) |
| `analysis_memories` | `analysis` | `ANALYSIS_ENABLED=true` | Analysis findings with embeddings (ephemeral 1h or persistent) |
| `ingested_records` | `analysis` | `ANALYSIS_ENABLED=true` | Temporary dataset storage for large-scale analysis (1h expiry) |
| `ingested_edges` | `analysis` | `ANALYSIS_ENABLED=true` | Typed edges between ingested records (GraphRAG substrate) |

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection string. When unset, all database features are disabled. |
| `ANALYSIS_ENABLED` | `false` | Enable analysis tools (`analysis_ingest`, `analysis_query`, `analysis_store`, `analysis_clear`). Requires `DATABASE_URL`. |
| `LOG_LEVEL` | `info` | Logging verbosity: `debug`, `info`, `warn`, `error`. |
| `LOG_FORMAT` | `text` | Console log format: `text` (human-readable key=value pairs) or `json` (structured JSON for Loki/Grafana). |
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
