# `relationship-coverage` strategy

Per-edge-type stats over the **persisted relationship graph** built by `analysis_ingest`. For each `edge_type` discovered on the page, the strategy reports the percentage of records with at least one such edge, the mean and max degree, the distribution by destination model, and a sample of records that lack any edge of that type.

This is the edge-table-driven counterpart to `entity-extraction`: that strategy reads `*_id` scalar fields off the records themselves; `relationship-coverage` reads from the `ingested_edges` table populated by multi-hop ingest, so it captures `hasMany` array references and any edges followed across hops.

**Requires:** `['edges']`. The dispatcher bulk-loads the page's edges (one query per page) before calling `generate`.

At a glance — what the strategy reads, what it computes, what it writes:

<!-- illustration: summary-strategies#relationship-coverage -->

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│       INPUT        │    │     ALGORITHM      │    │       OUTPUT       │
├────────────────────┤    ├────────────────────┤    ├────────────────────┤
│ Records + edges    │    │ Per edge_type:     │    │ edge_types[name]   │
│ from multi-hop     │    │   unique src_ids   │    │   coverage_pct     │
│ ingest             │    │   coverage_pct =   │    │   mean_degree      │
│                    │ ─▶ │     unique / total │ ─▶ │   max_degree       │
│  belongsTo:author  │    │   mean degree      │    │   target_models{}  │
│  belongsTo:genre   │    │   max degree       │    │   gap_ids[]        │
│  hasMany:reviews   │    │   target dist.     │    │   (first 10 src    │
│                    │    │   first 10 gaps    │    │    with 0 edges)   │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

The **left** panel is the page's records plus the persisted edges from `ingested_edges` (multi-hop captures `hasMany` arrays that `entity-extraction` misses); the **middle** panel groups by `edge_type` and computes coverage + degree per type; the **right** panel surfaces the per-type stats plus the first 10 source IDs that lack any edge of that type — direct ammunition for a `where:{id:[...]}` follow-up.

## When to pick

- After a multi-hop ingest (`hop_depth: 1+`): the edge table is populated and this strategy gives you per-edge-type coverage at a glance.
- When you suspect `hasMany` arrays are sparsely populated — `entity-extraction` is blind to those, this one catches them.
- Pair with `concept-touch` to move from "which edge types are populated" to "which cross-entity concepts are coherent".

## Algorithm

1. Build a set of the page's `recordIds` (each record's `id`).
2. Filter the supplied `edges` list to only those whose `src_id` is in `recordIds`. (Edges loaded for adjacent pages bleed in; we drop them here.)
3. Bucket the filtered edges by `edge_type`.
4. For each `edge_type`:
   - `unique_sources` = count of distinct `src_id` values.
   - `coverage_pct = round(unique_sources / record_count × 100)`.
   - Compute degree per source; `mean_degree` and `max_degree`.
   - Tally `dst_model` distribution.
   - First 10 record IDs **with no edge of this type** become `gap_ids`.

Source: [`src/mcp/analysis-layer/summary-strategies/relationship-coverage.ts`](../../../../src/mcp/analysis-layer/summary-strategies/relationship-coverage.ts).

## Inputs consumed

- `input.records` — only `id`.
- `input.edges` — populated by the dispatcher when the strategy declares `requires: ['edges']`.
- `appliesTo` returns `false` when edges are absent or the page is empty.
- No `embeddings` or `domainRegistry` required.

## Output shape

```jsonc
{
  "finding": "Page 1/100 of book records (50 records). Edges: belongsTo:author: 47/50 sources (94%), mean degree 1, max 1, targets [author=47]. belongsTo:genre: 50/50 sources (100%), mean degree 1, max 1, targets [genre=50].",
  "metadata": {
    "page": 1,
    "model": "book",
    "record_count": 50,
    "edge_types": {
      "belongsTo:author": {
        "total": 47,
        "unique_sources": 47,
        "coverage_pct": 94,
        "mean_degree": 1,
        "max_degree": 1,
        "target_models": { "author": 47 },
        "gap_ids": ["b18", "b34", "b41"]
      },
      "belongsTo:genre": {
        "total": 50,
        "unique_sources": 50,
        "coverage_pct": 100,
        "mean_degree": 1,
        "max_degree": 1,
        "target_models": { "genre": 50 },
        "gap_ids": []
      }
    }
  }
}
```

## Edge cases

- **Multi-hop ingest disabled (`hop_depth: 0`)**: edges are still extracted from the root records at depth 0, so `belongsTo` / `hasMany` declared on the model are still reported. Only the deeper-hop edges (e.g. `genre → category` if genres had associations) are missing.
- **No edges declared at all** (`hop_follow: 'none'` or a model with no `associations`): the dispatcher still passes an empty `edges` array; the strategy reports "No edges recorded for this page".
- **Edges that fall outside the page**: if a record on the page has a `hasMany` edge into a model that wasn't ingested, the edge still appears in `ingested_edges` (just no destination record). The strategy reports it correctly; it's the dispatch loader's job to surface only `src_id`-matching edges.
- **Stale edges from a prior ingest**: edges are namespaced by `analysis_id` and TTL'd like records. A `analysis_clear` cascade-removes them.

## Bookshelf example

After the graph ingest in the [analysis quickstart](../analysis-quickstart.md):

```jsonc
analysis_ingest({
  analysis_id: "tour-graph",
  model: "book",
  ingest_all: true,
  hop_depth: 1,
  summary_strategies: ["relationship-coverage"]
})
```

The bookshelf graph fixture leaves ~5% of books without an `author_id`, so `belongsTo:author` coverage lands around 95% with three or so `gap_ids` per 50-record page — visible directly in the finding text:

```
Edges: belongsTo:author: 47/50 sources (94%), …, gap_ids [b18, b34, b41].
       belongsTo:genre: 50/50 sources (100%).
```

Recall by category:

```jsonc
analysis_query({
  analysis_id: "tour-graph",
  mode: "semantic",
  category: "page_summary:relationship-coverage",
  query: "missing author"
})
```

## See also

- [`entity-extraction`](./entity-extraction.md) — field-level FK tallying; complementary to this edge-level view.
- [`concept-touch`](./concept-touch.md) — concept-level participation built on the same edge table.
- [`graph stratifier` `kind:"edge"`](../analysis-quickstart.md) on `analysis_query mode:"sample"` — sample records balanced by edge presence or degree.
- [Summary Strategies overview](../summary-strategies.md).
