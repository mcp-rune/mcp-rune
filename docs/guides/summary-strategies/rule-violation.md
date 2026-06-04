# `rule-violation` strategy

Runs every `BusinessRule` whose `scope` includes the model **against every record on the page**, and reports per-rule pass/fail counts, severity, the first 10 failing record IDs, and up to 3 example failure messages.

The `finding` text is embedded as an `analysis_memories` row, so a later `analysis_query mode:"semantic"` for "rule failures about rating" surfaces this strategy's memory before any unrelated noise.

**Requires:** `['domainRegistry']`. No edges or embeddings.

At a glance — what the strategy reads, what it computes, what it writes:

<!-- illustration: summary-strategies#rule-violation -->

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│       INPUT        │    │     ALGORITHM      │    │       OUTPUT       │
├────────────────────┤    ├────────────────────┤    ├────────────────────┤
│ Records +          │    │ For each rule      │    │ rules[name]        │
│ DomainRegistry     │    │ scoping the model: │    │   passed / failed  │
│ rules              │    │                    │    │   severity         │
│                    │ ─▶ │  iterate records   │ ─▶ │   description      │
│ BusinessRules with │    │   rule.evaluate()  │    │   failed_ids[]     │
│ scope = [book]:    │    │   tally pass/fail  │    │     (cap 10)       │
│  completed-needs-  │    │   collect first 10 │    │   example_         │
│   rating (warning) │    │   failing IDs +    │    │     messages[]     │
│  needs-author      │    │   3 example msgs   │    │     (cap 3)        │
│   (error)          │    │                    │    │                    │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

The **left** panel is the page records plus every `BusinessRule` whose `scope` includes the model; the **middle** panel evaluates every rule against every record and tallies outcomes; the **right** panel keeps per-rule counts, severity, and the first 10 failing IDs — direct ammunition for `analysis_query mode:"filter" where:{id:[...]}`.

## When to pick

- Compliance and audit runs: every record is checked against every rule scoped to its model. Failures land in `metadata.rules[<name>].failed_ids` so the LLM can `analysis_query mode:"filter" where:{id:[...]}` straight to them.
- Workflow gap detection: a "completed but missing rating" rule, an "order with no shipping address" rule, etc.
- A reliable text-recall surface for failures: ask `analysis_query mode:"semantic" query:"rating workflow violations"` and you get the right page.

## Algorithm

1. Look up `rules = domainRegistry.rules.getRulesForModel(model)`.
2. If none (or `records` is empty), `appliesTo` returns `false`.
3. For each rule, iterate every record:
   - Call `rule.evaluate(record)`.
   - If `passed`, increment the rule's `passed` counter.
   - Otherwise, increment `failed`, append the record's `id` to `failed_ids` (cap 10), and store the result's `message` in `example_messages` (cap 3, deduplicated).
4. Pack per-rule stats as `{ passed, failed, severity, description, failed_ids, example_messages }` into `metadata.rules` keyed by rule name.

Source: [`src/core/summary-strategies/rule-violation.ts`](../../../src/core/summary-strategies/rule-violation.ts).

## Inputs consumed

- `input.records` — passed to `rule.evaluate(record)`.
- `input.domainRegistry.rules.getRulesForModel(model)` — must return the `BusinessRule` objects (compatible with `@mcp-rune/mcp-rune/domain`'s `BusinessRule` class).

## Output shape

```jsonc
{
  "finding": "Page 7/100 of book records (50 records). Business rules: completed-books-need-rating (warning): 3/50 failed (e.g. b127, b223, b418). books-need-author (error): 2/50 failed (e.g. b34, b48).",
  "metadata": {
    "page": 7,
    "model": "book",
    "record_count": 50,
    "rules": {
      "completed-books-need-rating": {
        "passed": 47,
        "failed": 3,
        "severity": "warning",
        "description": "A book marked as `completed` must carry a numeric `rating` (1-5).",
        "failed_ids": ["b127", "b223", "b418"],
        "example_messages": [
          "Completed book \"Layered Patterns #127\" is missing a rating.",
          "Completed book \"Pragmatic Workflows #223\" is missing a rating."
        ]
      },
      "books-need-author": {
        "passed": 48,
        "failed": 2,
        "severity": "error",
        "failed_ids": ["b34", "b48"],
        "example_messages": ["Book \"Resilient Models #34\" has no author."]
      }
    }
  }
}
```

When every rule passes, the per-rule line reads `<name>: passed (50/50)`.

## Edge cases

- **No rules scope the model**: `appliesTo` returns `false`. Re-run `analysis_summarize` with a different strategy or update your `DomainRegistry`.
- **Rule throws during evaluation**: the `BusinessRule.evaluate` wrapper catches throws and reports `passed: false` with the exception message. The strategy treats that as a regular failure.
- **`record.id` is null**: the failing record isn't named in `failed_ids` (we only append non-null IDs), but the count is still incremented and the message is still captured.
- **Async rules**: `BusinessRule.evaluate` is synchronous in the framework type, but the strategy itself is async-aware (it `await`s the result). Custom async rules work.
- **Examples deduplicate**: identical failure messages count toward the failure tally but appear in `example_messages` only once.

## Bookshelf example

The bookshelf ships two rules: `completed-books-need-rating` (warning) and `books-need-author` (error). The graph fixture deliberately leaves ~15% of completed books without a rating and ~5% of all books without an author, so this strategy reports real signal:

```jsonc
analysis_ingest({
  analysis_id: "tour-graph",
  model: "book",
  ingest_all: true,
  summary_strategies: ["rule-violation"]
})
```

Recall:

```jsonc
analysis_query({
  analysis_id: "tour-graph",
  mode: "semantic",
  category: "page_summary:rule-violation",
  query: "completed books missing rating"
})
```

The top finding lists the specific failing book IDs, ready for `analysis_query mode:"filter"`.

## See also

- [`concept-touch`](./concept-touch.md) — relationship-level coverage; pair with this for "the workflow holds together AND the rules pass".
- [Domain Knowledge Guide](../domain-knowledge-guide.md) — how to declare `BusinessRule`s.
- [Summary Strategies overview](../summary-strategies.md).
