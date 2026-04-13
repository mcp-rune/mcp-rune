# Analysis Memory & Vector Storage Architecture

A deep reference for the analysis memory tools, vector storage backends, and the map-reduce pattern that enables LLM-driven qualitative analysis over large datasets.

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. System Architecture](#2-system-architecture)
- [3. The Map-Reduce Pattern](#3-the-map-reduce-pattern)
- [4. Tool Layer](#4-tool-layer)
  - [4.1 store_analysis_memory](#41-store_analysis_memory)
  - [4.2 recall_analysis_memories](#42-recall_analysis_memories)
  - [4.3 clear_analysis_memories](#43-clear_analysis_memories)
- [5. Vector Storage Facade](#5-vector-storage-facade)
- [6. pgvector Backends](#6-pgvector-backends)
  - [6.1 Analysis Memories Backend](#61-analysis-memories-backend)
  - [6.2 Tool Memories Backend](#62-tool-memories-backend)
- [7. Embedding Service](#7-embedding-service)
- [8. Tool Categories & Registration](#8-tool-categories--registration)
- [9. Data Lifecycle](#9-data-lifecycle)
- [10. Database Schema](#10-database-schema)
- [11. Supporting Infrastructure](#11-supporting-infrastructure)
- [12. Complete Data Flow Examples](#12-complete-data-flow-examples)
- [13. File Reference](#13-file-reference)
- [14. Design Decisions](#14-design-decisions)

---

## 1. Overview

The analysis memory system solves a fundamental constraint: LLM context windows are finite, but datasets can span thousands of records across many pages. The system provides three MCP tools that implement a **map-reduce pattern**, allowing the LLM to:

1. **Map** — Process paginated search results page-by-page, storing atomic findings as vector embeddings
2. **Reduce** — Recall all findings at once, grouped by category and ranked by semantic similarity
3. **Cleanup** — Clear ephemeral findings after synthesis into a final report

This sits alongside the **tool memories** system, which passively records every CRUD operation for retrospective analysis (pattern detection, gap detection, clustering).

### Two Memory Systems

| System                | Purpose                                     | Trigger                        | Lifetime                     | Auth |
| --------------------- | ------------------------------------------- | ------------------------------ | ---------------------------- | ---- |
| **Analysis Memories** | Active: LLM stores findings during analysis | Explicit tool calls            | Ephemeral (1h) or persistent | No   |
| **Tool Memories**     | Passive: System records CRUD operations     | Automatic after tool execution | 30-day retention             | No   |

Both share the same infrastructure: pgvector for storage, `all-MiniLM-L6-v2` for embeddings, cosine distance for similarity.

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         MCP Tool Layer                               │
│                                                                      │
│  ┌──────────────────┐  ┌─────────────────────┐  ┌────────────────┐  │
│  │ store_analysis   │  │ recall_analysis     │  │ clear_analysis │  │
│  │ _memory          │  │ _memories           │  │ _memories      │  │
│  └────────┬─────────┘  └──────────┬──────────┘  └───────┬────────┘  │
│           │                       │                      │           │
│           │    BaseVectorTool (category: VECTOR)         │           │
│           │    No auth required, needs vector storage    │           │
└───────────┼───────────────────────┼──────────────────────┼───────────┘
            │                       │                      │
            ▼                       ▼                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Vector Storage Facade                              │
│                    lib/services/vector-storage.js                     │
│                                                                      │
│  storeAnalysisMemory()  recallAnalysisMemories()  clearAnalysis...() │
│  storeOperation()       findSimilarOperations()   detectGaps()       │
│                                                                      │
│  Vendor-agnostic API · No-ops when not configured                    │
└───────────┬───────────────────────┬──────────────────────┬───────────┘
            │                       │                      │
            ▼                       ▼                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    pgvector Backends                                  │
│                                                                      │
│  ┌─────────────────────────┐     ┌───────────────────────────────┐  │
│  │  analysis-memories.js   │     │     tool-memories.js          │  │
│  │                         │     │                               │  │
│  │  storeMemory()          │     │  storeOperation()             │  │
│  │  recallMemories()       │     │  findSimilar()                │  │
│  │  clearMemories()        │     │  detectGaps()                 │  │
│  │  cleanupExpired()       │     │  getClusters()                │  │
│  │                         │     │  getStats()                   │  │
│  │  On-access eviction     │     │  cleanupExpired()             │  │
│  └─────────────────────────┘     └───────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
            │                               │
            ▼                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         PostgreSQL + pgvector                        │
│                                                                      │
│  analysis_memories          tool_memories (aka operations)           │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐    │
│  │ id                  │    │ id                               │    │
│  │ analysis_id         │    │ tool_name                        │    │
│  │ finding             │    │ tool_args    (JSONB)             │    │
│  │ category            │    │ tool_output  (JSONB)             │    │
│  │ metadata    (JSONB) │    │ summary                          │    │
│  │ embedding   (384)   │    │ embedding    (384)               │    │
│  │ persistent          │    │ user_id, session_id              │    │
│  │ expires_at          │    │ created_at                       │    │
│  │ created_at          │    └──────────────────────────────────┘    │
│  └─────────────────────┘                                            │
│                                                                      │
│  IVFFlat index on embedding columns for ANN search                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Shared Infrastructure

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Shared Services                                  │
│                                                                      │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐ │
│  │  embeddings.js       │  │  cosine-similarity.js               │ │
│  │                      │  │                                      │ │
│  │  all-MiniLM-L6-v2   │  │  cosineSimilarity(a, b) → -1.0..1.0 │ │
│  │  384 dimensions      │  │  Accepts Float32Array, number[],     │ │
│  │  Local inference     │  │  or JSON strings                     │ │
│  │  Lazy-loaded         │  │                                      │ │
│  │  embed() / batch()   │  │  Used by getClusters() for           │ │
│  │                      │  │  in-memory greedy clustering          │ │
│  └──────────────────────┘  └──────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │  tool-output-adapters.js                                        ││
│  │                                                                  ││
│  │  Registry of adapter functions that normalize raw tool           ││
│  │  responses into compact JSONB before storage.                    ││
│  │  adaptToolOutput(toolName, rawOutput, toolArgs) → compact JSONB  ││
│  └──────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Map-Reduce Pattern

The core workflow that drives the analysis memory system:

```
Step 1: SEARCH                    Step 2: MAP (per page)
┌─────────────────────┐           ┌──────────────────────────────────┐
│ search_records      │           │ For each page of results:        │
│   model: "book"     │──page──▶  │   1. LLM reads records           │
│   filters: {        │  1..N     │   2. Identifies findings          │
│     status: "read"  │           │   3. store_analysis_memory()      │
│   }                 │           │      - analysis_id: "audit-2024"  │
│                     │           │      - finding: "..."             │
│ Returns paginated   │           │      - category: "data_quality"   │
│ results (50/page)   │           │                                  │
└─────────────────────┘           └──────────────────────────────────┘
                                                  │
                                        (repeat for all pages)
                                                  │
                                                  ▼
Step 3: REDUCE                    Step 4: CLEANUP
┌─────────────────────────────┐   ┌──────────────────────────────────┐
│ recall_analysis_memories()  │   │ clear_analysis_memories()        │
│   analysis_id: "audit-2024" │   │   analysis_id: "audit-2024"     │
│                             │   │                                  │
│ Returns all findings        │   │ Deletes all findings for         │
│ grouped by category:        │   │ this analysis session.           │
│                             │   │                                  │
│ ## data_quality (12)        │   │ Ephemeral findings also          │
│ - Missing ISBN for...       │   │ auto-expire after 1 hour.        │
│ - Duplicate entry...        │   │                                  │
│                             │   │                                  │
│ ## naming_inconsistency (5) │   │                                  │
│ - Title case mismatch...    │   │                                  │
│                             │   │                                  │
│ LLM synthesizes into report │   │                                  │
└─────────────────────────────┘   └──────────────────────────────────┘
```

### Why Map-Reduce?

| Approach                           | Problem                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Load all records into context      | Exceeds context window for large datasets                               |
| Summarize per page, concatenate    | Loses detail, no semantic grouping                                      |
| **Map-reduce with vector storage** | **Preserves all findings, enables semantic recall, groups by category** |

The key insight: findings are stored as embeddings, so `recall_analysis_memories` can retrieve semantically similar findings even if worded differently across pages.

---

## 4. Tool Layer

All three tools extend `BaseVectorTool`, which sets `category = TOOL_CATEGORIES.VECTOR`. This means:

- **No API authentication required** — findings are stored locally
- **Requires vector storage** — tools are hidden if pgvector is not configured
- **Generic** — reusable across any MCP server

### 4.1 store_analysis_memory

**Purpose:** Store a single finding during page-by-page analysis.

**File:** `lib/mcp/tools/vector/store-analysis-memory-tool.js`

| Parameter     | Type    | Required | Description                                                |
| ------------- | ------- | -------- | ---------------------------------------------------------- |
| `analysis_id` | string  | Yes      | Unique session identifier (e.g., `"title-audit-2024-03"`)  |
| `finding`     | string  | Yes      | The insight or observation                                 |
| `category`    | string  | No       | Grouping label (e.g., `"missing_metadata"`, `"duplicate"`) |
| `metadata`    | object  | No       | Structured data (record IDs, field values)                 |
| `persistent`  | boolean | No       | `false` (default): expires in 1 hour. `true`: permanent    |

**Execution flow:**

1. Receives finding text and metadata
2. Calls `storeAnalysisMemory()` on the vector storage facade
3. Facade generates embedding via `embed(finding)`
4. Calls `analysis-memories.storeMemory(pool, embedding, metadata)`
5. Returns confirmation with ID and durability status

**Example response:**

```
Stored analysis finding (ephemeral (expires in 1 hour)).
ID: a1b2c3d4-e5f6-7890
Analysis: title-audit-2024-03
Category: missing_metadata
```

### 4.2 recall_analysis_memories

**Purpose:** Retrieve stored findings for synthesis into a report.

**File:** `lib/mcp/tools/vector/recall-analysis-memories-tool.js`

| Parameter     | Type   | Required | Description                     |
| ------------- | ------ | -------- | ------------------------------- |
| `analysis_id` | string | No\*     | Analysis session to recall      |
| `query`       | string | No\*     | Semantic search across analyses |
| `category`    | string | No       | Filter by category              |
| `top_k`       | number | No       | Max results (default: 50)       |

\*At least one of `analysis_id` or `query` is required.

**Two retrieval modes:**

1. **ID-based** — Retrieves all findings for an analysis, ordered by creation time. Used for synthesizing a complete analysis.

2. **Semantic** — Embeds the query and finds similar findings via cosine distance. Returns similarity scores. Used for cross-analysis discovery.

**Output format:** Findings grouped by category with counts:

```
Found 17 finding(s):

## missing_metadata (12)
- Book "Clean Code" has no ISBN | {"record_id": "42"}
- Book "Design Patterns" missing publisher field | {"record_id": "87"}

## naming_inconsistency (5)
- Title uses inconsistent capitalization: "design Patterns" vs "Design Patterns"
```

### 4.3 clear_analysis_memories

**Purpose:** Delete all findings for an analysis session after synthesis.

**File:** `lib/mcp/tools/vector/clear-analysis-memories-tool.js`

| Parameter     | Type   | Required | Description               |
| ------------- | ------ | -------- | ------------------------- |
| `analysis_id` | string | Yes      | Analysis session to clear |

**Example response:**

```
Cleared 17 finding(s) for analysis "title-audit-2024-03".
```

---

## 5. Vector Storage Facade

**File:** `lib/services/vector-storage.js`

The facade provides a **vendor-agnostic API** that mirrors the pattern used by `tracing.js` and `error-tracking.js`. When vector storage is not configured (no env vars), all functions become silent no-ops.

```
┌───────────────────────────────────────┐
│          vector-storage.js            │
│          (Public API)                 │
├───────────────────────────────────────┤
│                                       │
│  Analysis Memory Functions:           │
│  • storeAnalysisMemory(opts)          │
│  • recallAnalysisMemories(filters)    │
│  • clearAnalysisMemories(analysisId)  │
│                                       │
│  Tool Memory Functions:               │
│  • storeOperation(operation)          │
│  • findSimilarOperations(query, ...)  │
│  • detectOperationGaps(steps, ...)    │
│  • getOperationClusters(filters, ...) │
│  • getOperationStats(filters)         │
│                                       │
│  Lifecycle:                           │
│  • initVectorStorage(options)         │
│  • isVectorStorageEnabled()           │
│  • flushVectorStorage(timeout)        │
│  • closeVectorStorage(timeout)        │
│                                       │
└──────────────────┬────────────────────┘
                   │
                   │ imports
                   ▼
┌───────────────────────────────────────┐
│  vendor/pgvector/                     │
│  • index.js       (pool management)  │
│  • operations.js  (tool memories)    │
│  • analysis-memories.js              │
│  • tool-memories.js                  │
└───────────────────────────────────────┘
```

### Key Design: No-Op When Unconfigured

```javascript
export async function storeAnalysisMemory(opts) {
  if (!vendor.isConfigured()) return null // Silent no-op
  const pool = vendor.getPool()
  if (!pool) return null
  // ... actual storage logic
}
```

This means MCP servers work identically with or without vector storage — tools simply don't appear in the tool list when disabled.

---

## 6. pgvector Backends

### 6.1 Analysis Memories Backend

**File:** `lib/services/vendor/pgvector/analysis-memories.js`

Four functions implementing the analysis memory contract:

#### `storeMemory(pool, embedding, metadata)`

Inserts a finding with its embedding vector:

```sql
INSERT INTO analysis_memories
  (analysis_id, finding, category, metadata, embedding, persistent, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id
```

- `persistent: false` → `expires_at = NOW() + 1 hour`
- `persistent: true` → `expires_at = NULL` (never expires)

#### `recallMemories(pool, filters, options)`

Two query modes depending on whether `filters.embedding` is provided:

**Semantic mode** (embedding provided):

```sql
SELECT id, analysis_id, finding, category, metadata,
       persistent, created_at,
       1 - (embedding <=> $vectorParam) AS similarity
FROM analysis_memories
WHERE (persistent = TRUE OR expires_at > NOW())
  AND analysis_id = $1
ORDER BY embedding <=> $vectorParam
LIMIT $limitParam
```

Results filtered by `threshold` (default: 0.5) after retrieval.

**ID-based mode** (no embedding):

```sql
SELECT id, analysis_id, finding, category, metadata,
       persistent, created_at
FROM analysis_memories
WHERE (persistent = TRUE OR expires_at > NOW())
  AND analysis_id = $1
ORDER BY created_at ASC
LIMIT $limitParam
```

**On-access eviction:** Every `recallMemories()` call first runs `cleanupExpired()` to delete stale rows. This avoids background job complexity.

#### `clearMemories(pool, analysisId)`

Deletes all findings for an analysis session:

```sql
DELETE FROM analysis_memories WHERE analysis_id = $1
```

#### `cleanupExpired(pool)`

On-access eviction of non-persistent expired rows:

```sql
DELETE FROM analysis_memories
WHERE persistent = FALSE AND expires_at < NOW()
```

### 6.2 Tool Memories Backend

**File:** `lib/services/vendor/pgvector/tool-memories.js`

Six functions implementing the tool operations memory:

#### `storeOperation(pool, embedding, metadata)`

Records a tool execution with its embedding:

```sql
INSERT INTO tool_memories
  (embedding, tool_name, tool_args, user_id, session_id, summary, tool_output)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id
```

The `summary` field contains a natural language description generated by `operationToText()` in the facade. The `tool_output` is compact JSONB produced by the adapter registry.

#### `findSimilar(pool, embedding, filters, options)`

Semantic search using pgvector's cosine distance operator (`<=>`):

```sql
SELECT id, tool_name, tool_args, tool_output, session_id,
       summary, created_at,
       1 - (embedding <=> $1) AS similarity
FROM tool_memories
WHERE tool_name = $2 AND created_at > NOW() - INTERVAL '7 days'
ORDER BY embedding <=> $1
LIMIT $3
```

Supports filtering by `toolName`, `days`, `sessionId`. Results filtered by `threshold` (default: 0.5).

#### `detectGaps(pool, templateEmbeddings, filters, options)`

Workflow completeness validation. Given expected steps as embeddings, checks which ones lack matching tool operations:

```
Expected Steps (template)          Actual Operations (stored)
┌─────────────────────────┐        ┌──────────────────────┐
│ "Create deal record"    │───?───▶│ create_model deal ... │ ✓ (0.92)
│ "Add format to deal"    │───?───▶│ (nothing similar)     │ ✗ missing
│ "Set deal status draft" │───?───▶│ update_model deal ... │ ~ (0.45)
└─────────────────────────┘        └──────────────────────┘
```

For each template step, queries for the best match:

```sql
SELECT MAX(1 - (embedding <=> $1)) AS max_similarity
FROM tool_memories
WHERE TRUE AND tool_args->>'model' = $2
```

Returns gaps with confidence:

- `max_similarity < 0.3` → status: `"missing"`
- `max_similarity < 0.7` → status: `"incomplete"`
- `max_similarity >= 0.7` → not a gap (step completed)

#### `getClusters(pool, filters, options)`

Greedy clustering algorithm that groups similar operations:

```
Algorithm:
1. Load up to 500 recent operations with embeddings
2. For each unassigned operation:
   a. Start a new cluster with this operation as representative
   b. For each remaining unassigned operation:
      - Compute cosineSimilarity(representative, candidate)
      - If similarity >= threshold (0.75), add to cluster
3. Separate clusters (size >= minClusterSize) from outliers
```

Uses `cosineSimilarity()` from `lib/services/cosine-similarity.js` for in-memory comparison (no database round-trip per pair).

Returns:

```javascript
{
  clusters: [
    {
      representative: "create_model book 'Clean Code'. Fields: ...",
      toolName: "create_model",
      count: 8,
      operations: [...]
    }
  ],
  outliers: [...]
}
```

#### `getStats(pool, filters)`

Aggregated statistics using PostgreSQL `GROUPING SETS`:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(DISTINCT tool_name) AS tools,
  COUNT(DISTINCT tool_args->>'model') AS models,
  COUNT(DISTINCT tool_args->>'id') AS records,
  COUNT(DISTINCT session_id) AS sessions,
  tool_name
FROM tool_memories
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY GROUPING SETS ((), (tool_name))
```

Returns both the aggregate row (total counts) and per-tool breakdowns in a single query.

#### `cleanupExpired(pool, retentionDays)`

Time-based retention cleanup:

```sql
DELETE FROM tool_memories
WHERE created_at < NOW() - INTERVAL '30 days'
```

---

## 7. Embedding Service

**File:** `lib/services/embeddings.js`

Generates text embeddings using a local model — no API keys, no network calls after initial download.

| Property     | Value                                                        |
| ------------ | ------------------------------------------------------------ |
| Model        | `sentence-transformers/all-MiniLM-L6-v2`                     |
| Dimensions   | 384                                                          |
| Runtime      | `@huggingface/transformers` (local inference)                |
| Loading      | Lazy — downloaded on first `embed()` call, cached thereafter |
| Quantization | Enabled (`quantized: true`)                                  |

### API

```javascript
import { embed, embedBatch, getEmbeddingDimensions } from '#lib/services/embeddings.js'

// Single text
const vector = await embed('Created deal BBC Drama Package')
// → Float32Array(384)

// Batch (sequential, not parallel)
const vectors = await embedBatch(['step one', 'step two', 'step three'])
// → Float32Array(384)[]

// Dimensions constant
getEmbeddingDimensions() // → 384
```

### Pre-warming

Optional startup pre-warm to avoid cold-start latency:

```javascript
import { initEmbeddings } from '#lib/services/embeddings.js'
await initEmbeddings() // Downloads model if needed
```

---

## 8. Tool Categories & Registration

### VECTOR Category

**File:** `lib/mcp/tools/categories.js`

```javascript
VECTOR: {
  requiresAuth: false,
  requiresPromptRegistry: false,
  requiresVectorStorage: true,
  isGeneric: true,
  description: 'Vector retrospective tools, requires vector storage configuration'
}
```

### Inheritance Chain

```
BaseTool (lib/mcp/tools/base-tool.js)
  └── BaseVectorTool (lib/mcp/tools/vector/base-vector-tool.js)
        ├── StoreAnalysisMemoryTool
        ├── RecallAnalysisMemoriesTool
        ├── ClearAnalysisMemoriesTool
        ├── FindSimilarOperationsTool
        ├── DetectOperationGapsTool
        └── ClusterOperationsTool
```

### Registry Integration

**File:** `src/engineer/tools/registry.js`

Vector tools are registered in `TOOL_CLASSES` and conditionally enabled:

```javascript
// In _getEnabledTools():
if (!isVectorStorageEnabled()) {
  const vectorToolNames = this._getToolNamesByCategory(TOOL_CATEGORIES.VECTOR)
  tools = tools.filter((name) => !vectorToolNames.has(name))
}
```

When vector storage is configured, all six vector tools appear. When not configured, they're silently excluded — no errors, no warnings.

---

## 9. Data Lifecycle

### Analysis Memories Lifecycle

```
┌─────────┐    store     ┌───────────┐    1 hour    ┌─────────┐
│ Created  │────────────▶│ Ephemeral │─────────────▶│ Expired │
│         │             │ (default)  │              │         │
└─────────┘             └───────────┘              └────┬────┘
                                                        │
                              on-access eviction         │
                              (next recallMemories)     │
                                                        ▼
                                                   ┌─────────┐
                                                   │ Deleted  │
                                                   └─────────┘

┌─────────┐    store     ┌────────────┐   explicit   ┌─────────┐
│ Created  │────────────▶│ Persistent │────clear────▶│ Deleted  │
│         │  persistent  │ (no expiry)│              │         │
└─────────┘    = true    └────────────┘              └─────────┘
```

### Tool Memories Lifecycle

```
┌────────────┐  fire-and-forget  ┌──────────┐   30 days   ┌─────────┐
│ Tool called │────────────────▶│  Stored  │────────────▶│ Deleted  │
│            │                  │          │  retention   │         │
└────────────┘                  └──────────┘              └─────────┘
```

### Eviction Strategies

| System            | Strategy             | Trigger                         |
| ----------------- | -------------------- | ------------------------------- |
| Analysis memories | On-access eviction   | Every `recallMemories()` call   |
| Analysis memories | Explicit cleanup     | `clearMemories(analysisId)`     |
| Tool memories     | Time-based retention | `cleanupExpired(retentionDays)` |

No background jobs or cron processes — cleanup happens inline during normal operations.

---

## 10. Database Schema

### analysis_memories

```sql
CREATE TABLE analysis_memories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id   TEXT NOT NULL,
  finding       TEXT NOT NULL,
  category      TEXT,
  metadata      JSONB DEFAULT '{}',
  embedding     vector(384) NOT NULL,
  persistent    BOOLEAN DEFAULT FALSE,
  expires_at    TIMESTAMPTZ,             -- NULL for persistent
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analysis_memories_analysis_id ON analysis_memories(analysis_id);
CREATE INDEX idx_analysis_memories_embedding ON analysis_memories
  USING ivfflat (embedding vector_cosine_ops);
```

### tool_memories (operations)

```sql
CREATE TABLE tool_memories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  embedding     vector(384) NOT NULL,
  tool_name     TEXT NOT NULL,
  tool_args     JSONB,
  tool_output   JSONB,
  user_id       TEXT,
  session_id    TEXT,
  summary       TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tool_memories_embedding ON tool_memories
  USING ivfflat (embedding vector_cosine_ops);
```

### Index Choice: IVFFlat

pgvector's IVFFlat (Inverted File with Flat quantization) provides approximate nearest neighbor search. Trade-offs:

- **Fast** for datasets up to ~1M vectors
- Requires periodic `REINDEX` as data grows
- Sufficient for the expected scale (thousands of operations, not millions)

---

## 11. Supporting Infrastructure

### Tool Output Adapters

**File:** `lib/services/tool-output-adapters.js`

Before storing a tool operation, the raw API response is normalized into compact JSONB:

```javascript
import {
  adaptToolOutput,
  registerOutputAdapter,
  pickFields
} from '#lib/services/tool-output-adapters.js'

// Register an adapter that extracts key fields
registerOutputAdapter('create_model', pickFields(['id', 'name', 'status']))

// At storage time:
const compact = adaptToolOutput('create_model', rawApiResponse, toolArgs)
// { id: '123', name: 'Clean Code', status: 'unread' }
```

Prevents bloated JSONB from large API responses polluting the vector database.

### Cosine Similarity

**File:** `lib/services/cosine-similarity.js`

Pure math utility for in-memory vector comparison:

```javascript
import { cosineSimilarity } from '#lib/services/cosine-similarity.js'

const similarity = cosineSimilarity(embeddingA, embeddingB)
// 1.0 = identical direction
// 0.0 = orthogonal
// -1.0 = opposite
```

Accepts `Float32Array`, `number[]`, or JSON strings `"[0.1, 0.2, ...]"`. Used by `getClusters()` to avoid N database round-trips for pairwise comparison.

### Operation-to-Text Conversion

**In:** `lib/services/vector-storage.js` (private function `operationToText`)

Converts tool operations to natural language for embedding:

```
create_model book 'Clean Code'. Fields: title: Clean Code, author: Robert Martin, status: unread -> id: 42
update_model book '42'. Changed: status, rating
delete_model book '42'
```

This natural language representation is what gets embedded — enabling semantic search like _"books that were created and then updated"_ to find matching operations.

---

## 12. Complete Data Flow Examples

### Example 1: Analyzing 500 Books for Data Quality

```
LLM Conversation Flow:

1. LLM calls search_records(model: "book", filters: { status: "read" })
   → Returns page 1 of 10 (50 records)

2. LLM reads page 1, finds issues:
   → store_analysis_memory(
       analysis_id: "book-quality-2024-03",
       finding: "Book 'Clean Code' has no ISBN field populated",
       category: "missing_metadata",
       metadata: { record_id: "42", field: "isbn" }
     )
   → store_analysis_memory(
       analysis_id: "book-quality-2024-03",
       finding: "Duplicate entries: 'design patterns' and 'Design Patterns'",
       category: "duplicate"
     )

3. LLM calls search_records_view to paginate → page 2
   (Repeats step 2 for each page)

4. After all 10 pages processed:
   → recall_analysis_memories(analysis_id: "book-quality-2024-03")

   Returns:
   ## missing_metadata (23)
   - Book 'Clean Code' has no ISBN field populated | {"record_id": "42"}
   - Book 'Refactoring' missing publisher field | {"record_id": "87"}
   ...

   ## duplicate (8)
   - Duplicate entries: 'design patterns' and 'Design Patterns'
   ...

   ## naming_inconsistency (4)
   - Inconsistent title casing across series entries
   ...

5. LLM synthesizes findings into structured report

6. LLM calls clear_analysis_memories(analysis_id: "book-quality-2024-03")
   → "Cleared 35 finding(s)"
```

### Example 2: Semantic Cross-Analysis Discovery

```
LLM: "Have any previous analyses found issues with ISBN data?"

→ recall_analysis_memories(
    query: "ISBN missing or invalid",
    top_k: 10
  )

Returns findings from ANY analysis session that are semantically
similar to "ISBN missing or invalid":

## missing_metadata (3)
- Book 'Clean Code' has no ISBN field [92.3% match]
- ISBN-13 format incorrect for 'Design Patterns' [87.1% match]

## data_quality (1)
- Several records have ISBN-10 when ISBN-13 expected [78.5% match]
```

### Example 3: Passive Tool Operation Recording

```
When the LLM creates a book:

1. LLM calls create_model(model: "book", attributes: { title: "New Book", ... })

2. Tool registry executes the tool, gets API response

3. Fire-and-forget: storeOperation() runs asynchronously:
   a. adaptToolOutput('create_model', response, args)
      → { id: '99', name: 'New Book', status: 'unread' }
   b. operationToText(operation, adaptedOutput)
      → "create_model book 'New Book'. Fields: title: New Book, status: unread -> id: 99"
   c. embed(summaryText)
      → Float32Array(384)
   d. tool-memories.storeOperation(pool, embedding, metadata)
      → INSERT INTO tool_memories ...

4. Later, the LLM can ask:
   → find_similar_operations("books created this week")
   → detect_operation_gaps(["create book", "add format", "set status"])
   → cluster_operations(days: 7)
```

---

## 13. File Reference

| File                                                    | Layer    | Purpose                          |
| ------------------------------------------------------- | -------- | -------------------------------- |
| `lib/mcp/tools/vector/base-vector-tool.js`              | Tool     | Base class, sets VECTOR category |
| `lib/mcp/tools/vector/store-analysis-memory-tool.js`    | Tool     | Store findings                   |
| `lib/mcp/tools/vector/recall-analysis-memories-tool.js` | Tool     | Recall findings                  |
| `lib/mcp/tools/vector/clear-analysis-memories-tool.js`  | Tool     | Clear findings                   |
| `lib/services/vector-storage.js`                        | Facade   | Vendor-agnostic API              |
| `lib/services/vendor/pgvector/analysis-memories.js`     | Backend  | Analysis memory SQL              |
| `lib/services/vendor/pgvector/tool-memories.js`         | Backend  | Tool memory SQL                  |
| `lib/services/embeddings.js`                            | Service  | Local embedding model            |
| `lib/services/cosine-similarity.js`                     | Utility  | In-memory vector math            |
| `lib/services/tool-output-adapters.js`                  | Service  | Response normalization           |
| `lib/mcp/tools/categories.js`                           | Config   | VECTOR category definition       |
| `src/engineer/tools/registry.js`                        | Registry | Conditional tool registration    |

### Test Files

| File                                                               | Coverage         |
| ------------------------------------------------------------------ | ---------------- |
| `__tests__/lib/mcp/tools/vector/analysis-memory-tools.spec.js`     | All 3 tools      |
| `__tests__/lib/services/vendor/pgvector/analysis-memories.spec.js` | pgvector backend |
| `__tests__/lib/services/vendor/pgvector/tool-memories.spec.js`     | Tool memories    |

---

## 14. Design Decisions

### Why pgvector over dedicated vector databases?

PostgreSQL + pgvector keeps the stack simple. The MCP server already uses PostgreSQL for OAuth sessions. Adding a separate vector database (Pinecone, Weaviate, Milvus) would mean:

- Another service to deploy and monitor
- Another connection pool to manage
- Another failure mode in production

pgvector is sufficient for the expected scale and avoids operational complexity.

### Why local embeddings over API-based?

`all-MiniLM-L6-v2` runs locally via `@huggingface/transformers`:

- **No API keys** — zero configuration for embeddings
- **No network latency** — embeddings generated in-process
- **No cost** — unlimited embeddings, no per-token billing
- **Privacy** — findings never leave the server

Trade-off: 384 dimensions is smaller than OpenAI's 1536 or 3072, but sufficient for the semantic granularity needed here.

### Why on-access eviction over background jobs?

Analysis memories use on-access eviction (cleanup runs on every `recallMemories()` call) instead of a background cron job:

- **No scheduler dependency** — no cron, no queue, no worker process
- **Self-cleaning** — unused memories naturally accumulate but never interfere
- **Simple** — eviction is a single DELETE query, fast even on large tables
- **Sufficient** — ephemeral memories only matter during active analysis sessions

### Why fire-and-forget for tool operations?

Tool memory storage (`storeOperation`) runs asynchronously without awaiting:

- Tool execution speed is unaffected by vector storage
- If embedding or storage fails, the tool call still succeeds
- Operations are best-effort — missing a few is acceptable

### Why two separate backends?

Analysis memories and tool memories have different lifecycles:

- **Analysis memories**: Short-lived, explicit lifecycle (store → recall → clear), session-scoped
- **Tool memories**: Long-lived, automatic lifecycle (store → age out), spans all sessions

Separate tables with separate schemas allow optimized queries for each use case. The analysis memories table has `expires_at` and `persistent` columns that tool memories don't need. Tool memories have `tool_name`, `tool_args`, `tool_output` columns that analysis memories don't need.
