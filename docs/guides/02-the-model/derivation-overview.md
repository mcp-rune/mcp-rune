# Derivation overview

This chapter is a one-page map. Everything below is something the framework derives — automatically, no extra wiring — from your Model declaration. The list is what makes the "Model is the single source of truth" claim concrete.

<!-- TODO(diagram): derivation fan-out — Model at center, arrows out to Prompt, Tools, Forms, Search, Apps, Docs, Validation, Analysis. -->

## What gets derived

| Surface                   | Driven by                                                | Covered in                                                                          |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Prompt schema**         | `attributes` + `associations` (via `derivePromptSchema`) | [Prompt derivation](../03-the-prompt/prompt-derivation.md)                          |
| **Prompt guide text**     | `description` + `attributes` + `examples`                | [Prompt creation](../03-the-prompt/prompt-creation.md)                              |
| **8 polymorphic tools**   | `MODEL_CLASSES` registry — every model gets all 8        | [Polymorphic tools](../04-tools/polymorphic-tools.md)                               |
| **Form validation**       | `required`, `default`, `validation`, `enumValues`        | [Validation and defaults](./validation-and-defaults.md)                             |
| **App forms**             | `attributes` + `kinds` → `<input>` type per field        | [Model form](../05-apps/model-form.md)                                              |
| **Picker / multi-picker** | `belongsTo` / `hasMany` → recommended picker app         | [MCP apps](../05-apps/mcp-apps.md), [Associations](./associations.md)               |
| **Display rendering**     | `displayValue` + per-kind `render`                       | [Attributes and kinds](./attributes-and-kinds.md)                                   |
| **Search filters**        | `attributes` + the search request shaper                 | [Search filters](../06-the-three-layers-up-close/search-filters.md)                 |
| **API payload shape**     | `api.convention` (defaults to the server-wide one)       | [API convention](../06-the-three-layers-up-close/api-convention.md)                 |
| **Foreign-key columns**   | `associations.belongsTo` → `{key}_id` attribute          | [Associations](./associations.md)                                                   |
| **Graph edges**           | `associations` → `(record → target)` edges               | [Retrieval & GraphRAG](../09-retrieval-and-graphrag/retrieval-graphrag.md)          |
| **Embedding text**        | `attributes` (text/string fields concatenated)           | [Analysis quickstart](../09-retrieval-and-graphrag/analysis-quickstart.md)          |
| **Auto-generated docs**   | `description` + `attributes` + `associations`            | [Polymorphic tools](../04-tools/polymorphic-tools.md) (the `get_prompt_guide` tool) |

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

## What's next

Part I, Chapter 2 ends here. You have the full mental model of what a Model is, how it derives the framework's surfaces, and why the framework's folder structure splits declaration from consumption. [Chapter 3 — The Prompt](../03-the-prompt/) picks up with the first major consumer of the Model: the prompt that teaches an LLM how to fill the form your model defines.
