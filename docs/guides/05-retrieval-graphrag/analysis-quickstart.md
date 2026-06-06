# Analysis Quickstart

Part 2 of the [Quickstart](../01-getting-started/quickstart.md). Once the bookshelf is
running with its 5,000-book dataset, this guide brings up
postgres+pgvector, points the analysis tools at it, and walks **all nine
built-in summary strategies** end to end — five field-level strategies
on the `large` dataset, then four GraphRAG-aware strategies on the
`graph` dataset (500 books with author + genre + intentional gaps).

You'll spend about twenty minutes: ~3 on infrastructure, ~7 on the
field-level tour, ~7 on the GraphRAG tour, ~3 on graph-aware sampling
and teardown.

## Prerequisites

- Part 1 of the [Quickstart](../01-getting-started/quickstart.md) running locally
  (i.e. the `bookshelf` example is scaffolded as `my-app` and starts).
- Docker (for one container) and a free port on `5432`.

The analysis tools (`analysis_ingest`, `analysis_summarize`,
`analysis_query`, `analysis_act`, `analysis_clear`, `analysis_store`)
are gated by `requiresVectorStorage`. Without pgvector, they don't show
up in `tools/list` — that's by design (see
[Analysis Memories](./analysis-memories.md#troubleshooting)).

## 1. Start pgvector

Drop this `docker-compose.yml` next to `my-app/server.ts`
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

Open `my-app/server.ts` and add the storage init before
`createServer` is called:

```ts file=src/pool.ts
import { Pool } from 'pg'
import { vectorStorage } from '@mcp-rune/mcp-rune/services'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
vectorStorage.initVectorStorage({
  pool,
  serviceName: 'bookshelf-mcp',
  version: '1.0.0'
})
```

```js file=src/pool.js
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

## 5.5 Switch to the graph dataset for the GraphRAG strategies

The remaining four strategies — `relationship-coverage`, `concept-touch`,
`rule-violation`, `semantic-cluster` — read from edges, embeddings, and
the domain registry. None of those exist on the flat `large` dataset.
Restart the bookshelf with the **graph** dataset, which adds `author`
and `genre` models with proper foreign keys, two `DomainConcept`s
(`reading-pipeline`, `catalogue`), and two `BusinessRule`s
(`completed-books-need-rating`, `books-need-author`). The graph
generator deliberately leaves ~5% of books without an `author_id` and
~15% of completed books without a `rating` so every GraphRAG strategy
has real signal to surface.

Stop the running Inspector, then:

```bash
DATABASE_URL=postgres://bookshelf:bookshelf@localhost:5432/bookshelf \
ANALYSIS_ENABLED=true \
BOOKSHELF_DATASET=graph \
npx @modelcontextprotocol/inspector -- npx tsx server.ts
```

In the Inspector, run a fresh ingest. The new args are `hop_depth: 1`
(follow declared `belongsTo` associations) and `embed_records: true`
(the default — embeddings are needed for `semantic-cluster`):

```jsonc
analysis_ingest({
  analysis_id: "graphrag",
  model: "book",
  ingest_all: true,
  hop_depth: 1,
  embed_records: true,
  summary_strategies: [
    "relationship-coverage",
    "concept-touch",
    "rule-violation",
    "semantic-cluster"
  ]
})
// → Stored 500 record(s) across 10 page(s). Hopped: 10 author, 6 genre.
// → ~40 memories written (one per page per strategy, modulo appliesTo gates).
```

Four strategy lenses, walked one at a time:

### `relationship-coverage`

```jsonc
analysis_query({
  analysis_id: "graphrag",
  mode: "semantic",
  category: "page_summary:relationship-coverage",
  query: "missing author edge"
})
// → top finding names belongsTo:author coverage % per page (around 94%)
//   and the 1–3 gap IDs per page that lack an author edge.
```

The [`relationship-coverage` guide](./summary-strategies/relationship-coverage.md)
explains the per-edge-type stats; the takeaway here is that the gap
records surface directly in the finding text so the LLM can
`analysis_query mode:"filter" where:{id:[...]}` to inspect them.

### `concept-touch`

```jsonc
analysis_query({
  analysis_id: "graphrag",
  mode: "semantic",
  category: "page_summary:concept-touch",
  query: "catalogue gap"
})
// → finding contains "catalogue → [author, genre]: 47/50 (94%);
//   per-target author=47, genre=50". The 3-record gap matches the
//   bookshelf's missing-author rate.
```

`reading-pipeline` (book + genre) lands at 100% because every book has a
genre. `catalogue` (book + author + genre) lands lower because of the
missing-author records. See the [`concept-touch` guide](./summary-strategies/concept-touch.md).

### `rule-violation`

```jsonc
analysis_query({
  analysis_id: "graphrag",
  mode: "semantic",
  category: "page_summary:rule-violation",
  query: "completed books missing rating"
})
// → finding names the failing rule + the first few IDs per page:
//   "completed-books-need-rating (warning): N/50 failed (e.g. b127, b223)".
//   "books-need-author (error): 2/50 failed (e.g. b34, b48)".
```

See the [`rule-violation` guide](./summary-strategies/rule-violation.md).

### `semantic-cluster`

```jsonc
analysis_query({
  analysis_id: "graphrag",
  mode: "semantic",
  category: "page_summary:semantic-cluster",
  query: "natural book groupings"
})
// → finding names the cluster representatives by title hint:
//   "cluster 1 (size 14, mean dist 0.18): rep b3 \"Clean Patterns #3\""
//   …
```

See the [`semantic-cluster` guide](./summary-strategies/semantic-cluster.md).

## 5.6 Graph-aware sampling with composable stratifiers

With edges + embeddings + concepts in play, `analysis_query mode:"sample"`
can balance a sample across multiple graph dimensions at once. The
`stratifiers` param accepts up to 3 entries that compose with the
existing `where` / `proximity` / `stratify_by` partitioning:

```jsonc
analysis_query({
  mode: "describe",
  analysis_id: "graphrag",
  model: "book"
})
// → A "Graph dimensions available" section lists registered concepts,
//   observed edge types, and embedding coverage %.
```

A three-stratifier sample, pre-filtered to completed books:

```jsonc
analysis_query({
  mode: "sample",
  analysis_id: "graphrag",
  sample_size: 12,
  where: { status: "completed" },
  stratifiers: [
    { kind: "concept", concept: "catalogue" },
    { kind: "edge",    edge_type: "belongsTo:genre", bucket: "present" },
    { kind: "cluster", k: 3 }
  ],
  sample_model: "book"
})
// → 12 completed-status books, balanced across:
//   - concept (catalogue touched vs not)
//   - edge presence (has genre edge vs not — uniform on bookshelf)
//   - semantic cluster (3 anchor-nearest groups)
```

When `kind: "cluster"` is requested on a session that was ingested with
`embed_records: false`, the tool auto-back-fills missing embeddings
before sampling. No re-ingest required.

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

- [Summary Strategies](./summary-strategies.md) — full catalog with
  links to each strategy's deep-dive guide, the `SummaryStrategy`
  contract, and a walk-through for shipping your own strategy via an
  `ApiExtension`.
- Per-strategy guides under [`summary-strategies/`](./summary-strategies/) —
  one file each for the nine built-ins; explains the algorithm, inputs
  consumed, output shape, and edge cases.
- [Analysis Memories](./analysis-memories.md) — the full feature
  reference: ingest modes, the five-mode `analysis_query` API,
  stratified sampling, `analysis_act`, lifecycle and retention.
- [Proximity Sampling](./proximity-sampling.md) — date-windowed
  bucketed sampling for the `analysis_query mode: sample` path.
- [Domain Knowledge Guide](../07-domain-intelligence/domain-knowledge.md) — how
  `DomainConcept` and `BusinessRule` feed `concept-touch` and
  `rule-violation`.
