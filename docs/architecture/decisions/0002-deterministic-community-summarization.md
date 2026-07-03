# 0002. Community summarization: adopt the deterministic shape, defer the implementation

- Status: Accepted — implementation deferred
- Date: 2026-07-03
- Related: #348, [ADR-0001](0001-llm-synthesis-stays-client-side.md), [ADR-0007](0007-summary-strategy-determinism-contract.md)

## Context

GraphRAG-style "global search" answers holistic questions over a whole corpus by detecting communities in an entity graph, summarizing each community, and letting an LLM map-reduce over the community summaries. mcp-rune already holds most of the substrate: an **exact, typed** edge graph derived from model declarations at zero LLM cost (`belongsTo:`/`hasMany:`/`fk:` edges in `ingested_edges`, indexed in both directions), graph stratifiers, deterministic page-summary strategies, and a documented client-side map-reduce pattern over `analysis_memories`. What is missing is the community layer: today's summary units are ingestion pages, not graph neighborhoods, so holistic answers degrade to page-by-page composition.

## Decision

Community summarization is a wanted capability, and its shape is fixed now so the eventual implementation does not drift into the patterns we rejected:

1. **Community detection is deterministic**: seeded label propagation or Leiden with a fixed seed and stable tie-breaking over sorted node IDs, implemented as a graph-stratifier family over `ingested_edges` — the same seam the concept/edge/cluster stratifiers occupy.
2. **Per-community summaries reuse the existing `SummaryStrategy` registry**: each community is a stratum; its summaries persist as `analysis_memories` rows under a category of the shape `community_summary:<strategy>`, making them recallable through the existing semantic query path with no new storage taxonomy.
3. **Global synthesis stays client-side** per [ADR-0001]: the calling LLM map-reduces over community summaries exactly as it does over page summaries today.

Implementation is deferred: no consumer currently asks holistic-corpus questions, and community invalidation on re-ingest (edges change → communities change → summaries stale) is an open design question that deserves its own analysis when the work starts.

## Options considered

**LLM-extracted entity graph (the canonical GraphRAG indexing step) — rejected.** The model-driven exact graph is the framework's structural differentiator: typed edges from schema declarations, deterministic, free to re-index. LLM extraction would re-introduce precisely the noise, cost, and nondeterminism the framework's design avoids, to reconstruct information the models already declare.

**Non-deterministic community detection (stock Leiden/Louvain with random seeds) — rejected.** Breaks the strategy determinism contract ([ADR-0007]) and makes analyses unreproducible across runs — the same corpus must always yield the same communities and the same summaries.

**Seeded deterministic detection as a stratifier family (chosen shape).** Fits the existing seam, keeps the contract, and composes with the summary registry instead of forking a parallel pipeline.

## Consequences

- Multi-model session semantics (epic #348 task 10) must land first — hop-expanded sessions mix models under one `analysis_id`, and community detection over that graph inherits every ambiguity task 10 resolves.
- Record-level semantic search and path queries (tasks 24/25) are cheaper wins over the same substrate and should land earlier.
- Promotion to an epic checklist task waits for a consumer with a real holistic-question workload; this record is the design head start.
