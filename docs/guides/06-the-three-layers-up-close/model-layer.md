# Model layer

`DataLayer` is the I/O seam. `ModelLayer` is the _read-only_ seam — every synchronous, no-I/O read against a model's static configuration. Where `DataLayer` is per-request, `ModelLayer` is per-model-bound and cached, because nothing it does depends on who's calling or what session is active.

The interface is what every tool, app, prompt, and api-extension means when it says `this.modelLayer('book')`. Internal helpers (`resolveDerivedFields`, `collectValidFieldNames`, `getKind`) live in `src/mcp/model-layer/`; they are not importable from projection-layer code — the `no-restricted-imports` rule from [chapter 4](../04-tools/the-three-layers.md) sees to that.

## The interface

File: `src/mcp/model-layer/model-layer.ts`

```ts
export interface ModelLayer {
  /** The Model class this layer is bound to. */
  readonly model: ModelClassLike

  /** Resolve KindDescriptor for an attribute. Throws on unknown attribute. */
  kindFor(attrName: string): KindDescriptor

  /** Flatten `derived: { from, field }` declarations on a list of records. */
  resolveDerivedFields(records: Record<string, unknown>[]): Record<string, unknown>[]

  /** Set of legal input keys (attributes + association FKs). */
  validFieldNames(): Set<string>

  /** Derive the prompt schema (consumed by validate_form / prompt strategies). */
  promptSchema(options?: DeriveSchemaOptions): DerivedSchema

  /** Structured pass/fail of required-field check. */
  checkRequired(params: Record<string, unknown>): ValidationResult
}
```

Every method operates on the model bound at construction. There's no `(modelName, …)` first argument — that binding happens once, via the factory.

## The factory

`ModelLayer` is constructed indirectly. What's injected is a _factory_ that returns a layer bound to a named model:

```ts
type ModelLayerFactory = (modelName: string) => ModelLayer

// In a tool:
const bookLayer = this.modelLayer?.('book')
bookLayer?.kindFor('rating') // KindDescriptor for 'integer'
bookLayer?.resolveDerivedFields(records) // records, in place
```

`createModelLayerFactory({ models })` produces the factory from the `models:` registry you wire on `ToolRegistry`. The framework calls it once at boot; the resulting factory is shared across every request.

## What it doesn't do

- **No I/O.** No `find`, no `list`, no `dispatch`. If you find yourself wanting a `ModelLayer` method that needs the backend, you actually want `DataLayer` — `ModelLayer` is bounded to what can be answered from static configuration alone.
- **No mutation.** All five methods are pure with respect to the model class. `resolveDerivedFields` mutates the records you pass in (in place, for performance) but does not touch model state.
- **No analysis projections.** Edge extraction, embedding text, hop walks, summaries — those are `AnalysisLayer`'s domain. The split is deliberate: `ModelLayer` is so cheap it can be called from validate-time STRATEGY tools that have no `DataLayer`; `AnalysisLayer` carries a `DataLayer` and is reserved for tools that have one.

## When to use each method

- **`kindFor(attr)`** — when you need the kind descriptor for rendering, validation, or summarization in a context where the attribute name is dynamic.
- **`resolveDerivedFields(records)`** — after a `find` or `list`, before handing records to the LLM. Flattens nested association data into top-level fields declared with `derived: { from, field }`.
- **`validFieldNames()`** — when validating user-supplied keys (e.g. inside a `filters:` block) before they hit the backend.
- **`promptSchema()`** — almost always called by the prompt subsystem itself, not by user code. Surfaced here because `validate_form` and custom strategy tools may want a direct handle.
- **`checkRequired(params)`** — the cheap required-field pass that runs before any write.

## Extending the interface

If your projection-layer code needs something `ModelLayer` doesn't expose today — say, a `displayValueOf(record)` helper — the rule is: **extend the interface**, not import the internal helper. Open `src/mcp/model-layer/model-layer.ts`, add the method, implement it in the factory, then update [`AGENTS.md`](../../../AGENTS.md) to list any new internal helper that should be forbidden in projection-layer code. The eslint guard does the rest.

## What's next

`ModelLayer` covers the static, synchronous half of model consumption. The next chapter, [Analysis layer](./analysis-layer.md), covers the dynamic, per-request half: edge extraction, embedding text, and the projections that the analysis pipeline in Part III runs on top of.
