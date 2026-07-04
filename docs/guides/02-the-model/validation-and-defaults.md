# Validation and defaults

Attributes and associations declare _which fields exist_. This chapter covers the three small declarations that make a field **valid** — `required`, `default`, and `validation` — and explains where each one fires in the request lifecycle.

## Try it — required, default, enum, range

> Verified against rune CLI 0.11.0 · @mcp-rune/mcp-rune 0.107.0 · Node 24.

Four calls to `validate_form` against your `bookshelf-tour` project surface each of the declarations this chapter teaches. Add the fields below to `src/models/book.ts` and invoke `validate_form` after each one.

**Setup:** extend the `attributes` block in `src/models/book.ts`:

```ts file=examples/validation-and-defaults-01.ts
status: {
  type: 'enum',
  enumValues: ['unread', 'reading', 'finished'],
  default: 'unread',
  description: 'Reading state',
},
rating: {
  type: 'integer',
  validation: { min: 1, max: 5 },
  description: '1-to-5 personal rating',
},
```

```js file=examples/validation-and-defaults-01.js
/**
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * status: {
 *   type: 'enum',
 *   enumValues: ['unread', 'reading', 'finished'],
 *   default: 'unread',
 *   description: 'Reading state',
 * },
 * rating: {
 *   type: 'integer',
 *   validation: { min: 1, max: 5 },
 *   description: '1-to-5 personal rating',
 * },
 */
```

