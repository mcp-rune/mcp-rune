# `temporal` strategy

Time-bucketed counts over the first ISO-date field on the page, with **gap detection** for empty buckets inside the observed span and a recency flag for the most-recent timestamp.

At a glance — what the strategy reads, what it computes, what it writes:

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│       INPUT        │    │     ALGORITHM      │    │       OUTPUT       │
├────────────────────┤    ├────────────────────┤    ├────────────────────┤
│ First ISO-date     │    │ Pick bucket size:  │    │ buckets[]          │
│ field on records:  │    │   span ≤ 14d  day  │    │   {start, count}   │
│  2024-01-04        │ ─▶ │   span ≤ 90d  week │ ─▶ │                    │
│  2024-02-11        │    │   else      month  │    │ gaps[]  (empty     │
│  (60-day gap)      │    │                    │    │   buckets inside   │
│  2024-10-22        │    │ Bucket + walk;     │    │   the span)        │
│  ...               │    │ flag empty buckets │    │ days_since_latest  │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

The **left** panel is a column of dates (here with a deliberate mid-span gap); the **middle** panel chooses a bucket granularity from the observed span and walks the buckets; the **right** panel surfaces the empty buckets so the LLM can spot ingestion gaps without scanning rows.

## When to pick

- Any dataset with an `*_at` / `*_date` field where cadence matters: ingest activity, sessions, events.
- Spotting **gaps** in the data — a 60-day window with zero records inside a span that has dense buckets on either side.
- A complement to `distribution` (which only reports earliest/latest) when you need to see the shape of the time series, not just its extent.

## Algorithm

1. Find the first field on the first record whose value parses as ISO 8601 (`/^\d{4}-\d{2}-\d{2}/`). Call it `dateField`.
2. If no such field exists, `appliesTo` returns `false` and the strategy skips.
3. Bucket all records by `dateField`. Bucket size is chosen automatically from the observed span:
   - **Day buckets** when span ≤ 14 days.
   - **Week buckets** when span ≤ 90 days.
   - **Month buckets** otherwise.
4. Walk the buckets in order; count occurrences; flag empty buckets between the first and last populated bucket as `gaps`.
5. Compute the recency window (days between the most-recent timestamp and now).

Source: [`src/core/summary-strategies/temporal.ts`](../../../src/core/summary-strategies/temporal.ts).

## Inputs consumed

- `input.records` — the first ISO-date field on the first record is the temporal axis.
- `appliesTo(input)` returns `false` when no record's first record contains an ISO-date-looking field. If your data has the date in a non-first field, the strategy will miss it — easy custom-strategy territory.

## Output shape

```jsonc
{
  "finding": "Page 1/100 of book records (50 records). Temporal field: created_at. Spans 2024-01-04 → 2025-12-30 (727 days, bucketed by month). 24 buckets, 2 gaps detected: [2024-08, 2024-09]. Recency: latest record 187 days ago.",
  "metadata": {
    "page": 1,
    "model": "book",
    "record_count": 50,
    "date_field": "created_at",
    "bucket": "month",
    "earliest": "2024-01-04T00:00:00.000Z",
    "latest":   "2025-12-30T00:00:00.000Z",
    "buckets": [
      { "start": "2024-01", "count": 3 },
      { "start": "2024-02", "count": 2 },
      …
    ],
    "gaps": ["2024-08", "2024-09"],
    "days_since_latest": 187
  }
}
```

## Edge cases

- **No ISO-date field**: skipped via `appliesTo`. No memory is stored.
- **All records on the same day**: span = 0, bucket = day, 1 bucket, no gaps. `days_since_latest` still reports correctly.
- **Unparseable date string**: the regex `^\d{4}-\d{2}-\d{2}/` matches the prefix; values without timezone or time-of-day still bucket correctly via `Date.parse`. Truly invalid strings (`"yesterday"`) cause that record to be silently skipped from the bucketing.
- **Page with very few records**: still produces buckets; the gap detector is still meaningful because it walks the observed bucket sequence regardless of count.

## Bookshelf example

The bookshelf generator spreads `created_at` over a 24-month window and bakes in a 60-day gap mid-span. After ingest:

```jsonc
analysis_summarize({
  analysis_id: "tour",
  strategy: "temporal",
  max_records: 5000
})
```

Then:

```jsonc
analysis_query({
  analysis_id: "tour",
  mode: "semantic",
  category: "page_summary:temporal",
  query: "ingest gap"
})
```

The top finding names the gap months — exactly the dates the generator left empty.

## See also

- [`distribution`](./distribution.md) — earliest/latest only, no buckets or gaps.
- [Proximity Sampling Guide](../proximity-sampling-guide.md) — when you've found a gap, this is how to spot-sample records around its edges.
- [`anomaly`](./anomaly.md) — a temporally-isolated record (only one in its bucket) can show up as a rare value indirectly.
- [Summary Strategies overview](../summary-strategies.md).
