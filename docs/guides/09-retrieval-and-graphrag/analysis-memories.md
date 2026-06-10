# Analysis Memories

A six-tool feature for running LLM-driven qualitative analysis over large, paginated datasets without dragging raw rows into the model's context window — and for acting on a subset of that dataset without ever putting the IDs back in context.

The LLM downloads records once into offline storage, stores its own qualitative findings as semantic embeddings, then queries both layers — by meaning, by aggregate, by filter, by stratified sample — until it has enough material to synthesise a final answer.

> Want a hands-on tour? The [Analysis Quickstart](./analysis-quickstart.md) walks each summary strategy through Inspector against a 5,000-book in-memory dataset.

## Table of Contents

- [Data flow](#data-flow)
- [When to use it](#when-to-use-it)
- [Setup (integrators)](#setup-integrators)
- [The six tools](#the-six-tools)
  - [`analysis_ingest`](#analysis_ingest)
  - [`analysis_store`](#analysis_store)
  - [`analysis_query`](#analysis_query)
  - [`analysis_act`](#analysis_act)
  - [`analysis_clear`](#analysis_clear)
- [Stratified sampling](#stratified-sampling)
- [End-to-end workflow](#end-to-end-workflow)
- [Lifecycle & retention](#lifecycle--retention)
- [Troubleshooting](#troubleshooting)
- [File reference](#file-reference)

---

## Data flow

Two tables back the feature. Only one of them stores vectors — the other is plain JSONB. The six tools are stitched together by **the LLM**, which drives the loop: ingest once, then read → reason → store (and optionally `analysis_summarize` to re-summarize without re-fetching), optionally act, then clear when done.

<!-- illustration: analysis-memories#life -->

```
═══════════════════════════════════════════════════════════════════════════════
  SESSION LIFECYCLE  ·  the LLM is the loop driver
═══════════════════════════════════════════════════════════════════════════════

  ① BOOTSTRAP — runs once at the start of an analysis_id
  ──────────────────────────────────────────────────────
  analysis_ingest(model, filters)
       │  GET /api/<model>?page=N  (auto-paginates up to 50)
       │
       ├─────────────────────────────────────► ingested_records
       │                                       (raw rows, JSONB,
       │                                        no embedding, 1h TTL)
       │
       │  per-page summary text
       │  (distributions, numeric stats, date ranges)
       │           │
       │      ═════╪═════ EMBED ═════════════════════════════════
       │           │   MiniLM-L6-v2 (local, 384-dim)
       │           ▼
       └─────► analysis_memories
               (category: "page_summary:<strategy>",
                text + vector + metadata, 1h TTL)


  ② READ — LLM queries to understand the data
  ───────────────────────────────────────────
  analysis_query(analysis_id, mode, …)
       │
       ├── describe / aggregate / filter / sample
       │       │
       │       │  SQL: GROUP BY, JSONB @>, range casts,
       │       │  ROW_NUMBER() partitioned by stratify_by
       │       │  and/or date_bin() proximity buckets
       │       ▼
       │   ingested_records
       │
       └── semantic
               │  ═════ EMBED(query) ═════  →  cosine distance
               ▼
           analysis_memories
           (page summaries + any findings stored so far)


  ③ WRITE — LLM commits insights it formed in step ②
  ──────────────────────────────────────────────────
  analysis_store(findings[])
       │           no API call — purely LLM → storage
       │
       │  finding text
       │      │
       │ ═════╪═════ EMBED ═════════════════════════════════════
       │      │   MiniLM-L6-v2 (local, 384-dim)
       │      ▼
       └─► analysis_memories
           (category set by LLM, e.g. "quality_issue", "pattern";
            1h TTL by default, or persistent: true)


  ╭─────────────────────────────────────────────────────────────────────╮
  │ Steps ② and ③ repeat as a loop. Each analysis_store call enlarges   │
  │ the pool that the next semantic query in step ② can recall.         │
  │                                                                     │
  │ The very first analysis_store has nothing to build on except the    │
  │ page_summary findings written by step ① — that's by design. Page    │
  │ summaries are the LLM's "starter pack": coarse-grained, automatic,  │
  │ and immediately searchable before the LLM has written anything.     │
  ╰─────────────────────────────────────────────────────────────────────╯


  ③.5 ACT — optional: mutate a subset before teardown
  ────────────────────────────────────────────────────
  analysis_act(analysis_id, model, where?, action, attributes?, dry_run?)
       │
       │  SELECT record_id FROM ingested_records
       │  WHERE analysis_id = ? AND model = ? AND <where predicate>
       │           │
       │           ▼
       │      resolved IDs (server-side only — never returned to context)
       │           │
       │      batches of 50, concurrency 5
       │           │
       │           ▼
       │  PATCH/DELETE /api/<endpoint>/<id>   ── upstream API
       │
       └─► response = { summary: { total, succeeded, failed }, sample_errors }
                                (per-record results stay in the server log)


  ④ TEARDOWN — once the LLM has its final synthesis
  ─────────────────────────────────────────────────
  analysis_clear(analysis_id)
       ├── DELETE FROM ingested_records  WHERE analysis_id = ?
       └── DELETE FROM analysis_memories WHERE analysis_id = ?
```

**Where the embed boundary actually sits.** Embedding happens at exactly three points, all crossing the `═══ EMBED ═══` line: ① the page-summary side-effect of `analysis_ingest`, ③ every `analysis_store` finding, and ② the _query string_ in `semantic` mode (not the data being searched — that was already embedded on write). Raw API rows never touch the embedder.

This is why aggregate/filter/sample queries are cheap and deterministic SQL, while semantic queries pay for a single query-side embed and rank rows by cosine distance.

> **Maintenance note:** keep this diagram in sync with the code. If a future change adds a new write path (e.g. embedding raw rows, a third table, a new tool, or removing the page-summary side-effect), update the diagram in the same PR — the value of a high-level picture collapses the moment it stops matching the code. The authoritative sources are `analysis-ingest-tool.ts`, `analysis-store-tool.ts`, `analysis-query-tool.ts`, `analysis-act-tool.ts`, `analysis-clear-tool.ts`, and the two pgvector backend files listed under [File reference](#file-reference).

---

## When to use it

**Use it for:**

- Qualitative analysis over result sets that span many pages (themes, anomalies, "what patterns do you see?").
- Distribution / aggregation questions across an entire collection.
- Representative sampling from skewed datasets where a naive `ORDER BY RANDOM()` would favour the majority class.

**Don't use it for:**

- Single-record lookups or known-id reads — use `find_records`.
- Result sets that fit in one page and that you actually want returned to context — use `search_records` or `find_model_app`.
- Transactional CRUD — use `create_model` / `update_model` / `delete_model`.

The dividing line: if you need the raw data **in context**, use the data tools. If you need to _reason_ about a dataset that's too big for context, use the analysis tools.

---

## Setup (integrators)

### Prerequisites

- PostgreSQL with the [`pgvector`](https://github.com/pgvector/pgvector) extension installed.
- `pg` connection pool you own and inject into mcp-rune.

### 1. Environment variables

| Variable           | Required | Notes                                                                                                                                                 |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | yes      | Standard `postgres://...` connection string.                                                                                                          |
| `ANALYSIS_ENABLED` | yes      | Set to `true` to register the four analysis tools. When `false`/unset, they're gated out by `requiresVectorStorage` and won't appear in `tools/list`. |

### 2. Run migrations

mcp-rune ships migrations as data under the `@mcp-rune/mcp-rune/db/migrations` subpath import. The analysis tables (`analysis_memories`, `ingested_records`) are tagged `feature: 'analysis'` — apply them conditionally:

```ts file=src/needed.ts
import { migrations } from '@mcp-rune/mcp-rune/db/migrations'

const needed = migrations.filter(
  (m) => m.feature === 'core' || process.env.ANALYSIS_ENABLED === 'true'
)
// ...apply each migration.up against your pool
```

```js file=src/needed.js
import { migrations } from '@mcp-rune/mcp-rune/db/migrations'
const needed = migrations.filter(
  (m) => m.feature === 'core' || process.env.ANALYSIS_ENABLED === 'true'
)
// ...apply each migration.up against your pool
```

See the **Database** section of the root README for the full migration runner snippet.

### 3. Initialise vector storage at startup

```ts file=src/pool.ts
import pg from 'pg'
import { vectorStorage } from '@mcp-rune/mcp-rune/runtime'
import { createPgvectorAdapter } from '@mcp-rune/mcp-rune/runtime/vendor/pgvector'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

vectorStorage.initVectorStorage({
  adapter: createPgvectorAdapter({
    pool, // required — pool lifecycle stays with you; mcp-rune never creates pools
    toolMemoriesRetentionDays: 30, // default: 30 — sweep window for tool_memories
    ingestedRecordsRetentionDays: 7 // default: 7 — TTL for ingested_records
  }),
  serviceName: 'my-mcp-server',
  version: '1.0.0',
  backgroundCleanupIntervalMs: 6 * 60 * 60 * 1000 // optional — periodic cleanup; omit to disable
})
```

```js file=src/pool.js
import pg from 'pg'
import { vectorStorage } from '@mcp-rune/mcp-rune/runtime'
import { createPgvectorAdapter } from '@mcp-rune/mcp-rune/runtime/vendor/pgvector'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
vectorStorage.initVectorStorage({
  adapter: createPgvectorAdapter({
    pool, // required — pool lifecycle stays with you; mcp-rune never creates pools
    toolMemoriesRetentionDays: 30, // default: 30 — sweep window for tool_memories
    ingestedRecordsRetentionDays: 7 // default: 7 — TTL for ingested_records
  }),
  serviceName: 'my-mcp-server',
  version: '1.0.0',
  backgroundCleanupIntervalMs: 6 * 60 * 60 * 1000 // optional — periodic cleanup; omit to disable
})
```

If `options.adapter` is omitted, vector storage stays disabled and the six analysis tools simply won't show up in the tool list. There's no error path — the gate is silent by design.

`backgroundCleanupIntervalMs` is opt-in because short-lived processes (test runs, single-shot scripts) don't need it; the boot-time sweep already evicts expired rows on startup. Set it for long-running servers where on-access eviction alone may leave orphaned rows behind.

### 4. Embeddings

Embeddings run **locally** via `@huggingface/transformers` using `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions, quantised, lazy-loaded on first use). No API keys, no outbound network calls. The first `analysis_store` or semantic `analysis_query` in a fresh process pays a one-time model warm-up cost.

---

## The six tools

All six belong to the `ANALYSIS` tool category, gated by `requiresVectorStorage`. `analysis_ingest` and `analysis_act` call the upstream API; the others operate purely on the local pgvector tables.

### `analysis_ingest`

Downloads records from the model's API and stores them in `ingested_records` as JSONB. Only a status summary returns to context — the raw data never inflates the LLM window.

**Two ingestion modes:**

| Mode      | Triggered by                      | Use for                                                                                                                |
| --------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Top-level | `model`                           | Listing/searching records of a single model.                                                                           |
| Nested    | `parent_model` + `child_resource` | Fetching child resources (e.g. `metadata_errors`) for every previously-ingested parent, with auto-resolved parent IDs. |

**Key inputs:**

| Field                                            | Notes                                                                                                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                                          | Required for top-level mode.                                                                                                                                                                       |
| `analysis_id`                                    | Required. Session key — every later tool uses this to scope its work.                                                                                                                              |
| `filters`                                        | Optional. Routed through `validateFilterParams`; supports the same operators as `search_records`.                                                                                                  |
| `page` / `per_page`                              | `per_page` defaults to 50.                                                                                                                                                                         |
| `fields`                                         | Optional projection (`["id", "name", "status"]`). `{assoc}_id` keys are auto-preserved when you ask for any flattened field from the association (e.g. `title_name` → `title_id` is kept).         |
| `ingest_all`                                     | When `true`, auto-paginates up to **50 pages**, reporting progress page-by-page.                                                                                                                   |
| `resume`                                         | With `ingest_all`, skips already-stored pages by counting existing rows and continuing from the next page.                                                                                         |
| `parent_model` / `child_resource` / `parent_ids` | Nested mode. `parent_ids` is capped at 25; if omitted, auto-resolved from previously ingested records of `parent_model` in the same `analysis_id`. Nested fetches run with a concurrency cap of 5. |
| `user_id`                                        | Service-account impersonation.                                                                                                                                                                     |

**Side effects beyond storing records:** every successful page also produces a **page summary finding** generated by one or more **summary strategies** (default: `distribution` — field distributions for low-cardinality fields, numeric min/max/avg/median, and date ranges). Each strategy writes one row with category `page_summary:<strategy>` (e.g. `page_summary:distribution`) and `metadata.strategy: <strategy-name>`, immediately searchable via `analysis_query mode: "semantic"`.

Pick a different lens with `summary_strategy: "coverage" | "anomaly" | "temporal" | "entity-extraction"`, or run several per page with `summary_strategies: ["distribution", "anomaly"]`. Hosts can ship custom strategies via `ApiExtension`. See [Summary Strategies](./summary-strategies.md) for the full catalog and authoring guide. If you want a different lens on data you've already ingested, call [`analysis_summarize`](#analysis_summarize) instead of re-ingesting.

**Dedupe:** `ingested_records` has a partial unique index on `(analysis_id, model, record_id) WHERE record_id IS NOT NULL`, and inserts use `ON CONFLICT ... DO UPDATE`. Re-ingesting the same page (or running `resume` after a partial failure) replaces rather than duplicates.

**Caps:** 50 pages max per `ingest_all` call; 25 parent IDs max per nested call; 5 concurrent nested fetches.

### `analysis_store`

Stores LLM-generated qualitative findings — patterns, anomalies, conclusions — as semantic embeddings. **Not for raw record data** (that's `analysis_ingest`'s job, already done automatically).

**Inputs:**

| Field         | Notes                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| `analysis_id` | Required.                                                                           |
| `findings`    | Array of `{ finding, category?, metadata? }`. **Max 25 per call.**                  |
| `persistent`  | Default `false` (1-hour TTL). `true` keeps the finding around across conversations. |

`category` is free-form but acts as a grouping key for later recall (`naming_inconsistency`, `missing_metadata`, etc.). `metadata` is arbitrary JSON — typically record IDs or field values that justify the finding.

### `analysis_query`

Single unified tool with five modes. Mode is the only required discriminator beyond `analysis_id`.

| Mode        | Required params  | Returns                                                                                                                    | Use for                                                         |
| ----------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `describe`  | —                | Markdown table of fields, types, query syntax examples derived from the model's `attributes` config                        | Discovering shape before querying.                              |
| `semantic`  | `query`          | Findings + page summaries ranked by cosine similarity. Defaults: `top_k=50`, threshold 0.5. Filter by `category` to scope. | Recalling stored insights; searching page summaries by meaning. |
| `aggregate` | `group_by`       | `{ value, count }` rows sorted by count desc, formatted as a percentage distribution.                                      | Distribution of a field across the dataset.                     |
| `filter`    | `where`          | Matching `data` rows. Default limit 20, hard cap 200.                                                                      | Inspecting a specific subset.                                   |
| `sample`    | — (all optional) | Sampled `data` rows. Default 5, hard cap 50. Composes `stratify_by`, `where`, and `proximity`.                             | Representative spot-checks.                                     |

**`where` operator syntax** (used by `filter` mode and as a pre-filter in `sample` mode):

```json
{ "status": "active" }                                    // exact match (JSONB containment)
{ "duration_minutes": { "$gte": 40, "$lte": 120 } }       // numeric range
{ "started_at": { "$gte": "2026-01-01" } }                // date range (auto-cast to timestamptz)
```

Operators: `$gt`, `$gte`, `$lt`, `$lte`. The cast (`::numeric` vs `::timestamptz`) is inferred from the value type. Field names are validated against `^[a-zA-Z_][a-zA-Z0-9_]*$` before being interpolated into SQL.

### `analysis_act`

Applies a bulk update or delete to records previously ingested in the session. Resolves matching record IDs server-side from `ingested_records` using the same `where` vocabulary as `analysis_query mode: "filter"`, then runs the mutation in batches against the upstream API. **Only an aggregate summary returns to context — per-record IDs and results are never echoed back to the LLM.**

Annotated `destructiveHint: true`, `requiresAuth: true`. Same risk profile as `bulk_action_models`.

**Inputs:**

| Field         | Notes                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analysis_id` | Required. Must match a prior `analysis_ingest` call.                                                                                                                            |
| `model`       | Required. Must be a writable model present in the analysis session.                                                                                                             |
| `where`       | Optional. Same operator vocabulary as `analysis_query mode: "filter"`: exact match plus `$gt`/`$gte`/`$lt`/`$lte`. Omit to match every record of `model` in the session.        |
| `action`      | Required. `"update"` or `"delete"`.                                                                                                                                             |
| `attributes`  | Required when `action: "update"`, ignored when `action: "delete"`. Applied uniformly to every matched record.                                                                   |
| `dry_run`     | Optional. When `true`, returns `{ matched_count, sample_ids, sample_data, ingestedAtRange }` without calling the API. Use it to confirm scope and snapshot age before mutating. |
| `user_id`     | Service-account impersonation.                                                                                                                                                  |

**Batching:** internal batches of 50, concurrency cap of 5. Higher than `bulk_action_models` (25) because batches are never surfaced to the LLM — only the aggregate summary is.

**Response (live):**

```jsonc
{
  "summary": { "total": 312, "succeeded": 308, "failed": 4, "action": "update" },
  "sample_errors": [
    /* first 5 failed records, with status_code and message */
  ]
}
```

**Response (dry-run):**

```jsonc
{
  "matched_count": 312,
  "sample_ids": ["d-1", "d-2", ...],            // first 10
  "sample_data": [ /* first 3 rows, each with ingestedAt */ ],
  "ingestedAtRange": {
    "earliest": "2026-05-13T08:14:22Z",
    "latest":   "2026-05-13T08:15:01Z"
  }
}
```

**Snapshot staleness.** `ingested_records` is a point-in-time copy. A long gap between ingest and act means the upstream state may have drifted. The `ingestedAt` timestamp on the dry-run sample and `ingestedAtRange` exist so the LLM (and the operator reviewing the call) can judge whether to re-ingest first. There is no automatic revalidation pass — that's intentional, to keep the cost model predictable.

**Failure model.** Batches are not atomic across the whole set (same as `bulk_action_models`). A partial failure mid-run leaves earlier batches applied. `sample_errors` carries enough information to diagnose patterns; the server log carries the full per-record outcome.

**Progress.** When the MCP client supplies a `progressToken`, `analysis_act` emits one `notifications/progress` event per completed record.

### `analysis_summarize`

Re-runs one or more **summary strategies** against an already-ingested session, **without re-fetching from the API**. Reads records from `ingested_records` (mode `filter` when `where` is provided, else mode `sample` with a `max_records` cap) and writes one `analysis_memories` row per applicable strategy, with category `page_summary:<strategy>` and `metadata.source: "analysis_summarize"`.

| Field         | Notes                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `analysis_id` | Required.                                                                                                                    |
| `model`       | Optional override. Defaults to the session's ingested model (via `describeAnalysisSession`).                                 |
| `strategy`    | One strategy name (enum populated from the registry). Mutually exclusive with `strategies`.                                  |
| `strategies`  | Array of strategy names; each one writes a separate memory. Strategies whose `appliesTo` returns false are silently skipped. |
| `where`       | Optional filter using the `analysis_query mode: filter` operator vocabulary.                                                 |
| `max_records` | Cap on records loaded per run. Default 1000; max 5000.                                                                       |

Use it when you ingested with the default `distribution` strategy and now want an `anomaly` / `temporal` / `entity-extraction` / `coverage` view over the same records — no API round-trip required. See [Summary Strategies](./summary-strategies.md) for the built-in catalog.

### `analysis_clear`

Cascade-deletes both `analysis_memories` and `ingested_records` for the given `analysis_id`. Annotated `destructiveHint: true`. Call it once the synthesis is done.

---

## Stratified sampling

The `sample` mode composes three dimensions of stratification freely. All three can be combined in one call.

### 1. Discrete: `stratify_by`

Distributes sample slots evenly across distinct values of a JSONB field, so minority groups always appear. Implementation: `ROW_NUMBER() OVER (PARTITION BY data->>'<field>' ORDER BY RANDOM())` with a per-group budget of `CEIL(sample_size / num_groups)`.

Without stratification, 85 `active` + 10 `draft` + 5 `archived` records with `sample_size: 6` would almost always return six `active` rows. With `stratify_by: "status"` you get roughly two of each.

### 2. Temporal: `proximity`

Date-windowed sampling around an origin date, with optional bucket stratification.

```json
{
  "field": "created_at",
  "origin": "2026-03-15",
  "window": "7 days",
  "bucket": "1 day"
}
```

- `window` and `bucket` are validated against `^\d+\s+(day|days|week|weeks|month|months|hour|hours|minute|minutes)$`.
- Without `bucket`: uniform random sampling within the window.
- With `bucket`: PostgreSQL `date_bin(bucket, value, origin)` creates origin-anchored buckets, and the same `ROW_NUMBER()` budget allocation distributes slots across buckets.

For deeper detail (use cases, edge cases, performance notes), see [`proximity-sampling.md`](./proximity-sampling.md).

### 3. Pre-filter: `where`

Restricts the candidate set _before_ sampling. Same operator vocabulary as `filter` mode. Useful for "sample from the population that matches X" rather than "sample then filter".

### Composing all three

```jsonc
{
  "mode": "sample",
  "analysis_id": "q1-deal-audit",
  "sample_size": 12,
  "stratify_by": "status",
  "where": { "amount": { "$gte": 10000 } },
  "proximity": {
    "field": "closed_at",
    "origin": "2026-03-15",
    "window": "30 days",
    "bucket": "1 week"
  }
}
```

Reads as: _"From deals over $10k that closed in the 60 days around March 15, give me 12 examples — spread across statuses, spread across weeks."_ The `filtered` CTE applies `where` + the proximity date range, then the partition key `(date_bin(week, closed_at, origin), data->>'status')` allocates the budget.

---

## End-to-end workflow

A realistic session: an LLM auditing the `book` model in an example bookshelf server. The user asks "_what's the state of our library — any quality issues across the collection?_"

**1. Ingest** the dataset once, paginated up to the cap, with three lenses on every page:

```jsonc
analysis_ingest({
  analysis_id: "library-audit-2026-05",
  model: "book",
  ingest_all: true,
  per_page: 50,
  fields: ["id", "title", "author", "status", "rating", "updated_at"],
  summary_strategies: ["distribution", "anomaly", "temporal"]
})
// → "Stored 312 record(s) (6 fields per record) across 7 page(s). Analysis: library-audit-2026-05"
```

Up to twenty-one findings are stored automatically alongside the raw rows — three per page, one per strategy that passes its `appliesTo` check (`temporal` needs ≥1 ISO-date field; `anomaly` needs ≥4 records per page). Categories are `page_summary:distribution`, `page_summary:anomaly`, `page_summary:temporal`. Drop `summary_strategies` for the `distribution`-only default.

**2. Discover** the shape before querying:

```jsonc
analysis_query({ analysis_id: "library-audit-2026-05", mode: "describe" })
// → markdown table of book fields, enum values, and copy-pasteable query examples
```

**3. Aggregate** to ground the LLM in distributions:

```jsonc
analysis_query({ analysis_id: "library-audit-2026-05", mode: "aggregate", group_by: "status" })
// → "Distribution of \"status\" (312 total):
//      completed: 180 (57.7%)
//      reading: 80 (25.6%)
//      unread: 52 (16.7%)"
```

**4. Filter** to investigate one segment:

```jsonc
analysis_query({
  analysis_id: "library-audit-2026-05",
  mode: "filter",
  where: { "status": "completed", "rating": { "$lt": 2 } },
  limit: 20
})
// → up to 20 raw rows the LLM can reason over
```

**5. Sample** representatively for spot-checks:

```jsonc
analysis_query({
  analysis_id: "library-audit-2026-05",
  mode: "sample",
  sample_size: 9,
  stratify_by: "status"
})
// → 3 of each status, so the LLM doesn't see only the majority class
```

**5b. Re-summarize with new lenses** — no refetch:

```jsonc
analysis_summarize({
  analysis_id: "library-audit-2026-05",
  strategies: ["coverage", "entity-extraction"],
  max_records: 1000
})
// → adds page_summary:coverage and page_summary:entity-extraction
//   memories drawn from already-ingested rows. metadata.source
//   marks them as "analysis_summarize" so they're distinguishable
//   from per-page ingest summaries.
```

**6. Store findings** as the LLM forms them:

```jsonc
analysis_store({
  analysis_id: "library-audit-2026-05",
  findings: [
    { finding: "12 completed books rated 1 — outliers worth a re-read or de-listing", category: "quality_issue", metadata: { count: 12 } },
    { finding: "Sci-fi authors over-represented in 'reading' status — possible stalled-progress bias", category: "pattern" }
  ]
})
```

**7. Recall** semantically near the end of the session, after several rounds of querying:

```jsonc
analysis_query({
  analysis_id: "library-audit-2026-05",
  mode: "semantic",
  query: "issues with rating or quality",
  top_k: 20
})
// → all "quality_issue" findings + any page summaries whose distributions hint at the same
```

**8. Clear** once the synthesis lands:

```jsonc
analysis_clear({ analysis_id: "library-audit-2026-05" })
// → "Cleared 312 ingested record(s) and 9 finding(s) for analysis \"library-audit-2026-05\"."
```

---

## Lifecycle & retention

| Layer                              | Expiry                                                              | Eviction                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `analysis_memories` (ephemeral)    | 1 hour from creation                                                | On-access: every `recallMemories` call deletes expired rows first.                                          |
| `analysis_memories` (persistent)   | Never (until explicit clear)                                        | Set with `persistent: true` at store time.                                                                  |
| `ingested_records`                 | 7 days from store (configurable via `ingestedRecordsRetentionDays`) | On-access: every `queryRecords` call deletes expired rows first. Boot-time sweep on init.                   |
| `tool_memories` (separate feature) | `retentionDays` from `initVectorStorage`                            | Boot-time sweep + on-access.                                                                                |
| Background sweep (opt-in)          | Every `backgroundCleanupIntervalMs` ms                              | Periodic cleanup across all three tables. Off by default — set the option to enable for long-lived servers. |

**Practical implications:**

- The 7-day TTL on `ingested_records` is the **realistic working window** for an analysis session — long enough to ingest in the morning and `analysis_act` in the afternoon (or after a weekend), short enough that an abandoned session eventually frees its disk.
- `analysis_memories` is split deliberately: ephemeral findings are throw-away by design; the `persistent: true` flag is the explicit opt-in for findings that should outlive a session.
- A session whose `ingested_records` have expired will return an empty match set from `analysis_act` and `analysis_query`. Re-run `analysis_ingest` with `resume: true` to rebuild — page summaries will be regenerated.
- `analysis_clear` is the explicit teardown for a session that finished cleanly. Don't rely on TTL for cleanup if you store findings persistently.

---

## Troubleshooting

**The four tools don't appear in `tools/list`.** They're gated by `requiresVectorStorage`. Check:

1. `DATABASE_URL` is set.
2. `ANALYSIS_ENABLED=true`.
3. `initVectorStorage({ adapter: createPgvectorAdapter({ pool }) })` was called at server startup. The init returns `false` and logs a warning when the adapter is missing.
4. The `analysis_memories` and `ingested_records` tables exist (migrations applied).

**`analysis_ingest` reports duplicate-looking counts after a retry.** Resolved in commit c1cc813 — the table now has a partial unique index and inserts use `ON CONFLICT DO UPDATE`. If you're seeing it, confirm your migrations are up to date (the unique index ships in the relevant migration).

**`analysis_ingest` stops at 50 pages.** That's the `MAX_INGEST_PAGES` cap, surfaced in the response (`(capped at 50 pages)`). Tighten `filters` to reduce the result set, or run multiple sessions with disjoint filters.

**`analysis_query mode: "filter"` returns nothing for what looks like a valid match.** `where` uses JSONB containment for exact match — values must match the _stored_ representation. Numeric fields stored as strings (e.g. via flattened HAL responses) need range operators with the right cast: `{ "amount": { "$gte": 100 } }` infers `::numeric`. If your value is a string `"100"`, exact match needs the string form.

**Field name rejected with "Invalid field name".** Stratification, range conditions, and proximity all validate the field against `^[a-zA-Z_][a-zA-Z0-9_]*$` to keep them safe to interpolate into SQL. Dotted or hyphenated paths aren't supported — flatten the data at ingest time via `fields` or model associations.

**First semantic query is slow.** `@huggingface/transformers` lazy-loads and quantises the `all-MiniLM-L6-v2` weights on first call (~1–2 s). Subsequent calls are fast.

---

## File reference

| Path                                                | Purpose                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/mcp/tools/analysis/analysis-ingest-tool.ts`    | `analysis_ingest` tool                                                                                               |
| `src/mcp/tools/analysis/analysis-store-tool.ts`     | `analysis_store` tool                                                                                                |
| `src/mcp/tools/analysis/analysis-query-tool.ts`     | `analysis_query` tool (all five modes)                                                                               |
| `src/mcp/tools/analysis/analysis-act-tool.ts`       | `analysis_act` tool (server-side ID resolution + batched mutation)                                                   |
| `src/mcp/tools/analysis/analysis-summarize-tool.ts` | `analysis_summarize` tool (re-runs strategies against stored records, no refetch)                                    |
| `src/mcp/tools/analysis/analysis-clear-tool.ts`     | `analysis_clear` tool                                                                                                |
| `src/mcp/tools/analysis/base-analysis-tool.ts`      | Category binding (`ANALYSIS`, `requiresVectorStorage`)                                                               |
| `src/mcp/analysis-layer/summary-strategies/`        | Strategy interface + 5 built-ins (`distribution`, `coverage`, `anomaly`, `temporal`, `entity-extraction`) + registry |
| `src/runtime/vector-storage.ts`                     | Vendor-agnostic facade — `initVectorStorage`, `isVectorStorageEnabled`, all store/query/clear entry points           |
| `src/runtime/vendor/pgvector/index.ts`              | Pool injection, cleanup-on-boot                                                                                      |
| `src/runtime/vendor/pgvector/analysis-memories.ts`  | Findings table SQL (store, recall, clear, eviction)                                                                  |
| `src/runtime/vendor/pgvector/ingested-records.ts`   | Raw-data table SQL (store, aggregate/filter/sample, stratification)                                                  |
| `src/runtime/embeddings.ts`                         | Local `all-MiniLM-L6-v2` embeddings                                                                                  |
| `src/db/migrations.ts`                              | Migration data (`feature: 'analysis'` for these tables)                                                              |

Related guides:

- [`proximity-sampling.md`](./proximity-sampling.md) — deeper treatment of date-windowed sampling.
- [`tool-creation.md`](../04-tools/tool-creation.md) — how the `ANALYSIS` category fits into the broader tool/category model.
- [`transient-context.md`](./transient-context.md) — how `analysis_store` consumes transient context from upstream tools.

**Out of scope for this iteration** (tracked separately): a read-only `analysis_export` companion that returns filtered records to a downloadable artefact; an opt-in revalidation pass that re-fetches each candidate record before `analysis_act` mutates it to detect drift since ingest. See [issue #80](https://github.com/mcp-rune/mcp-rune/issues/80) for context.
