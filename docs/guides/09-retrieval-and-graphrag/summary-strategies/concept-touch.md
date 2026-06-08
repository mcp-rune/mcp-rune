# `concept-touch` strategy

For each **`DomainConcept`** covering the model, reports the percentage of records that have **at least one edge** into each of the concept's _other_ models. A concept like `reading-pipeline` that spans `['book', 'genre', 'reading_session']` becomes a check: when this strategy runs over a page of `book` records, how many of them have ≥1 edge to a `genre` record, and how many to a `reading_session`?

This is the **domain-aware** counterpart to `relationship-coverage`. The latter reports raw edge-type coverage (was a `belongsTo:genre` edge persisted?); this one rolls those edges up by **concept membership** so you can see whether a cross-entity workflow is actually populated end-to-end.

**Requires:** `['edges', 'domainRegistry']`.

At a glance — what the strategy reads, what it computes, what it writes:

<!-- illustration: summary-strategies#concept-touch -->

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│       INPUT        │    │     ALGORITHM      │    │       OUTPUT       │
├────────────────────┤    ├────────────────────┤    ├────────────────────┤
│ Records + edges +  │    │ For each concept   │    │ concepts[name]     │
│ DomainRegistry     │    │ covering the model:│    │   touched / total  │
│                    │    │  targets =         │    │   target_models[]  │
│ Concept "catalogue"│ ─▶ │   concept.models   │ ─▶ │   touched_by_      │
│  = [book, author,  │    │   - { model }      │    │     target{model}  │
│      genre]        │    │  count records     │    │   missing_ids[]    │
│                    │    │  with ≥ 1 edge     │    │   (first 10 with   │
│                    │    │  into any target   │    │    no touch)       │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

The **left** panel supplies the page records plus the `DomainConcept` declaring which models belong together; the **middle** panel checks each record for ≥1 edge into the concept's other models; the **right** panel reports both the overall coverage and the per-target breakdown so you can see which side of the concept is sparse.

## When to pick

- Domain-level audits. When a `DomainConcept` declares "these N models hang together for purpose X", `concept-touch` measures how often that promise is kept.
- After a multi-hop ingest (`hop_depth ≥ 1`). The edges of interest must be in `ingested_edges`.
- Pair with `rule-violation`: concept coverage tells you which records are _connected_ to the rest of the graph; `rule-violation` tells you which records satisfy the formal constraints.

## Algorithm

1. Look up all `DomainConcept`s covering the model: `domainRegistry.knowledge.getConceptsForModel(model)`.
2. If none, `appliesTo` returns `false` — the strategy skips. Same if `edges` is absent.
3. Build a set of `recordIds` for the page.
4. Index the page's `edges` by `src_id` for fast per-record lookup.
5. For each concept:
   - `targets = concept.models - { model }` (the other models the concept spans).
   - For each record in the page, count the **distinct destination models** in `targets` that the record has at least one edge into.
   - `touched` = records with ≥1 such edge.
   - `touched_by_target[<dst_model>]` = records that have ≥1 edge into that specific target.
   - `missing_ids` = first 10 record IDs with zero edges into any of `targets`.

Source: [`src/core/summary-strategies/concept-touch.ts`](../../../../src/core/summary-strategies/concept-touch.ts).

## Inputs consumed

- `input.records` — only `id`.
- `input.edges` — populated by the dispatcher.
- `input.domainRegistry` — `knowledge.getConceptsForModel(model)` accessor.

## Output shape

```jsonc
{
  "finding": "Page 1/100 of book records (50 records). Concept touch: reading-pipeline → [genre]: 50/50 (100%); per-target genre=50. catalogue → [author, genre]: 47/50 (94%); per-target author=47, genre=50.",
  "metadata": {
    "page": 1,
    "model": "book",
    "record_count": 50,
    "concepts": {
      "reading-pipeline": {
        "touched": 50,
        "total": 50,
        "target_models": ["genre"],
        "touched_by_target": { "genre": 50 },
        "missing_ids": []
      },
      "catalogue": {
        "touched": 47,
        "total": 50,
        "target_models": ["author", "genre"],
        "touched_by_target": { "author": 47, "genre": 50 },
        "missing_ids": ["b18", "b34", "b41"]
      }
    }
  }
}
```

Note the difference between `reading-pipeline` and `catalogue` on the bookshelf: `reading-pipeline` only requires a `genre` edge (every book has one); `catalogue` requires _any_ edge to `author` or `genre`, but because a record without an `author_id` still has a `genre_id`, the `touched` count stays at 47 — the 3 records that lack an author also lack a genre? No — in the bookshelf fixture all books have genres; so the gap here is records that lack **author** specifically. The per-target breakdown disambiguates this: `touched_by_target.author = 47` means 3 books have no author edge, even though all 50 have a genre edge.

## Edge cases

- **No concepts cover the model**: `appliesTo` returns `false`.
- **Concept lists only the source model** (`models: ['book']`): the strategy iterates concepts but skips ones with empty `targets`. The finding text omits those concepts.
- **Edges with `dst_model` outside the concept's target list**: ignored. E.g., a `belongsTo:reviewer` edge is irrelevant to `reading-pipeline { models: ['book', 'genre'] }`.
- **Distinct vs. cumulative**: `touched` counts a record once even if it has multiple edges into multiple targets. `touched_by_target` is per-target — a record with edges to both `author` and `genre` increments both.

## Bookshelf example

The bookshelf domain registry ships two concepts: `reading-pipeline` and `catalogue`. After:

```jsonc
analysis_ingest({
  analysis_id: "tour-graph",
  model: "book",
  ingest_all: true,
  hop_depth: 1,
  summary_strategies: ["concept-touch"]
})
```

Recall by category:

```jsonc
analysis_query({
  analysis_id: "tour-graph",
  mode: "semantic",
  category: "page_summary:concept-touch",
  query: "catalogue gaps"
})
```

The top finding identifies the books that fail the `catalogue` concept (missing `author_id`). Combine with a sample query to inspect them:

```jsonc
analysis_query({
  mode: "sample", analysis_id: "tour-graph", sample_size: 5,
  stratifiers: [{ kind: "concept", concept: "catalogue" }],
  sample_model: "book"
})
```

The sample is balanced 50/50 between concept-touched and concept-gap records, regardless of how skewed the raw distribution is.

## See also

- [`relationship-coverage`](./relationship-coverage.md) — per-edge-type coverage; complementary domain-blind view.
- [`rule-violation`](./rule-violation.md) — formal constraint checks on the same domain registry.
- [Domain Knowledge Guide](../../08-domain-knowledge/domain-knowledge.md) — how `DomainConcept` and `DomainRegistry` work.
- [Summary Strategies overview](../summary-strategies.md).
