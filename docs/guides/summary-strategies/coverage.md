# `coverage` strategy

Per-field null/empty rate. Flags fields above the **sparse threshold** (default 50% missing) so the LLM has a quick read on where the data is incomplete before drawing conclusions from aggregates.

At a glance — what the strategy reads, what it computes, what it writes:

<!-- illustration: summary-strategies#coverage -->

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│       INPUT        │    │     ALGORITHM      │    │       OUTPUT       │
├────────────────────┤    ├────────────────────┤    ├────────────────────┤
│ All records, all   │    │ Per field:         │    │ coverage[field]    │
│ fields:            │    │   count null,      │    │   {present,        │
│                    │    │   undefined, ""    │    │    missing, rate}  │
│  title    50/50    │ ─▶ │                    │ ─▶ │                    │
│  rating   38/50    │    │ missing_rate =     │    │ sparse_fields[]    │
│  notes    29/50    │    │   missing / total  │    │   (fields with     │
│  genre_id 50/50    │    │ Flag if ≥ 50%      │    │    ≥ 50% missing)  │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

The **left** panel shows population per field on a page; the **middle** panel computes a missing rate per field; the **right** panel both keeps the full per-field stats and surfaces a `sparse_fields` shortlist for fields above the threshold — that shortlist is what the LLM reads first.

## When to pick

- Data-quality audits: "which fields are reliably populated?".
- Before trusting an aggregate or filter result — if a field is 60% missing, a `mode:"aggregate" group_by` over it tells a misleading story.
- Pair with `entity-extraction` or `relationship-coverage` for joined views: coverage handles field-level gaps; the relationship strategies handle FK/edge-level gaps.

## Algorithm

1. Walk every record and every field; count `null`, `undefined`, and `""` as missing.
2. For each field, compute `missing_count / record_count = missing_rate`.
3. Flag fields where `missing_rate >= SPARSE_THRESHOLD` (default `0.5`, hard-coded).
4. Pack per-field stats into `metadata.coverage` and the flagged subset into `metadata.sparse_fields`.

Source: [`src/core/summary-strategies/coverage.ts`](../../../src/core/summary-strategies/coverage.ts).

## Inputs consumed

- `input.records` — every field of every record.
- No requirement on `edges`, `embeddings`, or `domainRegistry`.
- No `appliesTo` gate — always runs.

## Output shape

A representative `analysis_memories` row:

```jsonc
{
  "finding": "Page 1/100 of book records (50 records). Coverage: title 100%, status 100%, genre_id 100%, rating 76% (12 missing), notes 58% (21 missing), author_id 95% (3 missing). Sparse fields (≥50% missing): none.",
  "metadata": {
    "page": 1,
    "model": "book",
    "record_count": 50,
    "coverage": {
      "title": { "present": 50, "missing": 0, "rate": 1.0 },
      "rating": { "present": 38, "missing": 12, "rate": 0.76 },
      "notes": { "present": 29, "missing": 21, "rate": 0.58 }
    },
    "sparse_threshold": 0.5,
    "sparse_fields": []
  }
}
```

On a page where `notes` is 60% missing, `metadata.sparse_fields` would be `["notes"]` and the finding text would lead with the flag so semantic recall picks up "missing notes" queries.

## Edge cases

- **Empty page**: `record_count` is 0 and `coverage` is empty. The finding text says "0 records" and no fields are flagged.
- **Field present on some records but absent on others**: counted as missing on the absent records. JSONB stores treat absent and `null` identically, which matches the strategy's definition.
- **Empty arrays / empty objects**: not treated as missing. Only literal `null` / `undefined` / `""` count. If you want array-emptiness coverage, write a custom strategy.
- **Threshold tuning**: the 50% threshold is fixed in the source. For per-deployment thresholds, ship a custom strategy that reads `input.options?.sparse_threshold`.

## Bookshelf example

After the basic ingest in the [analysis quickstart](../analysis-quickstart-guide.md), re-summarize with coverage:

```jsonc
analysis_summarize({
  analysis_id: "tour",
  strategy: "coverage",
  max_records: 5000
})
```

The bookshelf generator leaves ~25% of records missing `rating` and ~40% missing `notes`. On most pages neither crosses 50%, so `sparse_fields` stays empty — but the per-field rates surface clearly in the finding text so the LLM can call out the partial coverage even without a flag.

```jsonc
analysis_query({
  analysis_id: "tour",
  mode: "semantic",
  category: "page_summary:coverage",
  query: "missing notes"
})
```

## See also

- [`distribution`](./distribution.md) — the "what's present" counterpart.
- [`relationship-coverage`](./relationship-coverage.md) — coverage but for edges (`belongsTo`/`hasMany`) rather than fields.
- [`anomaly`](./anomaly.md) — uses coverage indirectly: low-coverage numeric fields skew z-scores, which the anomaly strategy guards against.
- [Summary Strategies overview](../summary-strategies.md).
