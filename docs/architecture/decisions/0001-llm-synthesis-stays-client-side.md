# 0001. LLM synthesis and retrieval control stay client-side

- Status: Accepted
- Date: 2026-07-03
- Related: #348, [ADR-0002](0002-deterministic-community-summarization.md), [ADR-0007](0007-summary-strategy-determinism-contract.md)

## Context

The analysis subsystem is deterministic on the server side: nine summary strategies whose contract explicitly bans network, LLM, and I/O calls (`src/mcp/analysis-layer/summary-strategies/types.ts`), local embeddings with no API key (`src/runtime/embeddings.ts`), and pgvector storage. Generic RAG stacks put an LLM inside the retrieval path — synthesis over retrieved chunks, LLM reranking, agentic query loops — and reviews of mcp-rune repeatedly ask where those pieces are. The framework has no LLM SDK dependency at all, and that fact needs to read as architecture, not as a gap nobody got to.

## Decision

**The calling LLM is the synthesizer and the adaptive controller.** The server computes deterministic projections — stratified samples, typed summaries, recallable memories — and the MCP client LLM composes them: the map-reduce pattern over page summaries plus `analysis_store`/`analysis_query` is the synthesis story, and the describe → aggregate → filter → sample → semantic loop prompted by `analysis_query` is the agentic story.

Concretely:

- No LLM SDK dependency in the framework; no server-side synthesis, ranking, or closed-loop sampling.
- Server features must produce **structured, composable outputs** (typed `SummaryOutput` metadata, typed edges, category-tagged memories) rather than prose, because their consumer is a reasoning model, not a human.
- Anything scored or filtered server-side must stay deterministic and local (cosine similarity today; a local cross-encoder reranker is compatible — see epic #348 task 26 for its own record).

## Options considered

**Server-side LLM synthesis (own API client) — rejected.** It adds key management, per-request cost, and nondeterminism to a framework that promises deterministic, testable, API-key-free server behavior, and it duplicates a capability the MCP topology already guarantees: there is always a capable LLM on the other end of the wire — that is what an MCP server exists to serve. Running a second LLM inside the server means paying twice for reasoning and being unable to reproduce any analysis result.

**Optional LLM extension (hybrid) — deferred, shape recorded.** The architecture permits an opt-in tool family carrying its own client — a `BaseAnalysisTool` sibling, gated the way `requiresVectorStorage` gates today's tools — but never inside `AnalysisLayer` and never as a `SummaryStrategy` (the contract bans it). If a deployer-shaped consumer materializes with a genuine need for unattended server-side synthesis, this is the sanctioned shape; nothing ships until then.

**Client-side (chosen).** The deterministic server / reasoning client split keeps every server result reproducible, keeps install weight and secrets at zero, and exploits rather than ignores the topology.

## Consequences

- "Why is there no LLM in the retrieval path?" is answered by pointing here.
- Feature pressure lands in the right places: better deterministic projections (community summaries, path queries, record-level semantic search) instead of an embedded model.
- The agentic loop lives in tool descriptions and guides — prompt quality on `analysis_query` is a first-class concern, since the caller is the controller.
- Learned or feedback-trained reranking is out of scope for the server under this decision; it would live downstream in a deployer's stack.
