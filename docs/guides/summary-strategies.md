---
extension:
  kind: strategy
  what: Implement a custom summary strategy
---

# Summary Strategies

mcp-rune's `analysis_ingest` and `analysis_summarize` tools persist a **page summary** for every batch of records they process. The summary is embedded and recallable via `analysis_query mode: semantic` — it's the LLM's "starter pack" before any qualitative findings have been written.

A **summary strategy** decides _what_ that page summary contains. Different agents want different lenses: a data-quality audit wants coverage and anomalies; a relationship-mapping task wants entity crosswalks; a temporal investigation wants cadence and gaps. Rather than hard-code one shape, mcp-rune ships a small interface, five built-ins, and an extension point so hosts can register their own.

This guide covers:

- [The contract](#the-contract) — what a strategy is and how the framework calls it.
- [Built-ins](#built-ins) — the five strategies the framework ships with.
- [Choosing a strategy at call time](#choosing-a-strategy-at-call-time) — how the LLM picks.
- [Authoring a custom strategy](#authoring-a-custom-strategy) — full TypeScript walkthrough.
- [Category scheme and semantic recall](#category-scheme-and-semantic-recall) — how the stored memories are organized.

For the broader analysis-tool family, see [Analysis Memories Guide](./analysis-memories-guide.md). For how to register your strategy through an `ApiExtension`, see [API Extensions](./api-extensions.md).

## The contract

A strategy is a deterministic pure function over a page of records.

```ts file=src/summary-input.ts
export interface SummaryInput {
  analysisId: string
  model: string
  page: number
  totalPages: number | null
  records: ReadonlyArray<Record<string, unknown>>
  fields?: ReadonlyArray<string>
  options?: Readonly<Record<string, unknown>>
}

export interface SummaryOutput {
  finding: string // embedded as the memory row text
  metadata: Record<string, unknown> // stored alongside
  category?: string // defaults to `page_summary:<strategy.name>`
}

export interface SummaryStrategy {
  readonly name: string // lowercase kebab-case, globally unique
  readonly description: string // one-line LLM-facing hint
  appliesTo?(input: SummaryInput): boolean // optional gate; omit = always applies
  generate(input: SummaryInput): SummaryOutput | Promise<SummaryOutput>
}
```

```js file=src/summary-input.js
/**
 * What the framework hands to a SummaryStrategy when it asks for a
 * per-page summary during `analysis_ingest`.
 *
 * @typedef {Object} SummaryInput
 * @property {string} analysisId
 * @property {string} model
 * @property {number} page
 * @property {number | null} totalPages
 * @property {ReadonlyArray<Object>} records
 * @property {ReadonlyArray<string>} [fields]
 * @property {Readonly<Object>} [options]
 */

/**
 * What a SummaryStrategy returns. `finding` is embedded as the memory
 * row's searchable text; `metadata` is stored alongside.
 *
 * @typedef {Object} SummaryOutput
 * @property {string} finding
 * @property {Object} metadata
 * @property {string} [category]   defaults to `page_summary:<strategy.name>`
 */

/**
 * A pluggable strategy contributed via an ApiExtension. Globally
 * registered (single `name` namespace); strategies opt-in to specific
 * pages via `appliesTo`.
 *
 * @typedef {Object} SummaryStrategy
 * @property {string} name                       lowercase kebab-case, globally unique
 * @property {string} description                one-line LLM-facing hint
 * @property {(input: SummaryInput) => boolean} [appliesTo]  optional gate; omit = always applies
 * @property {(input: SummaryInput) => SummaryOutput | Promise<SummaryOutput>} generate
 */
```

**Guarantees the framework gives you:**

- Strategies are deterministic — same input, same output. No LLM calls inside `generate()`, no network, no clock-dependent behavior. (If you need probabilistic output, take a seed via `options`.)
- `records` is the already-flattened, field-picked array — what the LLM would see if it queried `analysis_query mode: sample` over the same page.
- `appliesTo(input)` returning `false` silently skips the strategy: no memory is stored, no error is raised. Use it to gate on data-shape preconditions (e.g. "I need at least one ISO-date field"). Omitting `appliesTo` means the strategy always applies.
- Names are globally unique across built-ins and all extensions. Collisions throw at boot with both owner keys in the error message.

**What strategies must not do:**

- Call an LLM, fetch over the network, read from disk, or talk to a database. The strategy runs inside the `analysis_ingest` page loop and inside `analysis_summarize` — both contexts expect fast, deterministic work.
- Mutate the input records. `records` is typed `ReadonlyArray`; treat it that way.
- Throw to signal "doesn't apply". Use `appliesTo` for that. Throwing aborts the page's ingest and surfaces to the LLM as a tool error.

## Built-ins

Nine strategies ship with the framework. `distribution` is the default; the rest are picked by the LLM via `summary_strategy` / `summary_strategies`, or run after the fact via `analysis_summarize`. The four GraphRAG-aware strategies (`relationship-coverage`, `concept-touch`, `rule-violation`, `semantic-cluster`) require auxiliary data the dispatcher loads lazily based on each strategy's `requires` declaration.

### Field-level strategies

| Name                                                             | Always applies?    | Requires | Guide                                                      |
| ---------------------------------------------------------------- | ------------------ | -------- | ---------------------------------------------------------- |
| [`distribution`](./summary-strategies/distribution.md)           | Yes                | —        | Per-field value distributions, numeric stats, date ranges. |
| [`coverage`](./summary-strategies/coverage.md)                   | Yes                | —        | Null/empty rate per field; flags fields above 50% missing. |
| [`anomaly`](./summary-strategies/anomaly.md)                     | ≥ 4 records        | —        | Numeric z-score outliers and rare enum values.             |
| [`temporal`](./summary-strategies/temporal.md)                   | ≥ 1 ISO-date field | —        | Time-bucketed counts, gap detection, recency.              |
| [`entity-extraction`](./summary-strategies/entity-extraction.md) | ≥ 1 `*_id` field   | —        | Top-N references per `*_id` field.                         |

### GraphRAG-aware strategies

These read from the relationship graph and embeddings that `analysis_ingest` populates when run with `hop_depth ≥ 1` and `embed_records: true`.

| Name                                                                     | Requires                      | Guide                                                     |
| ------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------- |
| [`relationship-coverage`](./summary-strategies/relationship-coverage.md) | `['edges']`                   | Per-edge-type coverage %, degree stats, gap-records list. |
| [`concept-touch`](./summary-strategies/concept-touch.md)                 | `['edges', 'domainRegistry']` | Per-concept participation %, per-target-model breakdown.  |
| [`rule-violation`](./summary-strategies/rule-violation.md)               | `['domainRegistry']`          | Per-`BusinessRule` pass/fail counts + failing IDs.        |
| [`semantic-cluster`](./summary-strategies/semantic-cluster.md)           | `['embeddings']`              | Anchor-nearest clustering, sizes + representatives.       |

Each strategy's `description` is what the LLM sees when picking — they're tuned for one-shot disambiguation. The per-strategy guides above include real bookshelf output and edge-case notes; the [Analysis Quickstart](./analysis-quickstart-guide.md) walks all nine end to end against a runnable example.

If you find the LLM consistently picking the wrong strategy for your domain, ship a custom one with a sharper `description`.

## Choosing a strategy at call time

Two LLM-facing surfaces let the model pick. For a worked Inspector recipe per built-in strategy against a 5,000-record dataset, see the [Analysis Quickstart](./analysis-quickstart-guide.md).

### At ingest time

```jsonc
analysis_ingest({
  model: "scheduling",
  analysis_id: "q1-audit",
  ingest_all: true,
  summary_strategy: "anomaly"      // or omit for the "distribution" default
})
```

Or run several lenses per page in one call:

```jsonc
analysis_ingest({
  model: "scheduling",
  analysis_id: "q1-audit",
  ingest_all: true,
  summary_strategies: ["distribution", "anomaly", "temporal"]
})
```

Each strategy that passes its `appliesTo` check writes one memory per page. If you pass both `summary_strategy` and `summary_strategies` you get a validation error — they're mutually exclusive.

### After the fact (no refetch)

```jsonc
analysis_summarize({
  analysis_id: "q1-audit",
  strategies: ["anomaly", "entity-extraction"],
  where: { status: "invalid" },     // optional — scope to a subset
  max_records: 500
})
```

Use this when you ingested with the default `distribution`, looked at the results, and now want a different lens over data already in storage. No API round-trip, just a fresh strategy pass over the existing rows.

## Authoring a custom strategy

```ts file=src/count-by.ts
import type {
  SummaryStrategy,
  SummaryInput,
  SummaryOutput
} from '@mcp-rune/mcp-rune/api-extensions'

export const dealNarrativeStrategy: SummaryStrategy = {
  name: 'deal-narrative',
  description:
    'One-paragraph prose summary of a deal page: pipeline mix, total dollar value, ' +
    'top owners. Pick this when preparing a status report.',

  // Only run when the page looks like deals.
  appliesTo(input: SummaryInput): boolean {
    return input.model === 'deal' && input.records.length > 0
  },

  generate(input: SummaryInput): SummaryOutput {
    const total = input.records.length
    const totalValue = input.records.reduce(
      (acc, r) => acc + (typeof r.amount === 'number' ? r.amount : 0),
      0
    )
    const byStage = countBy(input.records, 'stage')
    const topStage = topEntry(byStage)
    const ownerCounts = countBy(input.records, 'owner_id')
    const topOwner = topEntry(ownerCounts)

    return {
      finding:
        `Page ${input.page}: ${total} deals worth $${totalValue.toLocaleString()}. ` +
        `Stage mix favors ${topStage.key} (${topStage.count}/${total}). ` +
        `Top owner ${topOwner.key} carries ${topOwner.count} deals.`,
      metadata: {
        page: input.page,
        total_value: totalValue,
        by_stage: byStage,
        owner_counts: ownerCounts
      }
    }
  }
}

function countBy(records: ReadonlyArray<Record<string, unknown>>, field: string) {
  const out: Record<string, number> = {}
  for (const r of records) {
    const v = r[field]
    if (v === null || v === undefined) continue
    const key = String(v)
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

function topEntry(counts: Record<string, number>) {
  const [key, count] = Object.entries(counts).sort(([, a], [, b]) => b - a)[0] ?? ['—', 0]
  return { key, count }
}
```

```js file=src/count-by.js
export const dealNarrativeStrategy = {
  name: 'deal-narrative',
  description:
    'One-paragraph prose summary of a deal page: pipeline mix, total dollar value, ' +
    'top owners. Pick this when preparing a status report.',
  // Only run when the page looks like deals.
  appliesTo(input) {
    return input.model === 'deal' && input.records.length > 0
  },
  generate(input) {
    const total = input.records.length
    const totalValue = input.records.reduce(
      (acc, r) => acc + (typeof r.amount === 'number' ? r.amount : 0),
      0
    )
    const byStage = countBy(input.records, 'stage')
    const topStage = topEntry(byStage)
    const ownerCounts = countBy(input.records, 'owner_id')
    const topOwner = topEntry(ownerCounts)
    return {
      finding:
        `Page ${input.page}: ${total} deals worth $${totalValue.toLocaleString()}. ` +
        `Stage mix favors ${topStage.key} (${topStage.count}/${total}). ` +
        `Top owner ${topOwner.key} carries ${topOwner.count} deals.`,
      metadata: {
        page: input.page,
        total_value: totalValue,
        by_stage: byStage,
        owner_counts: ownerCounts
      }
    }
  }
}
function countBy(records, field) {
  const out = {}
  for (const r of records) {
    const v = r[field]
    if (v === null || v === undefined) continue
    const key = String(v)
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}
function topEntry(counts) {
  const [key, count] = Object.entries(counts).sort(([, a], [, b]) => b - a)[0] ?? ['—', 0]
  return { key, count }
}
```

Register it on `ToolRegistry` via an `ApiExtension`:

```ts file=examples/summary-strategies-03.ts
import { dealNarrativeStrategy } from './deal-narrative-strategy.js'

const salesExtension: ApiExtension = {
  register(ctx) {
    ctx.registerSummaryStrategy(dealNarrativeStrategy)
  }
}

new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  apiExtensions: { sales: salesExtension }
})
```

```js file=examples/summary-strategies-03.js
import { dealNarrativeStrategy } from './deal-narrative-strategy.js'
const salesExtension = {
  register(ctx) {
    ctx.registerSummaryStrategy(dealNarrativeStrategy)
  }
}
new ToolRegistry({
  toolClasses: DATA_TOOL_CLASSES,
  models: MODEL_CLASSES,
  apiExtensions: { sales: salesExtension }
})
```

Once registered, `deal-narrative` automatically:

- Appears in the `summary_strategy` / `summary_strategies` enums on `analysis_ingest` and on `strategy` / `strategies` for `analysis_summarize`.
- Shows up in the LLM-facing parameter description (one line per strategy, sourced from each strategy's `description`).
- Becomes recallable via `analysis_query mode: semantic, category: 'page_summary:deal-narrative'` once it has produced a memory.

There is no "register many" form on purpose: one strategy per `registerSummaryStrategy()` call. Real extensions usually own one or two strategies; bundling more than that is a signal to split the extension.

## Category scheme and semantic recall

Every memory produced by a strategy is written with:

- **`category`**: `page_summary:<strategy.name>` (e.g. `page_summary:distribution`, `page_summary:deal-narrative`). Strategies may override this by returning `category` on their `SummaryOutput`, but the default is a deliberate, predictable scheme that lets `analysis_query` filter cleanly.
- **`metadata.strategy`**: the strategy name, redundantly stored on metadata so SQL/JSONB filters can be built against either column.
- **`metadata.source`** (only when written by `analysis_summarize`): the literal string `"analysis_summarize"`, distinguishing post-hoc re-summarizations from per-page ingest summaries.

Recall examples:

```jsonc
// Just the anomaly findings:
analysis_query({
  analysis_id: "q1-audit",
  mode: "semantic",
  category: "page_summary:anomaly"
})

// Anything related to "missing metadata", across all strategies:
analysis_query({
  analysis_id: "q1-audit",
  mode: "semantic",
  query: "missing metadata"
})
```

This is the payoff of the per-strategy category: an LLM can query for "anomaly memories about this dataset" without semantic-ranking competing strategies' summaries against each other.

## See also

- [Analysis Memories Guide](./analysis-memories-guide.md) — the broader `analysis_*` tool family.
- [API Extensions](./api-extensions.md) — the `ApiExtensionContext` collectors, including `registerSummaryStrategy`.
- [Authoring Extensions Guide](./authoring-extensions-guide.md) — step-by-step walkthrough for shipping an extension.
