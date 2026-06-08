# Polymorphic tools

The previous chapter introduced the three layers every tool sees at runtime. This chapter looks at the tools the framework actually _ships_ — and explains why a small, fixed set of nine tools is enough to serve every model you'll ever define.

The polymorphic promise: **the LLM's tool list does not grow with your domain.** Add a tenth model to your server, and you do not add a tenth tool — the same 9 tools include the new model on next boot.

## The shape

```
                    Polymorphic surface (does not grow with N models)

   ┌─ CRUD ─────────────┐  ┌─ Form strategy ────┐  ┌─ Optional (extensions) ─┐
   │ list_models        │  │ get_prompt_guide   │  │ search_records          │
   │ find_records       │  │ validate_form      │  │ get_filters_guide       │
   │ create_model       │  │ get_form_summary   │  └─────────────────────────┘
   │ update_model       │  └────────────────────┘
   │ delete_model       │
   │ bulk_action_models │
   └────────────────────┘

   ┌──────────────────────────────────────────────────────────────────────────┐
   │                       Your models (any number)                            │
   │     Book   Author   Genre   Project   Task   Tag   Comment   …            │
   └──────────────────────────────────────────────────────────────────────────┘
```

Every tool takes a `model:` argument and uses the registry to look up the matching `ModelClass`. From the LLM's point of view it's "call `find_records` with `model: 'book'`", not "call `find_books`". When you add a model, the polymorphic dispatch picks it up automatically.

## The bundled nine

### CRUD — six tools that hit `DataLayer`

| Tool                 | What it does                                          | Reaches                         |
| -------------------- | ----------------------------------------------------- | ------------------------------- |
| `list_models`        | Lists every registered model + its schema summary     | `this.modelLayer` only — no I/O |
| `find_records`       | Paginated read for a model, with filters and includes | `this.dataLayer.list`           |
| `create_model`       | Validated write — runs schema + association passes    | `this.dataLayer.dispatch`       |
| `update_model`       | Same as create, but updates by id                     | `this.dataLayer.dispatch`       |
| `delete_model`       | Delete by id                                          | `this.dataLayer.dispatch`       |
| `bulk_action_models` | Batch create / update / delete in one call            | `this.dataLayer.dispatch`       |

All six are wired in via `DATA_TOOL_CLASSES` from `@mcp-rune/mcp-rune/tools`. In your `config.ts`:

File: `bookshelf/config.ts`

```ts
import {
  DATA_TOOL_CLASSES,
  FORM_STRATEGY_TOOL_CLASSES,
  ToolRegistry
} from '@mcp-rune/mcp-rune/tools'

new ToolRegistry({
  toolClasses: { ...DATA_TOOL_CLASSES, ...FORM_STRATEGY_TOOL_CLASSES },
  models: { book: Book, author: Author, genre: Genre }
  // …
})
```

There is no per-model wiring. `ToolRegistry` reads the `models:` map and the tools take it from there.

### Form-strategy — three tools that hit `ModelLayer`

| Tool               | What it does                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| `get_prompt_guide` | Returns the prompt content (chapter 3) for one model — the LLM's form filler |
| `validate_form`    | Runs the kind/association validators on a partial payload — no backend call  |
| `get_form_summary` | Returns the "what would I be submitting" human-readable summary              |

These three are STRATEGY-category tools. They don't take an authenticated `dataLayer` — `validate_form` deliberately can't write, because its purpose is to give the LLM cheap feedback before it commits. They consume `ModelLayer` for kind lookups and required-field checks, and `PromptRegistry` for the guide text.

### Two optional search tools

| Tool                | When you get it                              |
| ------------------- | -------------------------------------------- |
| `search_records`    | When the `search` ApiExtension is registered |
| `get_filters_guide` | Same                                         |

Both ship in `@mcp-rune/mcp-rune/data-layer/api-extensions/search`. They're not part of `DATA_TOOL_CLASSES` because not every backend has a search endpoint — opting in is a single line in `config.ts`. See [API extensions](../10-extensions/api-extensions.md).

## Why the surface stops at nine

The pattern the framework follows: **a polymorphic tool exists when its operation is uniform across models.** Six CRUD verbs are uniform — every model has find, list, create, update, delete, and a batched form of each. Three form-strategy operations are uniform — every model has a derivable prompt guide, a validatable form, and a summarizable payload.

Operations that are _not_ uniform across models — cancel a subscription, retry a payment, recompute a leaderboard — are intentionally **not** polymorphic. They are bespoke `BaseTool` subclasses you write per operation. The next chapter, [Tool creation](./tool-creation.md), covers that path.

## How the LLM discovers the surface

`list_models` is the entry point. The LLM calls it with `{}` and gets back every registered model plus a short attribute summary — that's enough to pick the right `model:` value for any subsequent CRUD call. From there:

```
list_models()             → "what exists?"
get_prompt_guide(book)    → "how do I fill the form?"
validate_form(book, …)    → "is this payload OK?"
create_model(book, …)     → "submit it"
find_records(book, …)     → "see what landed"
```

That's the loop the quickstart walked you through with `Book`. The same loop works for `Tag`, `Task`, `Project`, or anything else in your `models:` map, with zero per-model code on your side.

## See it running

The [`bookshelf`](https://github.com/mcp-rune/examples/tree/main/bookshelf) example exercises all nine tools end-to-end against three seed books. The [`bookshelf/TUTORIAL.md`](https://github.com/mcp-rune/examples/blob/main/bookshelf/TUTORIAL.md) walks through each call in order — it's the runnable companion to this chapter.

## What's next

When a bespoke verb doesn't fit the polymorphic shape, you reach for [Tool creation](./tool-creation.md) and write a `BaseTool` subclass. The next chapter covers the contract: `paramsSchema`, `category`, `execute`, the interceptor pipeline, and the moments you'd customize each.
