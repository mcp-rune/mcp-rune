# Analysis Quickstart

Part 2 of the [Quickstart](./quickstart-guide.md). Once the bookshelf is
running with its 5,000-book dataset, this guide brings up
postgres+pgvector, points the analysis tools at it, and walks the five
built-in **summary strategies** end to end — first one at a time, then
all in a single ingest call.

You'll spend about twelve minutes: ~3 on infrastructure, ~6 on the
strategies, ~3 on semantic recall and teardown.

## Prerequisites

- Part 1 of the [Quickstart](./quickstart-guide.md) running locally
  (i.e. the `bookshelf` example clones and starts).
- Docker (for one container) and a free port on `5432`.

The analysis tools (`analysis_ingest`, `analysis_summarize`,
`analysis_query`, `analysis_act`, `analysis_clear`, `analysis_store`)
are gated by `requiresVectorStorage`. Without pgvector, they don't show
up in `tools/list` — that's by design (see
[Analysis Memories](./analysis-memories-guide.md#troubleshooting)).

## 1. Start pgvector

Drop this `docker-compose.yml` next to `examples/bookshelf/server.ts`
and run `docker compose up -d`:

```yaml
services:
  pgvector:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: bookshelf
      POSTGRES_PASSWORD: bookshelf
      POSTGRES_DB: bookshelf
    ports:
      - '5432:5432'
```

Then apply mcp-rune's migrations against the new database. The
framework ships migrations as data:

```bash
DATABASE_URL=postgres://bookshelf:bookshelf@localhost:5432/bookshelf \
ANALYSIS_ENABLED=true \
npx tsx -e "
import { Pool } from 'pg';
import { migrations } from '@mcp-rune/mcp-rune/db/migrations';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const needed = migrations.filter(m => m.feature === 'core' || process.env.ANALYSIS_ENABLED === 'true');
for (const m of needed) { await pool.query(m.up); console.log('applied', m.name); }
await pool.end();
"
```

That creates the two tables the feature relies on:
`analysis_memories` (vectors, JSONB) and `ingested_records` (raw rows,
JSONB).

## 2. Wire vector storage into the bookshelf

Open `examples/bookshelf/server.ts` and add the storage init before
`createServer` is called:

```ts
import { Pool } from 'pg'
import { vectorStorage } from '@mcp-rune/mcp-rune/services'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
vectorStorage.initVectorStorage({
  pool,
  serviceName: 'bookshelf-mcp',
  version: '1.0.0'
})
```

When the pool is missing — say you forget `DATABASE_URL` — init returns
`false` and the six analysis tools simply stay out of `tools/list`. No
crash, no noisy error path.

## 3. Boot the bookshelf with the big dataset

```bash
DATABASE_URL=postgres://bookshelf:bookshelf@localhost:5432/bookshelf \
ANALYSIS_ENABLED=true \
BOOKSHELF_DATASET=large \
npx @modelcontextprotocol/inspector -- npx tsx server.ts
```

Inside the Inspector, confirm the analysis tools are now visible —
`analysis_ingest`, `analysis_summarize`, `analysis_query`,
`analysis_act`, `analysis_clear`, `analysis_store` should all appear
alongside the CRUD tools. If they don't, double-check `ANALYSIS_ENABLED`
is `true` and the `initVectorStorage` block has a live pool.

## 4. One strategy at a time

`analysis_ingest` downloads records once and writes a per-page summary
through whichever strategy you pick. After the first ingest, every
later call goes through `analysis_summarize`, which re-runs strategies
against the already-stored rows without hitting the API again — the
whole point of the two-tool split.

### `distribution` (the default)

```jsonc
analysis_ingest({
  analysis_id: "tour",
  model: "book",
  ingest_all: true,
  per_page: 50
})
// → "Stored 5000 record(s) (8 fields per record) across 100 page(s)."
// → 100 memories written with category "page_summary:distribution".
```

### `coverage`

```jsonc
analysis_summarize({
  analysis_id: "tour",
  strategy: "coverage",
  max_records: 5000
})
// → category "page_summary:coverage", flags `notes` and `rating`
//   on pages where the missing rate crosses 50%.
```

### `anomaly`

```jsonc
analysis_summarize({
  analysis_id: "tour",
  strategy: "anomaly",
  max_records: 5000
})
// → category "page_summary:anomaly", surfaces the ~1% of records
//   with extreme `pages` values (|z| > 2) plus rare enum values.
```

### `temporal`

```jsonc
analysis_summarize({
  analysis_id: "tour",
  strategy: "temporal",
  max_records: 5000
})
// → category "page_summary:temporal", buckets `created_at` by week,
//   reports the recency window, and flags the 60-day gap baked into
//   the generator.
```

### `entity-extraction`

```jsonc
analysis_summarize({
  analysis_id: "tour",
  strategy: "entity-extraction",
  max_records: 5000
})
// → category "page_summary:entity-extraction", top-N `genre_id`
//   crosswalk for the page.
```

## 5. Several strategies in one pass

The same lens menu is available at ingest time. Run all five at once on
a fresh `analysis_id` to see what a multi-strategy ingest looks like
end to end:

```jsonc
analysis_ingest({
  analysis_id: "tour-multi",
  model: "book",
  ingest_all: true,
  per_page: 50,
  summary_strategies: [
    "distribution",
    "coverage",
    "anomaly",
    "temporal",
    "entity-extraction"
  ]
})
// → Stored 5000 records across 100 pages.
// → ~500 memories written: one per page per strategy that passed its
//   `appliesTo` check (anomaly needs ≥4 records per page; temporal
//   needs ≥1 ISO-date field; entity-extraction needs ≥1 *_id field).
```

`summary_strategy` (singular) and `summary_strategies` (plural) are
mutually exclusive — passing both fails fast at validation time.

## 6. Recall by category

Every memory is written with `category: "page_summary:<strategy>"`,
which lets `analysis_query mode: semantic` filter cleanly:

```jsonc
analysis_query({
  analysis_id: "tour-multi",
  mode: "semantic",
  category: "page_summary:anomaly",
  query: "outlier page count"
})
// → only the anomaly memories rank, no distribution noise in the results.
```

Drop the `category` to cross-cut all strategies:

```jsonc
analysis_query({
  analysis_id: "tour-multi",
  mode: "semantic",
  query: "missing metadata"
})
// → ranks coverage memories highest, with relevant distribution and
//   anomaly memories trailing.
```

## 7. Teardown

`analysis_clear` cascade-deletes both tables for the session:

```jsonc
analysis_clear({ analysis_id: "tour" })
analysis_clear({ analysis_id: "tour-multi" })
// → "Cleared 5000 ingested record(s) and N finding(s) …"
```

`docker compose down -v` drops the container and the volume — by design
the analysis loop is opt-in infrastructure, not a permanent dependency.

## Where to go next

- [Summary Strategies](./summary-strategies.md) — full catalog, the
  `SummaryStrategy` contract, and a walk-through for shipping your own
  strategy via an `ApiExtension`.
- [Analysis Memories](./analysis-memories-guide.md) — the full feature
  reference: ingest modes, the five-mode `analysis_query` API,
  stratified sampling, `analysis_act`, lifecycle and retention.
- [Proximity Sampling](./proximity-sampling-guide.md) — date-windowed
  bucketed sampling for the `analysis_query mode: sample` path.
