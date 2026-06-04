# Retrieval & GraphRAG

mcp-rune's retrieval stack: records become vectors, a relationship graph, and domain-grounded memories you can query by meaning, aggregate, or stratified sample — map-reduce over thousands of rows without flooding the context window.

**Read in this order:**

1. [Retrieval & GraphRAG overview](./retrieval-graphrag.md) — start here: how vectors, edges, and domain combine into GraphRAG, and which guide owns each piece
2. [Analysis memories](./analysis-memories.md) — the six `analysis_*` tools: ingest paginated records, embed findings into pgvector, recall by meaning
3. [Summary strategies](./summary-strategies.md) — nine page-summary strategies (five field-level, four GraphRAG-aware); see [`summary-strategies/`](./summary-strategies/) for per-strategy reference
4. [Proximity sampling](./proximity-sampling.md) — date-windowed, bucket-stratified sampling for representative records around a date
5. [Analysis quickstart](./analysis-quickstart.md) — bring up pgvector and walk all five summary strategies end to end
6. [Transient context protocol](./transient-context.md) — server-to-client protocol for collapsing transient tool results after a follow-up call has consumed them
