> **Customization:** none — this chapter is informational.
> The deployer-facing seam for I/O is [`DataLayerFactory`](./data-layer.md) on `ToolRegistry` / `AppRegistry`. `ModelLayer` is constructed internally from `models:` on the Registry; you cannot replace it. Read this chapter to understand what `this.modelLayer('book')` does inside your own tools, prompts, and apps.

# Model layer

`ModelLayer` is the synchronous, no-I/O peer of `DataLayer`. Where `DataLayer` answers "fetch me records," `ModelLayer` answers static questions about a model's declaration: what kind is this attribute, what are the legal input keys, which fields are required, what derived fields need flattening after a `find`.

Inside any tool, app, prompt, or `ApiExtension`, the call is the same:

```ts
const layer = this.modelLayer('book')
layer.kindFor('rating') // KindDescriptor for the 'rating' attribute
layer.validFieldNames() // Set of legal input keys for filters and writes
layer.resolveDerivedFields([r]) // Flattens derived: { from, field } in place
```

## What you use it for

Three patterns cover almost every real call.

### Get the kind for a dynamic attribute

When your code knows the model and attribute names at runtime — for example, a tool that renders or validates one attribute identified by argument — `kindFor` is how you reach the parse/validate/describe surface without re-deriving anything.

```ts file=src/tools/describe-attribute-tool.ts
import { BaseTool, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'

export class DescribeAttributeTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.CUSTOM
  }

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
    const layer = this.modelLayer(model)
    const record = await data.find(model, record_id)
    const kind = layer.kindFor(attribute)
    return {
      attribute,
      kind: kind.label,
      value: kind.describe(record[attribute])
    }
  }
}
```

```js file=src/tools/describe-attribute-tool.js
import { BaseTool, TOOL_CATEGORIES } from '@mcp-rune/mcp-rune/tools'

export class DescribeAttributeTool extends BaseTool {
  static get category() {
    return TOOL_CATEGORIES.CUSTOM
  }

  get name() {
    return 'describe_attribute'
  }

  async execute({ model, record_id, attribute }) {
    const data = this.requireDataLayer()
    const layer = this.modelLayer(model)
    const record = await data.find(model, record_id)
    const kind = layer.kindFor(attribute)
    return {
      attribute,
      kind: kind.label,
      value: kind.describe(record[attribute])
    }
  }
}
```

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

### Validate user-supplied keys before they hit the backend

When a deployer-authored `ApiExtension` or custom tool accepts a `filters:` block from the LLM, you want to reject unknown keys at the seam — not let them pass through to the API where the failure mode is opaque. `validFieldNames` returns the precomputed set of legal keys (attributes + association FKs).

```ts file=src/extensions/strict-filters.ts
const layer = deps.modelLayer(model)
const validKeys = layer.validFieldNames()
for (const key of Object.keys(filters)) {
  if (!validKeys.has(key)) {
    throw new Error(`Unknown filter key '${key}' for model '${model}'`)
  }
}
```

```js file=src/extensions/strict-filters.js
const layer = deps.modelLayer(model)
const validKeys = layer.validFieldNames()
for (const key of Object.keys(filters)) {
  if (!validKeys.has(key)) {
    throw new Error(`Unknown filter key '${key}' for model '${model}'`)
  }
}
```

## Why `ModelLayer` is separate from `DataLayer`

`ModelLayer` is sync, has no per-request state, and never reaches the network. That matters because validate-time STRATEGY tools (the `get_filters_guide`, `validate_form` family) run **before** authentication — they have no `DataLayer` to call. They still need to answer "what kind is this field?" and "which keys are legal?" — `ModelLayer` is the only seam they can use.

Keeping the synchronous metadata reads on a separate interface also keeps `DataLayer` honest: every method on `DataLayer` is `Promise`-typed, which signals to readers that the seam is the I/O boundary. Sync helpers like `kindFor` would muddy that signal if they lived there.

## Interface reference

File: `src/mcp/model-layer/model-layer.ts`

```ts
export interface ModelLayer {
  /** The Model class this layer is bound to. */
  readonly model: ModelClassLike

  /** Resolve KindDescriptor for an attribute. Throws on unknown attribute. */
  kindFor(attrName: string): KindDescriptor

  /** Flatten `derived: { from, field }` declarations on a list of records (in place). */
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

### When to use each method

| Method                          | Use it when                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `kindFor(attr)`                 | You have a dynamic attribute name and need its kind for rendering, validation, or describing.       |
| `resolveDerivedFields(records)` | After a `find` or `list`, before returning records to the LLM. Flattens `derived: { from, field }`. |
| `validFieldNames()`             | Before forwarding a user-supplied `filters:` block (or write payload) to the backend.               |
| `promptSchema()`                | Almost always called by the prompt subsystem itself; surfaced for `validate_form` / strategy tools. |
| `checkRequired(params)`         | The cheap required-field pass that runs before any write. Returns structured pass/fail.             |

### What it doesn't do

- **No I/O.** No `find`, `list`, or `dispatch`. If you find yourself wanting a `ModelLayer` method that needs the backend, you actually want `DataLayer`.
- **No mutation of model state.** `resolveDerivedFields` mutates the records you pass in (in place, for performance) but never touches the model class itself.
- **No analysis projections.** Edge extraction, embedding text, hop walks — those are `AnalysisLayer`'s domain.

### The factory

`ModelLayer` instances are produced by a factory bound to your `models:` registry. The factory is constructed once at server boot and reused for every request — every `ModelLayer` it returns is cached per model class, because nothing it does depends on who's calling or what session is active.

```ts
type ModelLayerFactory = (modelName: string) => ModelLayer
```

You don't construct or override this factory. The framework calls `createModelLayerFactory({ models })` internally from `ToolRegistry` / `AppRegistry`, then threads `this.modelLayer` into every tool, app, prompt, and `ApiExtension` it dispatches. The customization path for "I want a different backend" is `DataLayerFactory`; the customization path for "I want to declare a new attribute kind" is `AppRegistry({ kinds })` (see [Attributes & kinds](../02-the-model/attributes-and-kinds.md)).

## For framework contributors

If you are contributing to mcp-rune itself (not a deployer extending a server), and you need a new sync read against a model's static configuration — say, a `displayValueOf(record)` helper — the rule is: **extend the interface**, not reach past it.

1. Add the method to `src/mcp/model-layer/model-layer.ts`.
2. Implement it in the factory.
3. Add any new internal helper to [`AGENTS.md`](../../../AGENTS.md)'s forbidden-from-projection-layer list. The `no-restricted-imports` eslint rule from [chapter 4](../04-tools/the-three-layers.md) enforces it.

Importing helpers like `resolveDerivedFields`, `collectValidFieldNames`, or `getKind` from `src/mcp/model-layer/` into projection-layer code (tools, prompts, apps, api-extensions) is a lint error by design — projection-layer code talks only through the three peer interfaces.

## What's next

`ModelLayer` covers the static, synchronous half of model consumption. The next chapter, [Analysis layer](./analysis-layer.md), covers the dynamic, per-request half: edge extraction, embedding text, and the projections that the analysis pipeline in Part III runs on top of.
