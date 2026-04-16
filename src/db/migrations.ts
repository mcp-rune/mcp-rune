/**
 * Schema migrations shared across all MCP servers.
 *
 * Each migration has a version string, a human-readable name,
 * and an `up` SQL statement. Migrations are applied in order;
 * the runner tracks applied versions in a `schema_migrations` table.
 */

export interface Migration {
  version: string
  name: string
  up: string
}

export const migrations: Migration[] = [
  {
    version: '001',
    name: 'create_oauth_sessions',
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
    up: `
      CREATE TABLE IF NOT EXISTS analysis_memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        analysis_id VARCHAR(255) NOT NULL,
        finding TEXT NOT NULL,
        category VARCHAR(100),
        metadata JSONB DEFAULT '{}',
        embedding vector(384),
        persistent BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_memories_analysis_id
        ON analysis_memories (analysis_id);
      CREATE INDEX IF NOT EXISTS idx_analysis_memories_expires_at
        ON analysis_memories (expires_at);
      CREATE INDEX IF NOT EXISTS idx_analysis_memories_embedding
        ON analysis_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    `
  },
  {
    version: '004',
    name: 'create_ingested_records',
    up: `
      CREATE TABLE IF NOT EXISTS ingested_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        analysis_id VARCHAR(255) NOT NULL,
        model VARCHAR(255) NOT NULL,
        record_id TEXT,
        data JSONB NOT NULL DEFAULT '{}',
        expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ingested_records_analysis_id
        ON ingested_records (analysis_id);
      CREATE INDEX IF NOT EXISTS idx_ingested_records_expires_at
        ON ingested_records (expires_at);
    `
  }
]
