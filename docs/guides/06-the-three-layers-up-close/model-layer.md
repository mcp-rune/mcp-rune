> **Customization:** none — this chapter is informational. The deployer-facing seam for I/O is [`DataLayerFactory`](./data-layer.md) on `ToolRegistry` / `AppRegistry`. `ModelLayer` is constructed internally from `models:` on the Registry; you cannot replace it. Read this chapter to understand what `this.modelLayer('book')` does inside your own tools, prompts, and apps.

# Model layer

`ModelLayer` is the synchronous, no-I/O peer of `DataLayer`. Where `DataLayer` answers "fetch me records," `ModelLayer` answers the one static question that must be re-answered per model after every fetch: which `derived: { from, field }` declarations need flattening onto the records.

Inside any tool, app, prompt, or `ApiExtension`, the call is the same:

```ts
const layer = this.modelLayer('book')
layer.resolveDerivedFields([r]) // Flattens derived: { from, field } in place
```

Its surface is deliberately small. Kind descriptors — the parse/validate/describe/input machinery per attribute type — are **not** behind this layer: kinds are shared vocabulary ([ADR 0009](../../architecture/decisions/0009-kinds-are-shared-vocabulary.md)), read directly from `src/mcp/models/kinds/`. See [Attributes & kinds](../02-the-model/attributes-and-kinds.md) for that surface.

## What you use it for

### Flatten derived fields after a find/list

When a model declares `derived: { from, field }` on an attribute (e.g. `author_name` derived from `author.name`), the API payload arrives nested. `resolveDerivedFields` walks each record and promotes the nested value to the top level — in place, for performance. Call it after fetching and before handing records to the LLM.

```ts file=src/tools/show-book-tool.ts
override async execute({ record_id }: { record_id: string }) {
  const data = this.requireDataLayer()
  const layer = this.modelLayer('book')
  const record = await data.find('book', record_id)
  layer.resolveDerivedFields([record])
  return record
}
```

```js file=src/tools/show-book-tool.js
async execute({ record_id }) {
  const data = this.requireDataLayer()
  const layer = this.modelLayer('book')
  const record = await data.find('book', record_id)
  layer.resolveDerivedFields([record])
  return record
}
```

### Kind lookups happen beside it, not through it

When your code knows the model and attribute names at runtime — for example, a tool that describes one attribute identified by argument — read the kind descriptor directly. Kinds are boot-static and pure, and the same call works for prompt-only fields that no model declares, which is why they are vocabulary rather than a layer method.

```ts file=src/tools/describe-attribute-tool.ts
import { getKind, kindOptsFrom } from '@mcp-rune/mcp-rune/models'
import { BaseTool } from '@mcp-rune/mcp-rune/tools'

export class DescribeAttributeTool extends BaseTool {
  override get name() {
    return 'describe_attribute'
  }

  override async execute({
    model,
    record_id,
    attribute
  }: {
    model: string
    record_id: string
    attribute: string
  }) {
    const data = this.requireDataLayer()
    const record = await data.find(model, record_id)
    const attr = this.getModelConfig(model)?.attributes?.[attribute]
    const kind = getKind(attr?.type, attr?.format)
    return {
      attribute,
      kind: kind.label,
      value: kind.describe(record[attribute], attr && kindOptsFrom(attr))
    }
  }
}
```

```js file=src/tools/describe-attribute-tool.js
import { getKind, kindOptsFrom } from '@mcp-rune/mcp-rune/models'
import { BaseTool } from '@mcp-rune/mcp-rune/tools'

export class DescribeAttributeTool extends BaseTool {
  get name() {
    return 'describe_attribute'
  }

  async execute({ model, record_id, attribute }) {
    const data = this.requireDataLayer()
    const record = await data.find(model, record_id)
    const attr = this.getModelConfig(model)?.attributes?.[attribute]
    const kind = getKind(attr?.type, attr?.format)
    return {
      attribute,
      kind: kind.label,
      value: kind.describe(record[attribute], attr && kindOptsFrom(attr))
    }
  }
}
```

