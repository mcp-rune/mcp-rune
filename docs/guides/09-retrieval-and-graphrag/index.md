# Retrieval & GraphRAG

Chapter 8 introduced the domain layer — concepts, business rules, workflows. This chapter is where Domain plus Model plus `AnalysisLayer` come together as **retrieval**: records become vectors, associations become a relationship graph, and domain rules become summary strategies you can run over thousands of rows without flooding the context window.

The substrate is pgvector + the `analysis_*` tool family + the `AnalysisLayer` you met in chapter 6. The running example is `bookshelf-graph`: 500 books with deliberately varied data, an authored domain registry, and a `TUTORIAL.md` that walks through every summary strategy end to end.

**Read in this order:**

1. [Analysis quickstart](./analysis-quickstart.md) — Quickstart Part 2: bring up pgvector and walk every summary strategy end to end against the `bookshelf-graph` fixtures. Hands-on entry to the chapter.
2. [Retrieval & GraphRAG overview](./retrieval-graphrag.md) — the architecture behind the quickstart: how vectors, edges, and domain combine into GraphRAG, and which guide owns each piece.
3. [Analysis memories](./analysis-memories.md) — the six `analysis_*` tools: ingest paginated records, embed findings into pgvector, recall by meaning.
4. [Summary strategies](./summary-strategies.md) — nine page-summary strategies (five field-level, four GraphRAG-aware); see [`summary-strategies/`](./summary-strategies/) for per-strategy reference.
5. [Proximity sampling](./proximity-sampling.md) — date-windowed, bucket-stratified sampling for representative records around a date.
6. [Transient context protocol](./transient-context.md) — server-to-client protocol for collapsing transient tool results after a follow-up call has consumed them.

When you finish this section, Part IV ([Extensions](../10-extensions/)) covers how to add new capability — extension shapes, recipes, the seams every chapter so far has been hinting at. Once you understand the layer story end to end, that section becomes a small set of patterns rather than a separate worldview.
