# Proximity Sampling Guide

> Sub-topic of the [Analysis Memories](./analysis-memories.md) feature.

Date-windowed, bucket-stratified sampling for the `analysis_query` tool. Enables temporal proximity analysis when investigating data quality issues around specific dates.

---

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Core Concepts](#2-core-concepts)
  - [2.1 Proximity Window](#21-proximity-window)
  - [2.2 Temporal Bucketing](#22-temporal-bucketing)
  - [2.3 Composite Stratification](#23-composite-stratification)
- [3. Full Flow Walkthrough](#3-full-flow-walkthrough)
- [4. Parameter Reference](#4-parameter-reference)
- [5. SQL Mechanics](#5-sql-mechanics)
  - [5.1 The CTE Pipeline](#51-the-cte-pipeline)
  - [5.2 date_bin() and Origin-Anchored Buckets](#52-date_bin-and-origin-anchored-buckets)
  - [5.3 Per-Bucket Budget Allocation](#53-per-bucket-budget-allocation)
- [6. Examples](#6-examples)
  - [6.1 Missing Attribute Around a Date](#61-missing-attribute-around-a-date)
  - [6.2 Spike Detection](#62-spike-detection)
  - [6.3 Time-Bucketed Audit](#63-time-bucketed-audit)
  - [6.4 Composite: Status x Week](#64-composite-status-x-week)
- [7. Edge Cases](#7-edge-cases)
- [8. File Reference](#8-file-reference)

---

## 1. Problem Statement

Issue #28 introduced `stratify_by` to ensure minority groups appear in random samples. However, stratification by discrete field values doesn't address a common data quality investigation pattern: **"I found an anomaly — show me representative records around a specific date."**

Two gaps existed:

1. **No filter+sample composition.** The `filter` and `sample` modes were mutually exclusive. To get a filtered sample, the LLM had to run a filter query and hope the limited results were representative, or manually combine two calls.

2. **No temporal bucketing.** `stratify_by` partitions by discrete values (e.g., `status: "active"/"draft"`). It cannot partition by date ranges — meaning a sample of 10 records "around March 15th" would cluster around the densest day rather than spreading evenly across the window.

Proximity sampling solves both by extending sample mode with `where` (pre-filter) and `proximity` (date-windowed bucket stratification).

---

## 2. Core Concepts

### 2.1 Proximity Window

A proximity window defines a date-centered region of interest:

```
origin: "2026-03-15"
window: "7 days"

Timeline: [Mar 8] ←--- 7 days ---→ [Mar 15] ←--- 7 days ---→ [Mar 22]
```

The window extends symmetrically in both directions from the origin. Records with a date field value within this range are included in the sample pool.

### 2.2 Temporal Bucketing

Without bucketing, a proximity window returns a uniform random sample. If most records cluster on March 10th, you'll mostly see March 10th records.

With a `bucket` interval, the window is divided into equal-width time bins:

```
origin: "2026-03-15", window: "7 days", bucket: "1 day"

Buckets: [Mar 8] [Mar 9] [Mar 10] ... [Mar 21] [Mar 22]
                                         ↑ origin-anchored
```

Each bucket gets an equal share of sample slots, using the same `CEIL(sampleSize / numBuckets)` budget allocation as discrete `stratify_by`. This guarantees temporal spread — even if 90% of records are on March 10th, other days still appear in the sample.

Buckets are **origin-anchored** via PostgreSQL's `date_bin()` function. This means bucket boundaries align with the origin date, not arbitrary calendar boundaries.

### 2.3 Composite Stratification

When both `proximity.bucket` and `stratify_by` are provided, the partition key becomes a composite of the discrete field and the date bucket:

```
PARTITION BY (date_bin('1 week', created_at, origin), data->>'status')
```

This produces a cross-tabulation: one sample slot per (status × week) combination. With 3 statuses and 4 weekly buckets, a sample of 12 would yield 1 record per cell.

---

## 3. Full Flow Walkthrough

A typical LLM investigation using proximity sampling:

### Step 1: Ingest records

```json
{
  "tool": "analysis_ingest",
  "args": {
    "model": "episodes",
    "analysis_id": "audit-episodes-2026",
    "ingest_all": true
  }
}
```

### Step 2: Discover schema

```json
{
  "tool": "analysis_query",
  "args": {
    "analysis_id": "audit-episodes-2026",
    "mode": "describe"
  }
}
```

Response reveals fields, types, and now includes a **Proximity sampling** section for date fields.

### Step 3: Identify anomaly

```json
{
  "tool": "analysis_query",
  "args": {
    "analysis_id": "audit-episodes-2026",
    "mode": "aggregate",
    "group_by": "synopsis"
  }
}
```

LLM discovers 47 records with `null` synopsis.

### Step 4: Investigate when nulls cluster

```json
{
  "tool": "analysis_query",
  "args": {
    "analysis_id": "audit-episodes-2026",
    "mode": "filter",
    "where": { "synopsis": null },
    "limit": 5
  }
}
```

LLM notices the first few results are all from around March 2026.

### Step 5: Pull proximity sample

```json
{
  "tool": "analysis_query",
  "args": {
    "analysis_id": "audit-episodes-2026",
    "mode": "sample",
    "sample_size": 10,
    "where": { "synopsis": null },
    "proximity": {
      "field": "created_at",
      "origin": "2026-03-15",
      "window": "14 days",
      "bucket": "1 day"
    }
  }
}
```

Returns 10 records with null synopsis, distributed evenly across daily buckets within 14 days of March 15th. The LLM can now determine whether the issue is a one-time import problem or an ongoing pattern.

---

## 4. Parameter Reference

All parameters are passed to `analysis_query` with `mode: "sample"`.

| Parameter     | Type   | Default | Description                                                                                                                             |
| ------------- | ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `sample_size` | number | 5       | Maximum records to return (max: 50)                                                                                                     |
| `stratify_by` | string | —       | Discrete field for stratification (e.g., `"status"`)                                                                                    |
| `where`       | object | —       | Pre-filter conditions. Same syntax as filter mode: exact match (`{"status": "active"}`), range operators (`{"duration": {"$gte": 40}}`) |
| `proximity`   | object | —       | Date-windowed sampling (see below)                                                                                                      |

### `proximity` object

| Field    | Type   | Required | Description                                                               |
| -------- | ------ | -------- | ------------------------------------------------------------------------- |
| `field`  | string | Yes      | Date/datetime field to center on (e.g., `"created_at"`)                   |
| `origin` | string | Yes      | Center date in ISO 8601 format (e.g., `"2026-03-15"`)                     |
| `window` | string | Yes      | Symmetric window width (e.g., `"7 days"`, `"2 weeks"`, `"1 month"`)       |
| `bucket` | string | No       | Bucket interval for temporal stratification (e.g., `"1 day"`, `"1 week"`) |

### Composition rules

| `where` | `proximity`         | `stratify_by` | Behavior                                                  |
| ------- | ------------------- | ------------- | --------------------------------------------------------- |
| —       | —                   | —             | Uniform random sample                                     |
| —       | —                   | `"status"`    | Discrete stratified sample (existing behavior)            |
| `{...}` | —                   | —             | Pre-filtered random sample                                |
| —       | `{..., bucket}`     | —             | Date-windowed bucket-stratified sample                    |
| `{...}` | `{..., bucket}`     | —             | Pre-filtered + date-windowed + bucket-stratified          |
| `{...}` | `{..., bucket}`     | `"status"`    | Pre-filtered + composite (status × bucket) stratification |
| —       | `{...}` (no bucket) | —             | Date-windowed uniform random sample                       |

---

## 5. SQL Mechanics

### 5.1 The CTE Pipeline

The query is structured as a three-stage CTE pipeline, consistent with the existing `querySampleStratified` approach:

```sql
WITH
  filtered AS (
    -- Stage 1: Base conditions + where + proximity date range
    SELECT data FROM ingested_records
    WHERE analysis_id = $1
      AND (expires_at IS NULL OR expires_at > NOW())
      AND data @> $2                          -- where: exact match
      AND (data->>'field')::numeric >= $3     -- where: range operators
      AND (data->>'created_at')::timestamptz >= ($4::timestamptz - '7 days'::interval)
      AND (data->>'created_at')::timestamptz <= ($5::timestamptz + '7 days'::interval)
  ),
  ranked AS (
    -- Stage 2: Assign random rank within each bucket/group
    SELECT data,
      ROW_NUMBER() OVER (
        PARTITION BY date_bin('1 day'::interval, (data->>'created_at')::timestamptz, $6::timestamptz)
        ORDER BY RANDOM()
      ) AS rn
    FROM filtered
  ),
  group_count AS (
    -- Stage 3: Count distinct buckets for budget calculation
    SELECT COUNT(DISTINCT date_bin('1 day'::interval, (data->>'created_at')::timestamptz, $6::timestamptz))
      AS num_groups
    FROM filtered
  )
SELECT ranked.data
FROM ranked, group_count
WHERE ranked.rn <= GREATEST(1, CEIL($7::numeric / GREATEST(1, group_count.num_groups)))
ORDER BY RANDOM()
LIMIT $7
```

### 5.2 date_bin() and Origin-Anchored Buckets

PostgreSQL's `date_bin(interval, timestamp, origin)` assigns each timestamp to a bin of the given width, anchored at the origin:

```
date_bin('1 day', '2026-03-14 10:30', '2026-03-15')
  → '2026-03-14 00:00'

date_bin('1 week', '2026-03-10', '2026-03-15')
  → '2026-03-08 00:00'  (one week before origin)
```

This is superior to `DATE_TRUNC` because bins align with the investigation target (the origin) rather than arbitrary calendar boundaries (Monday, first-of-month, etc.).

**Requirement:** PostgreSQL 14 or later.

### 5.3 Per-Bucket Budget Allocation

The budget formula is identical to discrete stratification:

```
per_bucket_budget = CEIL(sampleSize / numBuckets)
```

With `sampleSize=10` and 14 daily buckets (7 days × 2 directions):

- If all 14 buckets have data: `CEIL(10/14) = 1` per bucket → 14 candidates, `LIMIT 10` trims to 10
- If only 5 buckets have data: `CEIL(10/5) = 2` per bucket → 10 candidates, all returned
- Empty buckets are never counted — `COUNT(DISTINCT date_bin(...))` only counts buckets that have records

`GREATEST(1, ...)` ensures at least 1 record per bucket and prevents division by zero.

---

## 6. Examples

### 6.1 Missing Attribute Around a Date

> "Show me records with null synopsis around March 15th, spread across days."

```json
{
  "analysis_id": "audit-2026",
  "mode": "sample",
  "sample_size": 10,
  "where": { "synopsis": null },
  "proximity": {
    "field": "created_at",
    "origin": "2026-03-15",
    "window": "7 days",
    "bucket": "1 day"
  }
}
```

### 6.2 Spike Detection

> "I see a spike in short-duration records around January. Sample to investigate."

```json
{
  "analysis_id": "audit-2026",
  "mode": "sample",
  "sample_size": 15,
  "where": { "duration_minutes": { "$lte": 5 } },
  "proximity": {
    "field": "published_at",
    "origin": "2026-01-15",
    "window": "1 month",
    "bucket": "1 week"
  }
}
```

### 6.3 Time-Bucketed Audit

> "Get a time-spread sample of all records around Q1 end, no specific filter."

```json
{
  "analysis_id": "audit-2026",
  "mode": "sample",
  "sample_size": 20,
  "proximity": {
    "field": "created_at",
    "origin": "2026-03-31",
    "window": "2 weeks",
    "bucket": "1 day"
  }
}
```

### 6.4 Composite: Status x Week

> "Sample records around March 15th, stratified by both status and week."

```json
{
  "analysis_id": "audit-2026",
  "mode": "sample",
  "sample_size": 12,
  "stratify_by": "status",
  "proximity": {
    "field": "created_at",
    "origin": "2026-03-15",
    "window": "14 days",
    "bucket": "1 week"
  }
}
```

With 3 statuses and 4 weekly buckets → 12 composite groups → 1 record each.

---

## 7. Edge Cases

| Scenario                                                                             | Behavior                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Empty window** — no records within the proximity range                             | Returns `[]` (empty result)                                                               |
| **Null date values** — records where the date field is null                          | Excluded by the `::timestamptz` cast (null comparisons are false)                         |
| **More buckets than sample_size** — e.g., 14 daily buckets, sample_size=5            | Budget = `CEIL(5/14) = 1` per bucket → 14 candidates, `LIMIT 5` returns 5 random buckets  |
| **Single bucket with all data** — all records in one day                             | Budget = `CEIL(10/1) = 10` from that bucket — degrades gracefully to random within bucket |
| **Composite with sparse cells** — many (status × bucket) combinations with 0 records | Only populated cells count in `num_groups`; empty cells are invisible                     |
| **Invalid interval** — e.g., `"1; DROP TABLE"`                                       | Rejected by `validateInterval()` regex whitelist before reaching SQL                      |
| **Invalid field name** — e.g., `"created_at; --"`                                    | Rejected by `sanitizeFieldName()` alphanumeric whitelist                                  |

---

## 8. File Reference

| File                                                              | Role                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/services/vendor/pgvector/ingested-records.ts`                | Core SQL: `querySampleFiltered`, `buildWhereConditions`, `validateInterval`, `ProximityParams` type |
| `src/mcp/tools/analysis/analysis-query-tool.ts`                   | Tool schema: `proximity` parameter, `where` in sample mode, updated `_queryDescribe` output         |
| `src/services/vector-storage.ts`                                  | Facade: `IngestedDataQuery` type with `where` and `proximity` on sample variant                     |
| `__tests__/lib/services/vendor/pgvector/ingested-records.spec.ts` | SQL-level tests: filtered sample, proximity window, bucket stratification, composite, validation    |
| `__tests__/lib/mcp/tools/analysis/analysis-memory-tools.spec.ts`  | Tool-level tests: parameter pass-through for `where`, `proximity`, and composition                  |