If the attribute isn't declared on the model, `getKind` throws `UnknownKindError` — the loud-failure guard for code paths boot validation can't see.

### Validate user-supplied keys before they hit the backend

Rejecting unknown `filters:` keys at the seam is `DataLayer`'s job — call `dataLayer.validateFilters(model, filters)` (see the [Data layer](./data-layer.md) chapter). It runs against the same model declaration, but it belongs to the I/O seam because the legal-key question only matters on the way to the backend.

## Why `ModelLayer` is separate from `DataLayer`

`ModelLayer` is sync, has no per-request state, and never reaches the network. Keeping the synchronous metadata reads on a separate interface keeps `DataLayer` honest: every method on `DataLayer` is `Promise`-typed, which signals to readers that the seam is the I/O boundary. A sync helper like `resolveDerivedFields` would muddy that signal if it lived there.

## Interface reference

File: `src/mcp/model-layer/model-layer.ts`

```ts
export interface ModelLayer {
  /** The Model class this layer is bound to. */
  readonly model: ModelClassLike

  /** Flatten `derived: { from, field }` declarations on a list of records (in place). */
  resolveDerivedFields(records: Record<string, unknown>[]): Record<string, unknown>[]
}
```

Every method operates on the model bound at construction. There's no `(modelName, …)` first argument — that binding happens once, via the factory.

### What it doesn't do

- **No I/O.** No `find`, `list`, or `dispatch`. If you find yourself wanting a `ModelLayer` method that needs the backend, you actually want `DataLayer`.
- **No kind resolution.** Kinds are shared vocabulary read via `getKind` / `kindOptsFrom` / `resolveInputType` from `src/mcp/models/kinds/` — see [ADR 0009](../../architecture/decisions/0009-kinds-are-shared-vocabulary.md) for why they are not a layer method.
- **No mutation of model state.** `resolveDerivedFields` mutates the records you pass in (in place, for performance) but never touches the model class itself.
- **No analysis projections.** Edge extraction, embedding text, hop walks — those are `AnalysisLayer`'s domain.

### The factory

`ModelLayer` instances are produced by a factory bound to your `models:` registry. The factory is constructed once at server boot and reused for every request — every `ModelLayer` it returns is cached per model class, because nothing it does depends on who's calling or what session is active.

```ts
type ModelLayerFactory = (modelName: string) => ModelLayer
```

You don't construct or override this factory. The framework calls `createModelLayerFactory(models)` internally from `ToolRegistry` / `AppRegistry`, then threads `this.modelLayer` into every tool, app, prompt, and `ApiExtension` it dispatches. The customization path for "I want a different backend" is `DataLayerFactory`; the customization path for "I want to declare a new attribute kind" is `AppRegistry({ kinds })` (see [Attributes & kinds](../02-the-model/attributes-and-kinds.md)).

## For framework contributors

If you are contributing to mcp-rune itself (not a deployer extending a server), and you need a new sync read against a model's static configuration, the rule is: **extend the interface**, not reach past it — and first prove the read has a real consumer. The layer once carried four speculative methods with none; they were deleted rather than left as inert surface.

1. Add the method to `src/mcp/model-layer/model-layer.ts`.
2. Implement it in the factory.
3. Add any new internal helper to [`AGENTS.md`](../../../AGENTS.md)'s forbidden-from-projection-layer list. The `no-restricted-imports` eslint rule from [chapter 4](../04-tools/the-three-layers.md) enforces it.

Importing helpers like `resolveDerivedFields` or `collectValidFieldNames` from `src/mcp/model-layer/` into projection-layer code (tools, prompts, apps, api-extensions) is a lint error by design — projection-layer code talks only through the three peer interfaces. Kinds imports are the deliberate exception, per [ADR 0009](../../architecture/decisions/0009-kinds-are-shared-vocabulary.md).

## What's next

`ModelLayer` covers the static, synchronous half of model consumption. The next chapter, [Analysis layer](./analysis-layer.md), covers the dynamic, per-request half: edge extraction, embedding text, and the projections that the analysis pipeline in Part III runs on top of.
