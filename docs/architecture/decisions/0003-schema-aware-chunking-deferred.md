# 0003. Schema-aware chunking: deferred, constraints recorded

- Status: Accepted — implementation deferred
- Date: 2026-07-03
- Related: #348, [ADR-0001](0001-llm-synthesis-stays-client-side.md)

## Context

Ingestion embeds one vector per record, over text truncated at 512 characters (`buildEmbeddingText`, `src/mcp/analysis-layer/edge-extraction.ts`). Records whose long-text fields materially exceed that window lose content from their embedding, which is the classic motivation for chunked, hierarchical retrieval in RAG stacks. A de-facto two-level hierarchy already exists — raw records → per-page summary memories → stored findings, all semantically recallable — which covers part of what hierarchical retrieval buys.

## Decision

Chunking is deferred until a deployer-shaped consumer actually has records whose long-text fields exceed the embedding window in ways that measurably hurt retrieval. When it is built, the implementation must honor these constraints:

- **Chunks are rows keyed to their record** — `(analysis_id, model, record_id, chunk_index)` in a new migration — never a parallel "document" taxonomy. Records remain the unit of retrieval; chunks are evidence, deduplicated by record before results surface.
- **The schema decides what chunks.** Attribute kinds identify long-text fields (`text`-kind attributes chunk; `string` and structured kinds embed whole). A generic RAG stack has to guess which content is chunkable; a model-driven one must not.
- **The same local embedding pipeline embeds chunks** — no new model, no API key, per [ADR-0001]'s determinism stance.
- The policy surface lives on `AnalysisLayer.buildEmbeddingText` options and the ingested-records adapter — behind the existing seams, not beside them.

## Options considered

**Fixed-window chunking of everything — rejected.** Most ingested records are short structured rows; chunking them multiplies storage and query cost to no retrieval benefit, and buries the strong signal of whole-record embeddings in chunk noise.

**Hierarchical summarization instead of chunking — partially exists, complementary.** Page summaries already provide a coarse upper tier. They do not recover content truncated out of an individual record's embedding, so they complement rather than replace chunking.

**Schema-aware selective chunking (chosen shape, deferred).** Chunk exactly the fields the model declares as long text, keep the record as the retrieval unit.

## Consequences

- Record-level semantic search (epic #348 task 24) lands first and may prove sufficient for current corpora — its results are the evidence that decides whether chunking ever gets promoted.
- The revisit trigger is concrete: a consumer whose `text`-kind fields routinely exceed the window and whose retrieval quality measurably suffers from truncation.
