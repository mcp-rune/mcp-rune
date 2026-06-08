# Analysis layer

`AnalysisLayer` is the third peer interface — alongside `DataLayer` and `ModelLayer` — and the one that powers the GraphRAG and retrieval tooling in Part III. Like `ModelLayer`, it's bound to a single model at construction; unlike `ModelLayer`, it carries a per-request `DataLayer` so its methods can fetch records when they need to.

The split is deliberate: where `ModelLayer` answers "what does the model declare?", `AnalysisLayer` answers "what does the analysis pipeline see when it looks at a record?". Today that's edges and embedding text; designed to host hop walks, summaries, and stratifiers next.

## The interface

File: `src/mcp/analysis-layer/analysis-layer.ts`

```ts
export interface AnalysisLayer {
  /** The Model class this layer is bound to. */
  readonly model: ModelClassLike

  /** The name of the bound model — used as `src_model` on emitted edges. */
  readonly modelName: string

  /**
   * Extract typed edges from a record using the bound model's declared
   * belongsTo and hasMany associations. belongsTo emits one edge per
   * non-null `<rel>_id`; hasMany emits one edge per element of `<singular>_ids`.
   */
  extractEdges(record: Record<string, unknown>, options?: ExtractOptions): Edge[]

  /**
   * Deterministically textify a record for embedding: concatenates
   * `<field>: <value>` for each string-valued attribute, sorted by field name,
   * with id and *_id fields skipped. Truncates at options.maxLength (default 512).
   */
  buildEmbeddingText(record: Record<string, unknown>, options?: EmbeddingTextOptions): string
}
```

`Edge` is a typed `{ src_model, src_id, dst_model, dst_id, edge_type }` shape — the substrate the GraphRAG `concept-touch`, `relationship-coverage`, and `entity-extraction` summary strategies consume.

## The factory

```ts
type AnalysisLayerFactory = (modelName: string) => AnalysisLayer

// In a tool that has both:
const dataLayer = this.requireDataLayer()
const bookAnalysis = this.analysisLayer?.('book')
const book = await dataLayer.find('book', '42')
const edges = bookAnalysis?.extractEdges(book) ?? []
```

`createAnalysisLayerFactory({ models, dataLayer })` is called once per request — it threads the request's `DataLayer` into every analysis layer the request constructs. The factory's `(modelName)` call is cheap; the per-request rebuild is bounded by which models actually get touched.

## Why `DataLayer` lives inside `AnalysisLayer`

Some analysis operations (today `walkHops` is in the pipeline, not yet exposed; in the future `summarize` will sit here) need to fetch destination records. Rather than ask consumers to thread both layers in and pass the data layer through manually, the analysis layer captures it at construction.

This also keeps the projection layer's API narrow. A tool that wants to do edge extraction calls `this.analysisLayer?.('book').extractEdges(record)`; it doesn't have to know that, internally, edge extraction will (in a follow-up release) reach back through the data layer to resolve hop targets.

## When to use it

- **In a custom tool** that needs to surface graph structure: call `extractEdges` on returned records and include the edges in the response.
- **In an analysis pipeline tool** (the `analysis_*` family in Part III): the framework already wires `analysisLayer` into every one of them.
- **In an `ApiExtension`** that adds a search subsystem with semantic search: `buildEmbeddingText` is how you produce the document text the vector store indexes.

The `analysis_*` tools shipped today (`analysis_ingest`, `analysis_summarize`, `analysis_query`, …) are the principal first-party consumers. [Analysis quickstart](../09-retrieval-and-graphrag/analysis-quickstart.md) walks through bringing them up against the `bookshelf-graph` fixtures.

## Extending the interface

Same rule as `ModelLayer`: if you need a new analysis projection that today isn't on the interface, **extend the interface** in `src/mcp/analysis-layer/analysis-layer.ts`. Never import `extractEdgesFromRecord`, `expandHops`, or anything from `graph-stratifiers.ts` / `multi-hop-fetch.ts` directly from projection-layer code — the eslint guard will reject it.

The roadmap surface listed in the interface doc (`walkHops`, `summarize`, `buildStratifier`) is what the layer is _designed_ to host next; if your use case maps to one of those, the right move is to PR them onto the interface rather than reach past it.

## What's next

You've now seen every peer interface in detail. The DataLayer subsection covered the I/O seam and its adapters; the ModelLayer chapter covered the static-config reads; this chapter covered the analysis projections. [Chapter 7](../07-auth-and-transport/) picks up with the surrounding concerns — who can call your server and how they reach it.
