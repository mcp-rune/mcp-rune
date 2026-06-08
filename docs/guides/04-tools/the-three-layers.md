# The three layers

Chapter 3 ended with a Prompt that knows how to read a Model. This chapter — the foundation for everything in Tools and Apps — answers the next question: _what does the code that actually runs see at runtime?_ The answer is **three peer interfaces**, injected per request, that every Tool, App, Prompt, and `ApiExtension` consumes.

You will never write a tool that imports `ApiClient` directly, or `resolveDerivedFields`, or `extractEdgesFromRecord`. The eslint config forbids it. What you write instead is `this.dataLayer.find(...)`, `this.modelLayer('book').kindFor(...)`, `this.analysisLayer('book').extractEdges(...)`. The three layers are how your tool reaches the rest of the framework.

## The shape

Every `BaseTool` constructor receives the same `ToolDependencies` bag, and the three layers are three of its slots:

File: `src/mcp/tools/base-tool.ts`

```ts
export interface ToolDependencies {
  /** Per-request backend I/O. Absent for STRATEGY / no-auth tools. */
  dataLayer?: DataLayer
  /** Per-model-bound, synchronous model-config reads. */
  modelLayer?: ModelLayerFactory
  /** Per-model-bound, per-request analysis projections. */
  analysisLayer?: AnalysisLayerFactory
  // …
}
```

`ToolRegistry` constructs each layer per request, threads them in, and `BaseTool` exposes them as instance fields. From the tool's point of view they are simply `this.dataLayer`, `this.modelLayer`, `this.analysisLayer`.

<!-- TODO(diagram): three-layer DI fan-out — Tool/App box at top, three arrows down to DataLayer / ModelLayer(name) / AnalysisLayer(name), each terminating at the Model declaration in src/mcp/models/. -->

```
              ┌──────────────────────────┐
              │  Tool / App / Prompt     │  (projection layer — what you write)
              └────┬──────────┬────────┬─┘
                   │          │        │
       this.dataLayer  this.modelLayer  this.analysisLayer
       (per request)  (name) per call   (name) per call
                   │          │        │
        ┌──────────▼──┐  ┌────▼────┐  ┌▼─────────────┐
        │  DataLayer  │  │ Model-  │  │ Analysis-    │
        │  backend    │  │ Layer   │  │ Layer        │
        │  I/O        │  │ reads   │  │ projections  │
        └──────────┬──┘  └────┬────┘  └──┬───────────┘
                   │          │          │
                   ▼          ▼          ▼
                ┌──────────────────────────┐
                │      Model declaration   │
                └──────────────────────────┘
```

## `DataLayer` — backend I/O

**Lifetime:** constructed per authenticated request. Carries the session's access token (when applicable). The same instance threads through every tool invocation in that request.

**Surface:**

- `find(model, id)` / `list(model, params)` / `searchNormalized(model, params)` — read
- `dispatch(model, action, payload)` — write
- `lookupNormalized(model, query)` / `groupSearchNormalized(query)` — cross-model search
- `buildPayload(modelInstance, modelConfig, attrs)` — convention-aware payload assembly

**In a tool:**

```ts
override async execute(args: { id: string }): Promise<ToolResult> {
  const layer = this.requireDataLayer()
  const book = await layer.find('book', args.id)
  return this.ok(book)
}
```

`requireDataLayer()` throws if the tool's category doesn't get one — STRATEGY tools (`get_prompt_guide`, `validate_form`) don't, because they're stateless and have no business hitting the backend.

**What's behind it:** built-in implementations are `createInMemoryDataLayer` (the stub used in the quickstart), `ModelService` (the default HTTP adapter, wrapping `ApiClient` + `EndpointResolver` + convention), and `SearchEnabledDataLayer` (the wrapper that adds search/lookup methods on top of either base). [Part II, chapter 6](../06-the-three-layers-up-close/data-layer.md) covers them in detail.

## `ModelLayer` — per-model model-config reads

