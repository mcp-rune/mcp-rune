# Derivation overview

This is the chapter's primer. Before you read the five guides below, this page is the one-page map of what gets derived — automatically, no extra wiring — from your Model declaration. Skim the table, then come back to it as you read each guide so you can see _what each piece of a declaration unlocks_.

Everything below is what makes the "Model is the single source of truth" claim concrete.

<!-- TODO(diagram): derivation fan-out — Model at center, arrows out to Prompt, Tools, Forms, Search, Apps, Docs, Validation, Analysis. -->

## Try it — see derivation in action before reading the map

> Verified against rune CLI 0.11.0 · @mcp-rune/mcp-rune 0.103.3 · Node 24.

If you finished the [Quickstart](../01-getting-started/quickstart.md) you already have everything you need: the scaffolded `bookshelf-tour` project, the MCP Inspector connected to it, and a `Book` model declared in `src/models/book.ts`. Before you scan the derivation table, observe two surfaces deriving from that one declaration.

**1. Tool list — derived from `MODEL_CLASSES`**

In the Inspector, call `list_models` with `{}`. Expect:

```json
[
  {
    "name": "book",
    "endpoint": "books",
    "description": "A Book record",
    "attributes": ["name", "description"],
    "required_attributes": ["name"],
    "read_only": false
  }
]
```

Three things on this row are derived: `endpoint` from `static api.endpoint`, `attributes` from the `static attributes` map, and `required_attributes` from the `required: true` flag on `name`. You didn't write any of them into a registry — `list_models` reads the class itself.

**2. Prompt guide text — derived from `description` + `attributes`**

Call `get_prompt_guide` with `{ "guide_name": "book" }`. The response is a multi-section Markdown guide whose **Attribute reference** table at the bottom looks like this:

```
| Attribute     | Type   | Required | Valid Values |
|---------------|--------|----------|--------------|
| name          | string | Yes      |              |
| description   | text   | No       |              |
```

No template lives in `src/prompts/book-prompt.ts` for this table — it's synthesised from the same `static attributes` block.

**Observe:** one declaration, two surfaces, zero glue code. Multiply that across every row in the table below and you have the chapter's argument: the Model is one place, and everything else points back to it. As you read each guide, return to this table to remember which row you're filling in.

## What gets derived

| Surface | Driven by | Covered in |
| --- | --- | --- |
| **Prompt schema** | `attributes` + `associations` (via `derivePromptSchema`) | [Prompt derivation](../03-the-prompt/prompt-derivation.md) |
| **Prompt guide text** | `description` + `attributes` + `examples` | [Prompt creation](../03-the-prompt/prompt-creation.md) |
| **9 polymorphic tools** | `MODEL_CLASSES` registry — every model gets all 9 | [Polymorphic tools](../04-tools/polymorphic-tools.md) |
| **Form validation** | `required`, `default`, `validation`, `enumValues` | [Validation and defaults](./validation-and-defaults.md) |
| **App forms** | `attributes` + `kinds` → `<input>` type per field | [Model form](../05-apps/model-form.md) |
| **Picker / multi-picker** | `belongsTo` / `hasMany` → recommended picker app | [MCP apps](../05-apps/mcp-apps.md), [Associations](./associations.md) |
| **Display rendering** | `displayValue` + per-kind `render` | [Attributes and kinds](./attributes-and-kinds.md) |
| **Search filters** | `attributes` + the search request shaper | [Search filters](../06-the-three-layers-up-close/search-filters.md) |
| **API payload shape** | `api.convention` (defaults to the server-wide one) | [API convention](../06-the-three-layers-up-close/api-convention.md) |
| **Foreign-key columns** | `associations.belongsTo` → `{key}_id` attribute | [Associations](./associations.md) |
| **Graph edges** | `associations` → `(record → target)` edges | [Retrieval & GraphRAG](../09-retrieval-and-graphrag/retrieval-graphrag.md) |
| **Embedding text** | `attributes` (text/string fields concatenated) | [Analysis quickstart](../09-retrieval-and-graphrag/analysis-quickstart.md) |
| **Auto-generated docs** | `description` + `attributes` + `associations` | [Polymorphic tools](../04-tools/polymorphic-tools.md) (the `get_prompt_guide` tool) |

## What you write vs what derives

```
   What you write                          What the framework derives
 ┌────────────────────────┐    ┌────────────────────────────────────┐
 │  static description    │    │ Prompt guide intro                  │
 │  static api            │───▶│ DataLayer endpoint + convention     │
 │  static attributes     │    │ Form fields + validation + kinds    │
 │    { type, required,   │    │ Prompt schema + LLM-facing labels   │
 │      default,          │    │ Search filter surface               │
 │      validation,       │    │ App display rendering               │
 │      enumValues, … }   │    │ Embedding text (analysis layer)     │
 │  static associations   │    │ FK columns + pickers                │
 │    { belongsTo,        │    │ Graph edges (analysis layer)        │
 │      hasMany }         │    │ Validation of referenced records    │
 │  get displayValue()    │    │ Picker labels + summary rendering   │
 └────────────────────────┘    └────────────────────────────────────┘
```

## What you still have to write yourself

Derivation covers the _uniform_ parts. The places where you reach back in and write actual code:

- **Custom kinds** — when `'string:isbn'` needs more than what the built-in `string` kind does. See [Attributes and kinds](./attributes-and-kinds.md).
- **Prompt content** — the actual `promptContent` getter on your `Prompt` class. The framework provides `PromptContentBuilder` as a fluent helper, but you decide what goes into the guide text. See [Prompt creation](../03-the-prompt/prompt-creation.md).
- **Custom tools** — anything beyond CRUD. The 8 polymorphic tools cover the data-plane uniformly; bespoke verbs (cancel a subscription, recompute a score) are `BaseTool` subclasses you write. See [Tool creation](../04-tools/tool-creation.md).
- **Custom apps** — when the default 7 apps don't fit your UX. See [Custom app](../10-extensions/custom-app.md).
- **Domain knowledge** — concepts, business rules, workflows. The framework doesn't synthesize these from your model — they're a separate declaration set. See [Domain knowledge](../08-domain-knowledge/domain-knowledge.md).

The dividing line is: **structural** derives, **semantic** doesn't. The framework can derive that `status` is an enum with three values; it cannot derive that `status: 'completed'` should require `rating` to be set (that's a business rule). The next several chapters walk through both halves in detail.

## What's next in this chapter

The table above is the map. The rest of chapter II walks every cell:

1. [Defining a model](./defining-a-model.md) — the smallest realistic declaration and the four static fields the framework reads.
2. [Attributes and kinds](./attributes-and-kinds.md) — the `type:` taxonomy and how one value moves through three representations.
3. [Associations](./associations.md) — `belongsTo` and `hasMany`, the foreign keys they infer, and what derivation unlocks from them.
4. [Validation and defaults](./validation-and-defaults.md) — `required`, `default`, and the validation pass that fires before any write.
5. [Definition vs consumption](./definition-vs-consumption.md) — why the model code is the only place to declare these things, and the architectural seam the next chapter builds on.

After chapter II, [Chapter 3 — The Prompt](../03-the-prompt/) picks up with the first major consumer of the Model: the prompt that teaches an LLM how to fill the form your model defines.
