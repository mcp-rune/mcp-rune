# 0013. Sessions are graphs of models; analyses are per-model projections

- Status: Accepted
- Date: 2026-07-03
- Related: #348, #363, [ADR-0002](0002-deterministic-community-summarization.md)

## Context

Multi-hop ingestion deliberately stores destination-model records under the same `analysis_id` — that is the feature: one session holds the typed neighborhood of the ingested root, and the edge graph over it is what path queries and community work (ADR 0002) will consume. But every shape-sensitive query path assumed one model per session: `describeSession` picked an arbitrary model (`GROUP BY model LIMIT 1`, no ORDER BY), aggregate/filter/sample mixed record shapes across models, the concept/edge stratifier CTEs joined `src_id` without `src_model` so numerically-colliding IDs cross-matched, and `analysis_summarize` resolved "the session's model" nondeterministically. The moment hop expansion made a session interesting, every statistic over it degraded silently. A second, quieter defect rode along: the stratifier CTE builders hard-coded `$1` as the analysis-id placeholder — an implicit contract with the one caller that happened to bind analysis-id first.

## Decision

**A session is a graph of models; every shape-sensitive analysis operates on exactly one model at a time.**

- **Aggregate, filter, sample, and summarize take an optional `model` scope.** A single-model session resolves automatically (the common case changes nothing); a multi-model session with no explicit scope **errors, naming the candidates with their counts** — silently mixing record shapes is never an answer, and a wrong-but-plausible statistic is worse than an actionable error.
- **Resolution is enforced in the adapter** (`resolveModelScope` inside `queryRecords`), not per-tool — every caller of the query path inherits the rule; an explicitly requested model absent from the session errors the same way.
- **`describeSession` describes the graph**: every model with its live record count, ordered by count then name, plus the total. `analysis_query mode:"describe"` lists all models and states the scoping requirement; field documentation renders for the dominant model.
- **The stratifier `filtered` CTE carries `model`**, and edge-join fragments scope by `src_model = f.model`, closing the cross-model ID collision.
- **`ParamRef` carries `analysisIdParam` explicitly** — builders no longer assume a parameter position they don't control.

## Options considered

**Sessions are one model; hop records go to separate sessions — rejected.** It would un-build the feature: edges spanning sessions cannot be joined, and the graph substrate ADR 0002 depends on disappears.

**Default multi-model queries to the "root" model — rejected.** Records carry no root marker, and inferring the root from insertion timestamps or edge topology is heuristics dressed as semantics. Requiring an explicit scope is deterministic, and the error message hands the caller exactly the list it needs.

**Cross-model aggregates (query all shapes together) — rejected as a default.** Aggregating a JSONB field across models with different schemas produces numbers that look meaningful and aren't. If a genuine cross-model statistic is ever wanted, it should be an explicit, named capability — not the accidental behavior of an unscoped query.

**Per-tool resolution — rejected.** Three tools would re-implement the same rule and drift; the adapter is the single chokepoint every query already passes through.

## Consequences

- BREAKING: `SessionDescriptor` becomes `{ models: [{ model, count }], totalRecords }`; multi-model sessions error on unscoped shape-sensitive queries; the query tool's `sample_model` parameter is generalized to `model`.
- The calling LLM's loop is self-healing: the error names the models, `describe` lists them, and the retry carries `model`.
- Path queries and community summarization (epic tasks 25 / ADR 0002) inherit a sound substrate: model-scoped statistics plus a cross-model edge graph.
- The `hop_follow: 'none'` single-model workflow is entirely unaffected.
