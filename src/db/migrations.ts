/**
 * Database Migrations
 *
 * Exported SQL definitions for all tables required by mcp-rune features.
 * Consumers import these and feed them to their own migration runner.
 *
 * @example
 * import { migrations } from '@mcp-rune/mcp-rune/db/migrations'
 *
 * for (const migration of migrations) {
 *   await client.query(migration.up)
 * }
 */

import type { Pool } from 'pg'

export interface Migration {
  /** Sequential version identifier (e.g. '001') */
  version: string
  /** Descriptive name (e.g. 'create_oauth_sessions') */
  name: string
  /** Feature that requires this table: 'core' (DATABASE_URL) or 'analysis' (ANALYSIS_ENABLED) */
  feature: 'core' | 'analysis'
  /** SQL DDL to create the table and indexes */
  up: string
}

/**
 * All mcp-rune database migrations, ordered by version.
 *
 * Feature groups:
 * - **core**: Required when DATABASE_URL is set (OAuth token storage, operation memory)
 * - **analysis**: Required when ANALYSIS_ENABLED=true (analysis findings, ingested records)
 */
export const migrations: readonly Migration[] = [
  {
    version: '001',
    name: 'create_oauth_sessions',
    feature: 'core',
    up: `
      CREATE TABLE IF NOT EXISTS oauth_sessions (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        scope TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        mcp_session_id TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_sessions_mcp_session_id
        ON oauth_sessions(mcp_session_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_sessions_user_id
        ON oauth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires_at
        ON oauth_sessions(expires_at);
    `
  },
  {
    version: '002',
    name: 'create_tool_memories',
    feature: 'core',
    up: `
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE IF NOT EXISTS tool_memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        embedding vector(384),
        tool_name TEXT NOT NULL,
        tool_args JSONB,
        tool_output JSONB,
        user_id TEXT,
        session_id TEXT,
        summary TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tool_memories_created_at
        ON tool_memories (created_at);
      CREATE INDEX IF NOT EXISTS idx_tool_memories_tool_name
        ON tool_memories (tool_name);
      CREATE INDEX IF NOT EXISTS idx_tool_memories_session_id
        ON tool_memories (session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_memories_embedding
        ON tool_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    `
  },
  {
    version: '003',
    name: 'create_analysis_memories',
    feature: 'analysis',
    up: `
      CREATE TABLE IF NOT EXISTS analysis_memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        analysis_id TEXT NOT NULL,
        finding TEXT NOT NULL,
        category TEXT,
        metadata JSONB DEFAULT '{}',
        embedding vector(384),
        persistent BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_memories_analysis_id
        ON analysis_memories(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_analysis_memories_category
        ON analysis_memories(category);
      CREATE INDEX IF NOT EXISTS idx_analysis_memories_expires_at
        ON analysis_memories(expires_at) WHERE persistent = FALSE;
      CREATE INDEX IF NOT EXISTS idx_analysis_memories_embedding
        ON analysis_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    `
  },
  {
    version: '004',
    name: 'create_ingested_records',
    feature: 'analysis',
    up: `
      CREATE TABLE IF NOT EXISTS ingested_records (
        id BIGSERIAL PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        model TEXT NOT NULL,
        record_id TEXT,
        data JSONB NOT NULL,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ingested_records_analysis_id
        ON ingested_records(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_ingested_records_expires_at
        ON ingested_records(expires_at) WHERE expires_at IS NOT NULL;
    `
  },
  {
    version: '005',
    name: 'add_ingested_records_unique_index',
    feature: 'analysis',
    up: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ingested_records_unique
        ON ingested_records(analysis_id, model, record_id)
        WHERE record_id IS NOT NULL;
    `
  },
  {
    version: '006',
    name: 'add_ingested_records_embedding',
    feature: 'analysis',
    up: `
      ALTER TABLE ingested_records
        ADD COLUMN IF NOT EXISTS embedding vector(384),
        ADD COLUMN IF NOT EXISTS embedding_text TEXT,
        ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_ingested_records_embedding
        ON ingested_records USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

      CREATE INDEX IF NOT EXISTS idx_ingested_records_model
        ON ingested_records(analysis_id, model);
    `
  },
  {
    version: '007',
    name: 'create_ingested_edges',
    feature: 'analysis',
    up: `
      CREATE TABLE IF NOT EXISTS ingested_edges (
        id BIGSERIAL PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        src_model TEXT NOT NULL,
        src_id TEXT NOT NULL,
        dst_model TEXT NOT NULL,
        dst_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        hop_depth INTEGER NOT NULL DEFAULT 0,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_ingested_edges_src
        ON ingested_edges(analysis_id, src_model, src_id);
      CREATE INDEX IF NOT EXISTS idx_ingested_edges_dst
        ON ingested_edges(analysis_id, dst_model, dst_id);
      CREATE INDEX IF NOT EXISTS idx_ingested_edges_expires
        ON ingested_edges(expires_at) WHERE expires_at IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ingested_edges_unique
        ON ingested_edges(analysis_id, src_model, src_id, dst_model, dst_id, edge_type);
    `
  }
] as const

// Migration drift detection.
//
// A generic, module-independent check that the database has every migration the
// server provisions for. It is intentionally NOT tied to any one feature (e.g.
// vector storage): future migrations may touch core/oauth tables, so the check
// reasons over the whole `migrations` list and the caller's declared features.
//
// The `schema_migrations(version, name, applied_at)` table is the convention
// every mcp-rune migration runner writes to (the `db:migrate` scripts shipped by
// consumers and the CLI scaffold). This is the canonical reader of that table.

/** A feature group a migration belongs to (mirrors `Migration.feature`). */
export type Feature = Migration['feature']

export interface MigrationStatusOptions {
  /**
   * Feature groups the caller provisions. When given, only migrations whose
   * `feature` is in this set are required — a server with `DATABASE_URL` but
   * analysis disabled is not flagged for unapplied `analysis` migrations.
   * Omit to require every migration.
   */
  features?: readonly Feature[]
}

/** Minimal slice of `pg.Pool` this module needs — just a `query` method. */
type Queryable = Pick<Pool, 'query'>

const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations'
const UNDEFINED_TABLE = '42P01'

/**
 * Read the set of applied migration versions from `schema_migrations`. A missing
 * table (error 42P01) means no migration has ever run, so nothing is applied.
 */
async function readAppliedVersions(pool: Queryable): Promise<Set<string>> {
  try {
    const { rows } = await pool.query<{ version: string }>(
      `SELECT version FROM ${SCHEMA_MIGRATIONS_TABLE}`
    )
    return new Set(rows.map((r) => r.version))
  } catch (err) {
    if ((err as { code?: string }).code === UNDEFINED_TABLE) return new Set()
    throw err
  }
}

/**
 * Return the migrations that have NOT been applied to the database, scoped to the
 * caller's declared `features` (or all migrations when none are given). The list
 * preserves migration order.
 *
 * @example
 * const pending = await getPendingMigrations(pool, { features: ['core', 'analysis'] })
 */
export async function getPendingMigrations(
  pool: Queryable,
  options: MigrationStatusOptions = {}
): Promise<Migration[]> {
  const applied = await readAppliedVersions(pool)
  const required = options.features
    ? migrations.filter((m) => options.features!.includes(m.feature))
    : migrations
  return required.filter((m) => !applied.has(m.version))
}

/** Thrown by {@link assertMigrationsCurrent} when the database is behind. */
export class PendingMigrationsError extends Error {
  /** The unapplied migrations, in order. */
  readonly pending: readonly Migration[]

  constructor(pending: readonly Migration[]) {
    const list = pending.map((m) => `${m.version}_${m.name}`).join(', ')
    super(`Database is behind on migrations (pending: ${list}). Run: npm run db:migrate`)
    this.name = 'PendingMigrationsError'
    this.pending = pending
  }
}

/**
 * Throw {@link PendingMigrationsError} if any required migration is unapplied.
 * Call once at startup, right after the pool is created, to fail fast with an
 * actionable message instead of surfacing a cryptic mid-request SQL error.
 *
 * @example
 * await assertMigrationsCurrent(pool, { features: ['core', 'analysis'] })
 */
export async function assertMigrationsCurrent(
  pool: Queryable,
  options: MigrationStatusOptions = {}
): Promise<void> {
  const pending = await getPendingMigrations(pool, options)
  if (pending.length > 0) throw new PendingMigrationsError(pending)
}