(If you completed the [Associations](./associations.md) hands-on, your `Book` model still has `belongsTo: author`. Keep it — you'll need an integer `author_id` in the calls below.)

**1. `required` — `validate_form` blocks an empty submission**

Call `validate_form` with `{ "model": "book", "fields": {} }`:

```json
{
  "valid": false,
  "ready_to_submit": false,
  "errors": [
    { "field": "name", "message": "Name is required" },
    { "field": "author_id", "message": "ID of the author is required" }
  ],
  "warnings": ["Using default for status: unread"],
  "computed": { "status": "unread" },
  "fields": { "status": "unread" }
}
```

Two required fields block the submit: `name`, and the `author_id` FK synthesised by the `belongsTo: author` association you kept from the [Associations](./associations.md) guide. `status` is absent too, but it carries a `default:` — so instead of an error you get a warning and the substituted value under `computed` / `fields`. There is no `required: false`; absence is the default, and the whole pass runs without a backend round trip — the contract the LLM relies on.

**2. `default:` — the value is substituted before submit**

Call `validate_form` with `{ "model": "book", "fields": { "name": "Dune", "author_id": 1 } }`:

```json
{
  "valid": true,
  "ready_to_submit": true,
  "errors": [],
  "warnings": ["Using default for status: unread"],
  "computed": { "status": "unread" },
  "fields": { "status": "unread", "name": "Dune", "author_id": 1 }
}
```

`status` was missing; the framework substituted the static `default:` and echoed it back under both `computed` and `fields`. The warning tells the LLM the default was applied so it can re-prompt if the user wanted to be explicit.

**3. `enumValues:` — an out-of-set value is rejected**

Call `validate_form` with `{ "model": "book", "fields": { "name": "Dune", "author_id": 1, "status": "bogus" } }`:

```json
{
  "valid": false,
  "ready_to_submit": false,
  "errors": [
    {
      "field": "status",
      "message": "status must be one of: unread, reading, finished (got \"bogus\")"
    }
  ],
  "warnings": [],
  "computed": {},
  "fields": { "name": "Dune", "author_id": 1, "status": "bogus" }
}
```

`enumValues:` is its own validation — the message lists the allowed set, which is what the LLM reads to retry.

**4. `validation: { min, max }` — unrecognized keys, so nothing fires**

Call `validate_form` with `{ "model": "book", "fields": { "name": "Dune", "author_id": 1, "rating": 99 } }`:

```json
{
  "valid": true,
  "ready_to_submit": true,
  "errors": [],
  "warnings": ["Using default for status: unread"],
  "computed": { "status": "unread" },
  "fields": { "status": "unread", "name": "Dune", "author_id": 1, "rating": 99 }
}
```

`rating: 99` passes silently because `min` and `max` are **not recognized validation keys** — nothing in the framework reads them, at form time or any other time. The validator reads `minimum` / `maximum` for numeric bounds; the setup block above deliberately uses the wrong spelling so you can see the failure mode (the `validation` type carries an open index signature, so the typo also typechecks). Redeclare the field as `validation: { minimum: 1, maximum: 5 }` and the same call rejects `rating: 99` at validate-form time. (`enumValues` and `required` _do_ fire here regardless, as steps 1–3 show.)

**Observe:** every recognized declaration short-circuits before any network call — that's the point of `validate_form`. The step-4 gotcha is not a deferred validation pass; it's a key-name mismatch. Spell the keys the validator reads — listed under [`validation: { … }`](#validation---) below — and bounds fire in the same pass as `required` and `enumValues`.

## `required: true`

Marks the attribute as mandatory. The framework treats this as a contract that's checked in two places:

1. **At form-validate time** — `validate_form` returns a structured failure that names the missing field, so the LLM can re-prompt without making the round trip to the backend.
2. **At dispatch time** — the default `ModelService` adapter rejects a create payload that's missing a required field before your backend sees the request; custom `DataLayer`s own this check themselves.

File: `tasks/models/task.ts`

```ts file=examples/validation-and-defaults-02.ts
static override attributes: Record<string, AttributeDefinition> = {
  title: {
    type: 'string',
    required: true,
    description: 'One-line summary of the task'
  },
  // …
}
```

```js file=examples/validation-and-defaults-02.js
static attributes = {
  title: {
    type: 'string',
    required: true,
    description: 'One-line summary of the task'
  },
  // …
}
```

`required: true` on a `belongsTo` association behaves the same way — the inferred `{key}_id` attribute (e.g. `project_id`) becomes mandatory.

There is no `required: false`; absence of the field is the default.

## `default: <value>`

Supplied at form-fill time when the field is missing. Two important properties:

- The default is applied by **the framework**, before validation and before the backend sees the payload. Your backend never sees an unset field that had a default.
- The value is read from the static `AttributeDefinition`; it's not a function call, so dynamic defaults (like "today's date") are not supported here. Override `getDefaultFormState()` on your Prompt class if you need a runtime value.

```ts file=examples/validation-and-defaults-03.ts
status: {
  type: 'enum',
  enumValues: ['todo', 'doing', 'done'],
  default: 'todo'
},
priority: {
  type: 'enum',
  enumValues: ['low', 'medium', 'high'],
  default: 'medium'
}
```

```js file=examples/validation-and-defaults-03.js
/**
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * status: {
 *   type: 'enum',
 *   enumValues: ['todo', 'doing', 'done'],
 *   default: 'todo'
 * },
 * priority: {
 *   type: 'enum',
 *   enumValues: ['low', 'medium', 'high'],
 *   default: 'medium'
 * }
 */
```

A `default:` and `required: true` are not contradictory — they describe two different things. `required` means "this field must end up in the payload"; `default` means "if the caller didn't supply one, use this". Most required-with-default fields will never actually need to be supplied by the caller.

## `validation: { … }`

Numeric bounds, length bounds, and regex patterns. These fire at **validate-form time** — `BaseFormStrategy.validateField` runs every recognized key on each `validate_form` call, in the same pass as `required` and `enumValues`.

File: `bookshelf/models/book.ts`

```ts file=examples/validation-and-defaults-04.ts
rating: {
  type: 'integer',
  description: 'Your rating from 1 to 5',
  validation: { minimum: 1, maximum: 5 }
}
```

```js file=examples/validation-and-defaults-04.js
/**
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * rating: {
 *   type: 'integer',
 *   description: 'Your rating from 1 to 5',
 *   validation: { minimum: 1, maximum: 5 }
 * }
 */
```

Recognized keys:

- `minimum`, `maximum` — numeric range (applies to `integer`, `decimal`)
- `minLength`, `maxLength` — string length (applies to `string`, `text`)
- `pattern`, `patternMessage` — a `RegExp` the value must match, plus an optional custom error message

`min` and `max` are **not** recognized keys — a `validation: { min: 1, max: 5 }` block typechecks (the type carries an open index signature) but is silently ignored, which is exactly what step 4 of the [Try it](#try-it--required-default-enum-range) section demonstrates.

Cross-field rules don't live here — they go on the kind itself (custom kinds with a `validate(v)` function; see the previous chapter) or in a domain `BusinessRule` (see [Domain Knowledge](../08-domain-knowledge/domain-knowledge.md)).

### Bounded values: the `max:` knob and the rating kind

For the common "score out of N" case, the framework's first-class mechanism is not a `validation:` block at all — it's the top-level `max?: number` knob on `AttributeDefinition`, consumed by the `rating` kind:

```ts file=examples/validation-and-defaults-05.ts
rating: {
  type: 'integer',
  format: 'rating',
  max: 5,
  description: 'Your rating from 1 to 5'
}
```

```js file=examples/validation-and-defaults-05.js
/**
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * rating: {
 *   type: 'integer',
 *   format: 'rating',
 *   max: 5,
 *   description: 'Your rating from 1 to 5'
 * }
 */
```

The `rating` kind reads `max` (default `5`) in both halves of its contract: `validate` rejects values outside `0..max` ("must be between 0 and 5"), and `describe` renders the LLM-facing summary as `3/5`. Declaring the bound this way keeps the number in one place for validation, prompt text, and display.

## `enumValues:` is a validation

Listing `enumValues:` on an `enum` attribute is itself a validation rule — `validate_form` will reject any value not in the list, naming the allowed values in the failure message.

```ts file=examples/validation-and-defaults-06.ts
status: {
  type: 'enum',
  enumValues: ['unread', 'reading', 'completed'],
  default: 'unread'
}
```

```js file=examples/validation-and-defaults-06.js
/**
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * status: {
 *   type: 'enum',
 *   enumValues: ['unread', 'reading', 'completed'],
 *   default: 'unread'
 * }
 */
```

For dynamic enums (values pulled from another table), don't use `enum` — use a `belongsTo` association to the table that owns the canonical set. The picker app will surface the same UX with live values.

## When validation fires

The framework runs two passes, in order, every time a write tool is called.

```
caller payload
      │
      ▼
┌────────────────────────────────────────────┐
│ 1. Field validation (kinds + validation:)  │  Wrong type? Bad ISBN? Missing required?
│    — synthesized FK fields included        │  Out-of-set enum? author_id absent?
└────────────────────┬───────────────────────┘
                     │  (fail → structured error, no backend call)
                     ▼
┌────────────────────────────────────────────┐
│ 2. DataLayer.dispatch — backend sees it    │  Backend's own checks (referential
└────────────────────────────────────────────┘  integrity, DB constraints, etc.)
```

`validate_form` runs only pass 1 — it's the cheap, no-side-effect call the LLM uses to check work-in-progress. `create_model` / `update_model` run both. Note that the FK fields synthesized from associations are validated as ordinary fields (present, well-formed); whether an ID resolves to a real record is the backend's check in pass 2.

## Defaults vs prompt defaults — don't confuse them

The `default:` on a model attribute is a **payload default** — the value the framework substitutes when the field is missing from the payload. It's a static value, declared on the model.

A prompt can also declare **prompt-time defaults** that pre-fill form fields before the user (or LLM) sees them. Those live on the `Prompt` class, not the `Model`, and they can be dynamic functions of the current request. See [Prompt Creation](../03-the-prompt/prompt-creation.md) for that mechanism.

The rule of thumb: if the default is true for every record regardless of context, put it on the Model. If it depends on the current user, the current time, or the current parent record, put it on the Prompt.

## What's next

You've now seen what a Model is, how its attributes work, how associations stitch models together, and how validation closes the loop. The next chapter, [Definition vs consumption](./definition-vs-consumption.md), zooms back out to the architectural seam: why your `models/` folder holds only declarations and the helpers that read them live in sibling layers (`model-layer/`, `data-layer/`, `analysis-layer/`). That split is the foundation of chapter 4's three-layer DI story.