**Lifetime:** synchronous, no I/O, cached per model class. Constructed via the `ModelLayerFactory` — `this.modelLayer('book')` returns a layer bound to the `Book` class for the duration of the call.

**Surface:**

- `kindFor(attrName)` → `KindDescriptor`
- `resolveDerivedFields(records)` → flattens `derived: { from, field }` declarations in place
- `validFieldNames()` → `Set<string>` of legal input keys
- `promptSchema(options?)` → derived schema used by prompt validation
- `checkRequired(params)` → structured pass/fail of required-field check

**In a tool:**

```ts
override async execute(args: { model: string; record: Record<string, unknown> }) {
  const layer = this.modelLayer?.(args.model)
  if (!layer) return this.fail('Unknown model')
  const violations = layer.checkRequired(args.record)
  if (!violations.ok) return this.fail(violations.message)
  // …
}
```

**Why it exists:** chapter 2's [Definition vs consumption](../02-the-model/definition-vs-consumption.md) showed that helpers that _read_ a model live in `src/mcp/model-layer/`. `ModelLayer` is the public face of that folder. Projection-layer code must consume the interface, never import `resolveDerivedFields`, `getKind`, or `collectValidFieldNames` directly.

## `AnalysisLayer` — per-model analysis projections

**Lifetime:** per-model-bound _and_ per-request, because its methods do I/O and need the authenticated `DataLayer`. `this.analysisLayer('book')` returns a layer bound to `Book` plus this request's data layer.

**Surface today:**

- `extractEdges(record, options?)` → graph edges derived from associations
- `buildEmbeddingText(record, options?)` → text used by vector-embedding tools

Designed to host `walkHops`, `summarize`, `buildStratifier` in follow-up releases.

**In a tool:**

```ts
override async execute(args: { id: string }) {
  const book = await this.requireDataLayer().find('book', args.id)
  const edges = this.analysisLayer?.('book').extractEdges(book) ?? []
  return this.ok({ book, edges })
}
```

**Why it exists:** edge extraction and embedding-text assembly are analysis concerns that, like `ModelLayer`'s reads, were previously scattered helpers. Promoting them to a per-model layer makes them swappable per deployment and prevents projection-layer code from poking at the internals. The `analysis_*` tool family (covered in Part III) is the principal consumer.

## The eslint guard

The three layers are not a convention you can break by typo. `eslint.config.js` declares a `no-restricted-imports` block scoped to `src/mcp/apps/**`, `src/mcp/tools/**`, `src/mcp/prompt-layer/**`, and `src/mcp/data-layer/api-extensions/**`. From those folders, importing `ApiClient`, `ModelService`, `SearchService`, `EndpointResolver`, `resolveDerivedFields`, `getKind`, `extractEdgesFromRecord`, or anything analogous fails the build.

If a method you need is missing from one of the three interfaces, the rule is **extend the interface** rather than reach past it. The interfaces are designed to grow; the projection layer is designed to stay narrow.

[`AGENTS.md`](../../../AGENTS.md) at the repo root is the canonical source for these rules and lists every forbidden import.

## When each layer is `undefined`

`ToolDependencies` declares all three as optional because not every tool needs all three:

- **STRATEGY / no-auth tools** (`get_prompt_guide`, `validate_form`, `get_form_summary`) get no `dataLayer` and no `analysisLayer`. They're stateless and the framework wouldn't have a token for them anyway. They get `modelLayer` because it's synchronous and stateless — useful for derived-field flattening even at validate time.
- **CRUD tools** get all three.
- **Bare unit tests** that instantiate a tool with `new MyTool({})` get none, which is by design — every dependency is constructor-injected, so test setup is explicit.

Inside a tool, `this.requireDataLayer()` is the idiomatic way to assert presence. For the other two, fall back to a clear error or no-op when absent.

## What's next

You now know what every tool actually sees at runtime. The next chapter, [Polymorphic tools](./polymorphic-tools.md), looks at the eight CRUD tools the framework ships — what they are, how they use the three layers, and why eight tools is enough to serve every model you define.
