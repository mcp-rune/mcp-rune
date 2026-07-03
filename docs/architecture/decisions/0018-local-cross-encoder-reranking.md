# 0018. Local cross-encoder reranking at the recall facade

- Status: Accepted
- Date: 2026-07-03
- Related: #348, [ADR-0001](0001-llm-synthesis-stays-client-side.md), [ADR-0013](0013-sessions-are-graphs-analyses-are-per-model.md)

## Context

Semantic record recall (`searchIngestedRecords` → `searchRecordsSemantic`) ranks by bi-encoder cosine similarity: the query and each record are embedded independently and scored by vector distance. This is fast — pgvector ranks the whole session in one indexed query — but coarse. A bi-encoder never sees the query and document together, so it misses relevance signals a joint model would catch (negation, term interaction, "unread" vs "read"). The precision ceiling on the first page of results is exactly where an LLM agent feels the miss.

The standard remedy is a cross-encoder: a model that scores the `(query, document)` pair jointly. It is far more precise and far too slow to run over a corpus — but it doesn't have to. Two-stage retrieval over-fetches a small candidate pool with the cheap bi-encoder, then reranks just that pool with the cross-encoder.

The constraint that shaped this framework (ADR 0001) is no external AI dependency: embeddings run locally through the optional `@huggingface/transformers` dependency, no API key, deterministic. A reranker must hold the same line.

## Decision

**Add opt-in two-stage retrieval: over-fetch by cosine, rerank the pool with a local cross-encoder, cut to `topK`.**

- New `src/runtime/reranking.ts` facade mirrors `embeddings.ts`: a lazily-loaded local cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`) exposing `rerank(query, documents) → number[]` (one relevance score per document, input order). It is **graceful-disable**: if the transformers dependency is absent, it logs once and returns `[]` so callers keep their prior ordering. Lazy load means a deployment that never sets `rerank` never pulls the model.
- `searchIngestedRecords` gains `rerank?: boolean` and `overFetch?: number`. When `rerank` is set it fetches `topK * overFetch` candidates (default 5×, capped at 20×), textifies each through the same `buildEmbeddingText` used at ingest, reranks, re-sorts by cross-encoder score, and cuts to `topK`. Empty rerank output (unavailable) falls back to the cosine slice.
- `analysis_query` semantic `target:'records'` exposes `rerank` as a tool parameter, described as the higher-precision/slower path.
- The facade is exported from `@mcp-rune/mcp-rune/runtime` (`reranking`) so deployers can rerank their own candidate lists.

## Options considered

**Hosted reranker API (Cohere Rerank, Voyage) — rejected.** Best precision, but it reintroduces the exact dependency ADR 0001 removed: an API key, per-call cost, network latency, and a third party seeing the corpus. A local cross-encoder keeps the no-key, deterministic, offline guarantee.

**Bigger/instruction-tuned embedding model instead of a reranker — rejected.** Improves recall marginally but stays a bi-encoder; it can't model query-document interaction, and a larger embedding model inflates the ingest-time cost for every record rather than the query-time cost for one small pool.

**Always rerank (not opt-in) — rejected.** The cross-encoder is a second model download and adds query latency proportional to the pool size. Most queries don't need it; making it a per-query flag keeps the default path cheap and lets the caller pay for precision only when it matters.

**Rerank inside the SQL adapter — rejected.** The pgvector adapter's job is vector ranking; cross-encoder inference is an embedding-service concern that belongs at the runtime facade alongside `embeddings`, not in the storage layer (mirrors keeping embedding generation out of the adapter).

## Consequences

- Non-breaking and off by default: existing recall behavior is unchanged unless `rerank: true` is passed.
- Determinism holds: the cross-encoder is deterministic like the embedder, so the ADR 0007 determinism guarantees extend to reranked recall (the same query + pool yields the same order).
- A second optional model download (~tens of MB, quantized) the first time reranking is used; documented as the precision/latency trade-off.
- The over-fetch pool size bounds cross-encoder cost; `overFetch` is capped so an unbounded `topK` can't turn into an unbounded rerank.
