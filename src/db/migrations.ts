/**
 * Database Migrations
 *
 * Exported SQL definitions for all tables required by mcp-kit features.
 * Consumers import these and feed them to their own migration runner.
 *
 * @example
 * import { migrations } from 'mcp-kit/db/migrations'
 *
 * for (const migration of migrations) {
 *   await client.query(migration.up)
 * }
 */

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
 * All mcp-kit database migrations, ordered by version.
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
  }
] as const
