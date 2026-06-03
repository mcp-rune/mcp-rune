# `distribution` strategy

The default summary strategy. Captures the **shape of a page** without taking a position on what's interesting yet — value distributions for low-cardinality fields, basic numeric stats for numeric fields, and ISO-date ranges for date fields.

If you don't ask for a strategy by name, this is what `analysis_ingest` runs.

At a glance — what the strategy reads, what it computes, what it writes:

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│       INPUT        │    │     ALGORITHM      │    │       OUTPUT       │
├────────────────────┤    ├────────────────────┤    ├────────────────────┤
│ First record's     │    │ Classify field:    │    │ fields[name]       │
│ fields, then       │    │  ≤ 20 distinct →   │    │   enum   : top 5   │
│ scan all records:  │    │     enum-like      │    │   numeric: min/max │
│                    │ ─▶ │  numeric →         │ ─▶ │     avg/median     │
│  status (enum)     │    │     min/max/avg/   │    │   date   : early-  │
│  rating (numeric)  │    │     median         │    │     iest / latest  │
│  created_at (date) │    │  ISO date → range  │    │   other  : skipped │
│  title (other)     │    │  else → skip       │    │                    │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

The **left** panel is a mixed-shape record; the **middle** panel routes each field to the appropriate per-kind summarizer; the **right** panel keys everything by field name so semantic recall by field name is direct.

## When to pick

- The first pass over a new dataset: you want a quick map of what fields exist, what values each one carries, and what ranges the numeric and date fields span.
- A "describe the page" lens for any `analysis_summarize` re-run when you want a baseline before drilling in with `anomaly` or `coverage`.
- The category memory recall by **field name** is most predictable: every page produces a `page_summary:distribution` row that names every field it found, so semantic search across a session reliably hits the right page when you ask "what's the typical genre on page 3?".

## Algorithm

1. For each field on the first record, classify it as one of: **enum-like** (≤ 20 distinct string/number values across the page), **numeric**, **date** (ISO 8601 string), or **other**.
2. **Enum-like**: count occurrences per value, sort by frequency, top 5.
3. **Numeric**: compute min, max, average, median.
4. **Date**: earliest and latest ISO timestamp.
5. **Other**: skip — distribution has nothing to say.
6. Pack everything into `metadata.fields` keyed by field name, plus a one-line per-field `finding` text suitable for semantic embedding.

Source: [`src/core/summary-strategies/distribution.ts`](../../../src/core/summary-strategies/distribution.ts).

## Inputs consumed

- `input.records` — every field of every record. No requirement on `edges`, `embeddings`, or `domainRegistry`.
- No `appliesTo` gate — always runs.

## Output shape

A real `analysis_memories` row from a bookshelf ingest looks like:

```jsonc
{
  "finding": "Page 1/100 of book records (50 records). status: completed=18, reading=17, unread=15. genre_id: g-software=12, g-architecture=9, g-testing=8, g-management=7, g-databases=7. rating: avg=3.8 (min 1, max 5, median 4). pages: avg=276 (min 121, max 519, median 260). created_at: 2024-01-04 → 2025-12-30.",
  "metadata": {
    "page": 1,
    "model": "book",
    "record_count": 50,
    "fields": {
      "status": { "kind": "enum", "top": [{ "value": "completed", "count": 18 }, …] },
      "genre_id": { "kind": "enum", "top": [{ "value": "g-software", "count": 12 }, …] },
      "rating": { "kind": "numeric", "min": 1, "max": 5, "avg": 3.8, "median": 4 },
      "created_at": { "kind": "date", "earliest": "2024-01-04T…", "latest": "2025-12-30T…" }
    }
  }
}
```

The finding text reads naturally because it's intended to be embedded — when the LLM later asks `analysis_query mode:"semantic" query:"rating distribution"`, the row that mentions "rating: avg=3.8" ranks first.

## Edge cases

- **Empty page**: the strategy still runs and produces a `Page 1/N of <model> records (0 records).` finding with an empty `metadata.fields`. The dispatcher trusts `appliesTo` for skipping; distribution doesn't gate.
- **Single-value enum**: a field with one observed value is still classified as enum-like and reported as `field: value=count`.
- **All-null field**: omitted from the per-field text. The presence of the field shows up only via the `record_count` figure.
- **High-cardinality string**: a field that doesn't pass the ≤ 20 distinct-values threshold falls into the "other" bucket and contributes nothing. Use `entity-extraction` or `coverage` for those.

## Bookshelf example

The default ingest already runs distribution; you don't need to ask for it.

```jsonc
analysis_ingest({
  analysis_id: "tour",
  model: "book",
  ingest_all: true,
  per_page: 50
  // summary_strategy omitted → "distribution"
})
```

Expected status text: `Stored 5000 record(s) (8 fields per record) across 100 page(s). Analysis: tour. Model: book.` Behind the scenes, 100 `page_summary:distribution` rows are written.

Recall one:

```jsonc
analysis_query({
  analysis_id: "tour",
  mode: "semantic",
  category: "page_summary:distribution",
  query: "rating distribution"
})
```

## See also

- [`coverage`](./coverage.md) — same field-level view but focused on null/empty rates.
- [`anomaly`](./anomaly.md) — opposite lens: what's unusual on this page rather than what's typical.
- [`temporal`](./temporal.md) — date-bucketed counts when the date range alone isn't enough.
- [Analysis Quickstart](../analysis-quickstart-guide.md) — the runnable tour.
- [Summary Strategies overview](../summary-strategies.md) — the contract and the registry.
