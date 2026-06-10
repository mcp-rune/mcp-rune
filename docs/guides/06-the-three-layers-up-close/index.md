# The three layers, up close

Part I taught Tools and Apps to call three injected layers — `DataLayer`, `ModelLayer`, `AnalysisLayer` — without knowing how any of them are implemented. This is Part II. It's where you decide what's _behind_ each interface for your deployment: which adapter you use, which wire convention, which API client, which search shape.

If Part I is "the contract every projection consumes," Part II is "the contract you implement (or pick the right built-in for)." Once you finish it, you can take the bookshelf example off the in-memory stub and point it at a real HTTP backend, swap conventions per model, override the search request shape, or extend any of the three layers with new capability.

**Read in this order:**

### DataLayer — backend I/O

1. [Data layer](./data-layer.md) — the central seam. Built-in implementations (in-memory stub, `ModelService`, `SearchEnabledDataLayer`). When to swap.
2. [Model service](./model-service.md) — the default `DataLayer` adapter. How `ModelService` composes `EndpointResolver` + `ApiClient` + convention to route every CRUD call.
3. [API configuration](./api-configuration.md) — the `static api` block on a `BaseModel`: endpoint, convention, namespace, readOnly, per-action overrides, custom actions, compound IDs. The declaration the three sibling guides above and below read from.
4. [API client](./api-client.md) — the universal CRUD HTTP contract `ModelService` calls into. Write a custom `ApiClient` when fetch/axios/your-internal-client needs different ergonomics.
5. [API convention](./api-convention.md) — the wire-format shape: payload wrapping, association ID translation, response unwrapping. Per-model `api.convention:`, server-wide `defaultConvention:`. Note: the default-convention seam moved from `BaseModel` to `DataLayer` in v0.85.0.
6. [Search request shaper](./search-request-shaper.md) — translate `{ query, filters, page, perPage }` into the request shape your search backend expects (Ransack, Elasticsearch DSL, JSON:API filter syntax). Renamed from `SearchAdapter` in v0.77.0.
7. [Search filters](./search-filters.md) — the typed filter contract (`text` · `enum` · `relation` · `date_range` · `integer_range`) the shaper consumes.

### ModelLayer — per-model model-config reads

8. [Model layer](./model-layer.md) — the synchronous, per-model-bound interface. `kindFor`, `resolveDerivedFields`, `validFieldNames`, `promptSchema`, `checkRequired`. No I/O.

### AnalysisLayer — per-model analysis projections

9. [Analysis layer](./analysis-layer.md) — the per-model-bound, per-request interface. `extractEdges`, `buildEmbeddingText`. The substrate Part III's analysis tools call into.

When you finish this section, [chapter 7](../07-auth-and-transport/) covers the surrounding concerns — who can call your server (OAuth 2.1) and how they reach it (stdio vs HTTP). Then Part III ([Domain Knowledge](../08-domain-knowledge/), [Retrieval & GraphRAG](../09-retrieval-and-graphrag/)) is where the three layers earn their keep on something more interesting than CRUD.
