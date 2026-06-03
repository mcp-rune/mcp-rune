# `semantic-cluster` strategy

Client-side **anchor-nearest clustering** over the embeddings of a page's records. Picks `k` anchor records, assigns every embedded record to its nearest anchor by cosine distance, reports per-cluster size, the representative record (the one closest to its anchor), and the mean intra-cluster cosine distance.

Complementary to the SQL `cluster` stratifier (see [analysis-quickstart](../analysis-quickstart-guide.md) section on sampling): that one partitions a sample server-side; this one summarizes a page client-side and writes a narrative cluster summary to `analysis_memories`.

**Requires:** `['embeddings']`. The dispatcher loads them in one query per page.

At a glance — what the strategy reads, what it computes, what it writes:

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│       INPUT        │    │     ALGORITHM      │    │       OUTPUT       │
├────────────────────┤    ├────────────────────┤    ├────────────────────┤
│ Records +          │    │ Pick first k       │    │ clusters[i]        │
│ embeddings         │    │ records as anchors │    │   size             │
│ Float32Array(384)  │    │ (default k = 5)    │    │   mean_distance    │
│                    │ ─▶ │                    │ ─▶ │   representative_  │
│  rec1: [embedding] │    │ For each record:   │    │     id + hint      │
│  rec2: [embedding] │    │   cosine dist to   │    │     (title/name)   │
│  ...               │    │   each anchor;     │    │   member_ids[]     │
│                    │    │   assign nearest   │    │                    │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

The **left** panel feeds the dispatcher-loaded 384-dim embeddings keyed by record ID; the **middle** panel runs deterministic anchor-nearest clustering (the first k records are the anchors — pure-function contract); the **right** panel labels each cluster with a representative record's title/name so the embedded finding text is human-readable for later semantic recall.

## When to pick

- After an ingest with `embed_records: true` (the default). You get a sense of how the page's records group by semantic similarity, without taking a sample.
- When the records have a meaningful text axis (titles, descriptions) — that's what the MiniLM embedding pipeline (`buildEmbeddingText`) extracts.
- A first read on natural categories that aren't declared as enums: "cluster 3 is all about distributed systems; cluster 4 is all about testing".

## Algorithm

1. `k = input.options?.k ?? 5` (capped to `[2, 20]`).
2. `appliesTo` returns `false` when `embeddings` is missing or smaller than `k`.
3. From the records, keep only those whose `id` is present in `embeddings`. Call this `embeddedRecords`.
4. **Anchor selection**: take the first `k` elements of `embeddedRecords`. (Deterministic by record order — strategies must be pure functions over `input`, and a fresh randomness on every call would break that contract. For seeded shuffling, ship a custom strategy that reads `input.options?.seed`.)
5. For every embedded record, compute cosine distance to each anchor (the embeddings come back from the model normalized, so cosine distance is `1 - dot product`). Assign to the nearest anchor.
6. Per cluster, sort members by distance ascending; the closest member to the anchor is the **representative**. Compute mean intra-cluster distance.
7. The `representative_hint` is the first non-empty value from `title` / `name` / `subject` on the representative record, truncated to 60 chars. Useful as a human-readable label.

Source: [`src/core/summary-strategies/semantic-cluster.ts`](../../../src/core/summary-strategies/semantic-cluster.ts).

## Inputs consumed

- `input.records` — only `id` and the optional hint fields.
- `input.embeddings` — `Map<record_id, Float32Array(384)>`. Populated by the dispatcher.
- `input.options?.k` — cluster count, default 5.

## Output shape

```jsonc
{
  "finding": "Page 1/100 of book records (50 records, 50 embedded). Semantic clusters (k=5): cluster 1 (size 14, mean dist 0.18): rep b3 \"Clean Architecture in Practice\". cluster 2 (size 11, mean dist 0.22): rep b7 \"Pragmatic Distributed Workflows\". cluster 3 (size 9, mean dist 0.21): rep b17 \"Refactoring Patterns\". cluster 4 (size 9, mean dist 0.23): rep b11 \"Testing Deliberate Systems\". cluster 5 (size 7, mean dist 0.19): rep b39 \"Resilient Observability\".",
  "metadata": {
    "page": 1,
    "model": "book",
    "record_count": 50,
    "embedded_count": 50,
    "k": 5,
    "clusters": {
      "cluster_1": {
        "size": 14,
        "representative_id": "b3",
        "representative_hint": "Clean Architecture in Practice",
        "mean_distance": 0.18,
        "member_ids": ["b3", "b22", "b41", …]
      },
      …
    }
  }
}
```

## Edge cases

- **No embeddings supplied**: `appliesTo` returns `false`. Ensure `embed_records: true` at ingest, or run `analysis_query mode:"sample"` with a cluster stratifier first — that auto-back-fills embeddings and the next `analysis_summarize` call sees them.
- **Page smaller than `k`**: `appliesTo` returns `false`. Lower `k` via `options.k`, or accept the skip.
- **All embeddings near-identical**: clusters still form but mean distances are tiny. The `finding` text faithfully reports the small distances; the LLM can interpret that as "no meaningful grouping".
- **Empty clusters**: an anchor that no other record ends up closer to than the rest produces a 1-record cluster (just the anchor itself). The strategy still reports it.
- **Non-text records**: `buildEmbeddingText` excludes `id` / `*_id` and concatenates remaining string + number + boolean fields. Records with no string content embed as the empty string — distance to other records will be uninformative.

## Bookshelf example

The bookshelf graph fixture has rich titles like `"Clean Patterns #42"`, `"Pragmatic Workflows #128"`, etc. With `embed_records: true` (the default):

```jsonc
analysis_ingest({
  analysis_id: "tour-graph",
  model: "book",
  ingest_all: true,
  embed_records: true,
  summary_strategies: ["semantic-cluster"],
  // Default k=5; pass `summary_options` to override per page.
})
```

Note: `summary_options` isn't yet a tool param (per-strategy options ride on `input.options`); to control `k` for `semantic-cluster` specifically, ship a thin custom-strategy wrapper that calls `semanticClusterStrategy.generate({ ...input, options: { k: 8 } })`.

Recall:

```jsonc
analysis_query({
  analysis_id: "tour-graph",
  mode: "semantic",
  category: "page_summary:semantic-cluster",
  query: "natural book groupings"
})
```

The top hit names the cluster representatives by title so the LLM can see the topical axes at a glance.

## See also

- [SQL `cluster` stratifier](../analysis-quickstart-guide.md#sample-mode-with-graph-stratifiers) on `analysis_query mode:"sample"` — server-side clustering for sampling. Same underlying idea, different output (a sample vs. a narrative summary).
- [`anomaly`](./anomaly.md) — outlier per record; this strategy is groupings per page. They answer different questions.
- [`entity-extraction`](./entity-extraction.md) — categorical groupings via FK fields rather than embeddings.
- [Summary Strategies overview](../summary-strategies.md).
