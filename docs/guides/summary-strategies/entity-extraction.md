# `entity-extraction` strategy

Tallies **foreign-key references** on each page. For every `*_id` field other than the record's own `id`, the strategy counts how often each referenced value appears, and surfaces the top-N most-frequent references per field.

Field-shape heuristic (the field name must end in `_id`) — no schema lookup required.

At a glance — what the strategy reads, what it computes, what it writes:

<!-- illustration: summary-strategies#entity-extraction -->

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│       INPUT        │    │     ALGORITHM      │    │       OUTPUT       │
├────────────────────┤    ├────────────────────┤    ├────────────────────┤
│ Records with *_id  │    │ For each *_id      │    │ fields[name]       │
│ scalar fields      │    │ field (excluding   │    │   total_refs       │
│ (not 'id'):        │    │  'id' itself):     │    │   unique_refs      │
│                    │ ─▶ │                    │ ─▶ │   top: [           │
│  author_id: a-3    │    │   count per value  │    │     {id, count}    │
│  author_id: a-7    │    │   sort descending  │    │     × 5            │
│  genre_id:  g-sw   │    │   take top 5       │    │   ]                │
│  genre_id:  g-arch │    │                    │    │                    │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

The **left** panel is the scalar FK columns on a page; the **middle** panel runs a per-field tally; the **right** panel keeps total/unique counts plus the top-5 most-referenced IDs per field — the LLM's quickest read on "which targets dominate this page".

## When to pick

- A first look at how records hang together: "which authors are most common on this page?", "which genres dominate?".
- A lightweight, no-config alternative to `relationship-coverage`: this strategy reads only the `*_id` fields on the records themselves, so it works the moment data is ingested (no `hop_depth ≥ 0` required to populate the edges table).
- Pair with `relationship-coverage` when you have multi-hop ingest enabled — the two together cover both directions: `entity-extraction` shows the most-referenced targets per field; `relationship-coverage` shows the per-edge-type degree distribution.

## Algorithm

1. Find every field on the union of all records whose name is not `id` and ends in `_id`. Call this set `EntityFields`.
2. If `EntityFields` is empty, `appliesTo` returns `false` — the strategy skips.
3. For each field in `EntityFields`: count occurrences per value, sort descending, take the top **5**.
4. Pack per-field stats as `{ total_refs, unique_refs, top }` into `metadata.fields`.

Source: [`src/core/summary-strategies/entity-extraction.ts`](../../../src/core/summary-strategies/entity-extraction.ts).

## Inputs consumed

- `input.records` — only `*_id` fields (other than `id`).
- `appliesTo` returns `false` when no record carries any `*_id` field.
- No `edges`, `embeddings`, or `domainRegistry` required.

## Output shape

```jsonc
{
  "finding": "Page 1/100 of book records (50 records). Entities: author_id: 50 refs across 10 unique (top: a-3=8, a-7=7, a-1=6, a-5=5, a-9=5). genre_id: 50 refs across 6 unique (top: g-software=12, g-architecture=9, g-testing=8, g-management=7, g-databases=7).",
  "metadata": {
    "page": 1,
    "model": "book",
    "record_count": 50,
    "fields": {
      "author_id": {
        "total_refs": 50,
        "unique_refs": 10,
        "top": [
          { "id": "a-3", "count": 8 },
          { "id": "a-7", "count": 7 },
          …
        ]
      },
      "genre_id": { … }
    }
  }
}
```

## Edge cases

- **No `*_id` fields**: skipped via `appliesTo`. Use a custom strategy if your FKs follow a different naming convention.
- **`*_ids` arrays** (`hasMany`): **not detected**. The strategy looks at `*_id` (singular); `*_ids` arrays carry the wrong suffix. Use `relationship-coverage` for those.
- **Null references**: counted toward `record_count` but excluded from per-value counts.
- **Compound IDs**: a value like `titles/42/assets/7` is treated as a single string and tallied as-is.

## Bookshelf example

The bookshelf graph fixture seeds `genre_id` (6 distinct values) and `author_id` (10 distinct values) on every book.

```jsonc
analysis_summarize({
  analysis_id: "tour-graph",
  strategy: "entity-extraction",
  max_records: 5000
})
```

The finding text names the top-5 referenced author IDs per page; semantic recall:

```jsonc
analysis_query({
  analysis_id: "tour-graph",
  mode: "semantic",
  category: "page_summary:entity-extraction",
  query: "top authors"
})
```

## See also

- [`relationship-coverage`](./relationship-coverage.md) — per-edge-type coverage including `hasMany` arrays this strategy misses.
- [`concept-touch`](./concept-touch.md) — concept-level participation rather than per-field FK tallying.
- [`distribution`](./distribution.md) — applies the same enum-like analysis to non-`*_id` fields.
- [Summary Strategies overview](../summary-strategies.md).
