# `anomaly` strategy

Surfaces the **records that don't look like everything else** on the page. Two complementary lenses:

- **Numeric z-score outliers** — values whose absolute z-score exceeds 2 in their field. Catches "this book has 2,500 pages" when the mean is 280.
- **Rare enum values** — values that occur on less than 5% of records. Catches "one record has `status: 'archived'`" when 49 of 50 say `completed` or `reading`.

At a glance — what the strategy reads, what it computes, what it writes:

<!-- illustration: summary-strategies#anomaly -->

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│       INPUT        │    │     ALGORITHM      │    │       OUTPUT       │
├────────────────────┤    ├────────────────────┤    ├────────────────────┤
│ Page of N records  │    │ Numeric fields:    │    │ outlier_records[]  │
│ (N ≥ 4)            │    │   mean, stddev     │    │   {id, field,      │
│                    │ ─▶ │   flag |z| > 2     │ ─▶ │    value, z_score} │
│ e.g. pages column: │    │                    │    │                    │
│  312, 285, 2854,   │    │ Categorical        │    │ rare_values[]      │
│  401, 268, ...     │    │ (≤ 20 distinct):   │    │   {field, value,   │
│                    │    │   flag share < 5%  │    │    count, share}   │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

The 2854-pages row is the outlier the **left** panel feeds in; the **middle** panel flags it via z-score; the **right** panel is what lands in `analysis_memories.metadata` for later semantic recall.

## When to pick

- After a `distribution` pass: you've seen what's typical, now see what isn't.
- Triage runs over large datasets where you can only afford to inspect a handful of records by hand — the outlier IDs land in `metadata` so the LLM can stratify-sample around them.
- Categorical drift detection — a never-before-seen status value shows up as a rare enum.

## Algorithm

1. Bail out if the page has fewer than **4 records** (z-scores need a meaningful population). `appliesTo` enforces this.
2. **Numeric fields**: compute mean + standard deviation per field; flag any record whose `|value − mean| / stddev > 2`. Skip fields with stddev = 0 (all values identical).
3. **Categorical fields** (≤ 20 distinct values, by the same heuristic as `distribution`): flag any value whose share is < 5% (rounded).
4. Collect `outlier_records` as an array of `{id, field, value, z_score?}` entries (limited to 20 per page to keep the memory row size bounded).

Source: [`src/mcp/analysis-layer/summary-strategies/anomaly.ts`](../../../../src/mcp/analysis-layer/summary-strategies/anomaly.ts).

## Inputs consumed

- `input.records` — all fields of all records.
- `appliesTo` returns `false` when `records.length < 4`.
- No `edges`, `embeddings`, or `domainRegistry` required.

## Output shape

```jsonc
{
  "finding": "Page 7/100 of book records (50 records). Numeric outliers: pages records [2147, 13] (|z|≈3.4, mean 278). Rare enum values: status=archived (1/50, 2%). Total outlier records: 3.",
  "metadata": {
    "page": 7,
    "model": "book",
    "record_count": 50,
    "numeric_outliers": [
      { "id": "2147", "field": "pages", "value": 2854, "z_score": 3.41 },
      { "id": "13", "field": "pages", "value": 2241, "z_score": 2.45 }
    ],
    "rare_values": [{ "field": "status", "value": "archived", "count": 1, "share": 0.02 }]
  }
}
```

## Edge cases

- **< 4 records**: `appliesTo` returns false. The strategy is silently skipped; no memory is stored.
- **All identical values** in a numeric field: skipped (zero variance). The field contributes nothing.
- **Very small page where a 1-occurrence enum is technically rare**: the threshold is 5%, so on a 50-record page a single occurrence (2%) flags. On a 10-record page (10%), it doesn't. That's intentional: a single occurrence on a tiny page is normal.
- **Missing values**: ignored for z-score (the mean is computed over present values). For categorical, missing values are not counted toward the share.

## Bookshelf example

The bookshelf graph fixture deliberately gives ~1% of records a `pages` value of 2,000–3,500 (most are 120–520). After ingest:

```jsonc
analysis_summarize({
  analysis_id: "tour-graph",
  strategy: "anomaly",
  max_records: 5000
})
```

Then ask:

```jsonc
analysis_query({
  analysis_id: "tour-graph",
  mode: "semantic",
  category: "page_summary:anomaly",
  query: "extreme page count outliers"
})
```

The top hit names the specific outlier record IDs so you can `analysis_query mode:"filter" where:{id: ["<id>"]}` straight to them.

## See also

- [`distribution`](./distribution.md) — the typical-shape counterpart.
- [`coverage`](./coverage.md) — coverage gaps can manufacture spurious z-scores; the anomaly strategy guards against this by skipping zero-variance fields, but very-sparse fields produce noisy outlier flags.
- [`semantic-cluster`](./semantic-cluster.md) — soft clustering reveals "groups that look different from each other"; anomaly reveals "individuals that look different from the page".
- [Summary Strategies overview](../summary-strategies.md).
