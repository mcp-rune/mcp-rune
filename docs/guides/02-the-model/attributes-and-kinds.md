# Attributes and kinds

The previous chapter showed the `attributes` block as a flat map of names to definitions. This chapter zooms into one entry of that map. The `type:` literal you wrote (`'string'`, `'enum'`, `'datetime'`) selects a **kind** — a single object that knows how the value moves between your API, the framework's internal representation, the HTML `<input>`, the LLM-facing summary, and the validator. One declaration drives all of them.

## Try it — watch three representations move

> Verified against rune CLI 0.11.0 · @mcp-rune/mcp-rune 0.103.0 · Node 24.

Three calls against your `bookshelf-tour` project surface three of the
representations the diagram below maps. Run them and match the output
before reading the kind taxonomy.

**1. API representation — `list_models` shows the wire shape**

`list_models` with `{}` reports the attribute names and types the
framework will accept on the wire. For the scaffolded `book`:

```json
{
  "name": "book",
  "attributes": ["name", "description"],
  "required_attributes": ["name"]
}
```

`name` is a `string` kind, `description` is a `text` kind — both selected
by the `type:` literal in `src/models/book.ts`.

**2. Validation representation — `validate_form` exercises the kind's `validate` method**

Call `validate_form` with `{ "model": "book", "fields": {} }`:

```json
{
  "valid": false,
  "ready_to_submit": false,
  "errors": [{ "field": "name", "message": "Name is required" }],
  "warnings": [],
  "computed": {},
  "fields": {}
}
```

The error message is shaped by two things: the `required: true` flag on
the `name` attribute (the rule) and the kind's `describe()` (the
`"Name"` label). Change the `description:` text in `book.ts` and the
message updates on next boot.

**3. LLM representation — `get_prompt_guide` calls every kind's `describe`**

Call `get_prompt_guide` with `{ "guide_name": "book" }`. The bottom of
the response is a Markdown table the LLM reads to fill the form:

```
| Attribute     | Type   | Required | Valid Values |
|---------------|--------|----------|--------------|
| name          | string | Yes      |              |
| description   | text   | No       |              |
```

Each row is the kind reporting itself. Switch `description` from `'text'`
to a different built-in (e.g. `'string'`) in `src/models/book.ts`, save,
re-run, and watch the row update — no template lives in your prompt
class for this content.

**Observe:** one `type:` literal selects the wire parser, the
validation message, and the LLM-facing type label simultaneously. Now
the rest of this guide is the taxonomy of which kinds you have to
choose from and what each one ships.

---

An **attribute kind** describes how a single attribute value moves through three representations:

```
API value  ⇄  internal value  ⇄  HTML <input> value
   (parse / serialize)        (fromInput / toInput)
   describe(internal) -> string   (LLM-facing summary)
   validate(internal) -> string | null   (kind-aware errors)
   format(internal)  -> DOM Node   (display rendering, browser only)
```

A concrete walk-through — an ISBN attribute declared as `string:isbn` — makes the boundaries obvious:

<!-- illustration: attribute-kinds#hub -->

```
   API JSON                                       HTML form input
   { isbn: "9780132350884" }                      <input value="9780132350884">
            │                                                 ▲
            │ parse(api)                       toInput(internal)
            ▼                                                 │
   ┌──────────────────────────────────────────────────────────┴──┐
   │                  Internal value                              │
   │                  "9780132350884"  (normalized, hyphens out)  │
   └─────────┬───────────────┬─────────────────────┬──────────────┘
             │               │                     │
   serialize │   describe    │      validate       │  format
             ▼               ▼                     ▼
   API JSON          "ISBN-13: 978-0-13-235088-4"  "ok"  →  <code>9780132350884</code>
   { isbn: "..." }   (LLM-facing summary,          | null    (DOM node, browser
                      humanized)                   | error    only)
                                                   |  msg
```

Every kind plugs into the same six methods. Override one, all, or none — defaults fall back to `String(value)`.

mcp-rune ships 17 built-in kinds (`string`, `integer`, `boolean`, `date`, `enum`, `array`, `email`, `url`, `uuid`, `json`, `color`, `rating`, …). The same kind taxonomy is used by:

- The polymorphic **form generator** to pick the right `<input type="…">`.
- The **iframe display layer** (`find-model-app`, `show-model-app`, `view-selection-app`) to render cells.
- The **prompt system** to set the type label LLMs see in attribute-reference tables.
- The **`validate_form` tool** to reject malformed inputs (`uuid`, `email`, `date`, `json`, …) before they hit the API.
- The **server-side prompt summary** so the LLM's mental model of the form state matches what the user just saw on screen (boolean → `Yes`/`No`, enum → humanized label, base64 → `(binary)`).

A deployer extends this taxonomy through a single declarative channel — `AppRegistry.formatters` — and both browser and server pick the change up automatically.

## Table of Contents

- [Built-in Kinds](#built-in-kinds)
- [The `KindDescriptor` Contract](#the-kinddescriptor-contract)
- [Three Extension Paths](#three-extension-paths)
- [`getKind` Lookup Rules](#getkind-lookup-rules)
- [Worked Example: ISBN as `string:isbn`](#worked-example-isbn-as-stringisbn)
- [Worked Example: Currency Kind via `registerKind`](#worked-example-currency-kind-via-registerkind)
- [Worked Example: DOM-Only Override](#worked-example-dom-only-override)
- [How a Kind Flows Through the System](#how-a-kind-flows-through-the-system)
- [Testing Custom Kinds](#testing-custom-kinds)
- [Migrating from v0.50 `formatterScript`](#migrating-from-v050-formatterscript)

## Built-in Kinds

All 17 kinds are registered in `src/mcp/models/kinds/` — one file per built-in kind. Browser-side display rendering (`render()`) for kinds whose output is more than `helpers.text(String(value))` lives in `src/mcp/apps/shared/kind-renderers.ts`.

| Kind       | `htmlInputType`  | `promptType` | `describe` example               |
| ---------- | ---------------- | ------------ | -------------------------------- |
| `string`   | `text`           | `string`     | `Clean Code`                     |
| `text`     | `textarea`       | `text`       | `A book about software craft.`   |
| `integer`  | `number`         | `integer`    | `42`                             |
| `decimal`  | `number`         | `number`     | `3.14`                           |
| `boolean`  | `checkbox`       | `boolean`    | `Yes` / `No`                     |
| `date`     | `date`           | `date`       | `2026-05-28`                     |
| `datetime` | `datetime-local` | `datetime`   | `2026-05-28T14:30:00.000Z`       |
| `time`     | `time`           | `time`       | `14:30`                          |
| `enum`     | `text`           | `enum`       | `In Progress` (humanized)        |
| `array`    | `text`           | `array`      | `Physical, Pdf` (humanized join) |
| `uuid`     | `text`           | `uuid`       | `550e8400-e29b-41d4-…`           |
| `json`     | `textarea`       | `object`     | `{"foo":1}`                      |
| `color`    | `color`          | `string`     | `#0a84ff`                        |
| `email`    | `email`          | `string`     | `alice@example.com`              |
| `url`      | `url`            | `string`     | `https://example.com`            |
| `base64`   | `text`           | `string`     | `(binary)`                       |
| `rating`   | `number`         | `integer`    | `3/5`                            |

`describe` is the LLM-facing summary — it's what shows up in `generate_form_summary` and in the human-readable section of `validate_form` responses. It deliberately humanizes (`Yes`/`No`, not `true`/`false`; `In Progress`, not `in_progress`) so the LLM's mental model of the form state matches what the user saw on screen.

## The `KindDescriptor` Contract

```ts file=src/kind-opts.ts
import type { KindDescriptor, KindOpts } from '@mcp-rune/mcp-rune/core'

interface KindOpts {
  format?: string
  enumValues?: string[]
  max?: number
}

interface KindDescriptor {
  htmlInputType: string
  promptType: string
  label: string
  describe(value: unknown, opts?: KindOpts): string
  validate(value: unknown, opts?: KindOpts): string | null
  parse(api: unknown, opts?: KindOpts): unknown
  serialize(internal: unknown, opts?: KindOpts): unknown
  toInput(internal: unknown, opts?: KindOpts): string
  fromInput(raw: string, opts?: KindOpts): unknown
}
```

```js file=src/kind-opts.js
/**
 * Per-attribute kind configuration. Passed to every KindDescriptor method
 * so kinds can specialize (e.g. `format: 'iso8601'` for dates).
 *
 * @typedef {Object} KindOpts
 * @property {string} [format]
 * @property {string[]} [enumValues]
 * @property {number} [max]
 */

/**
 * The contract a kind implementation satisfies. Each method receives the
 * value plus the per-attribute opts; together they handle the three
 * representations (wire / validation / render).
 *
 * @typedef {Object} KindDescriptor
 * @property {string} htmlInputType
 * @property {string} promptType
 * @property {string} label
 * @property {(value: unknown, opts?: KindOpts) => string} describe
 * @property {(value: unknown, opts?: KindOpts) => string | null} validate
 * @property {(api: unknown, opts?: KindOpts) => unknown} parse
 * @property {(internal: unknown, opts?: KindOpts) => unknown} serialize
 * @property {(internal: unknown, opts?: KindOpts) => string} toInput
 * @property {(raw: string, opts?: KindOpts) => unknown} fromInput
 */
```

Each method has a precise role. Read them as a contract between three caller groups:

- **`form-schema.ts` (server)** reads `htmlInputType` when generating `FormFieldDefinition.type` so the iframe knows which `<input>` widget to render.
- **`schema-derivation.ts` (server)** reads `promptType` to populate the "Type" column of LLM-facing attribute reference tables.
- **`shared/model-form/main.js` (iframe)** calls `parse(apiValue)` to hydrate the form from a record, then `toInput(internal)` to write the `<input value="…">`. On submit, it calls `fromInput(rawString)` then `serialize(internal)` to produce the API payload.
- **`find-model-app-ui` / `show-model-app-ui` / `view-selection-app-ui`** call `parse` then `format` (the DOM-returning function from `formatters.ts`, which is layered on top of the descriptor and not part of it).
- **`HybridStrategy.generateHumanSummary` and `BasePrompt.generateHumanReadableSummary`** (server) call `describe(value)` for every populated field so the LLM-facing summary mirrors the iframe's `format()` output.
- **`BaseStrategy.validateField` (server)** calls `validate(value)` for kind-aware error messages. Range / length / pattern checks from `FieldValidation` are orthogonal and live in `base-strategy.ts`.

`parse / serialize / toInput / fromInput` follow the standard rule: `parse` accepts whatever the API gave you (string, number, boolean, null); `toInput` produces a value the HTML `<input>` is happy with (always a string); `fromInput` accepts the raw `<input>.value` string; `serialize` returns the shape your API expects.

## Two Extension Paths

| Path                            | When to use                                                                                     | Channel                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **`AppRegistry({ kinds })`**    | New kind your deployment needs (ISBN, currency, phone), or override fields on a built-in.       | `kinds: Record<string, KindExtension>` — descriptor half registers server-side; `render` half flows into the iframe. |
| **`registerKindRenderer(...)`** | DOM-only widget change for an existing kind (slider for `rating`, gradient swatch for `color`). | `registerKindRenderer(kind, { render }, { format })` from `@mcp-rune/mcp-rune/apps/kind-renderers`. Iframe-only.     |

`AppRegistry({ kinds })` is the canonical path — one entry per kind covers behavior (parse, validate, label, htmlInputType, promptType) AND rendering. `registerKindRenderer` exists only for DOM widget overrides on a kind already defined elsewhere.

### The `KindExtension` shape

```ts file=src/kind-extension.ts
import type { KindExtension, KindDescriptor, KindRenderHint } from '@mcp-rune/mcp-rune/apps'

// KindExtension = Partial<KindDescriptor> & { render?: KindRenderHint }
//
// Partial<KindDescriptor>: label, htmlInputType, promptType, plus the
//   functions parse / serialize / toInput / fromInput / describe / validate.
//   These run server-side (and in the browser when the bundle ships them).
//
// KindRenderHint: declarative DOM rendering forwarded to the iframe runtime
//   through `window.__MCP_RUNE_KIND_RENDERERS__`. A closed allowlist of
//   operations (template, Intl locale, badge variant) so the channel is
//   CSP-safe — no inline JS is ever executed.

interface KindRenderHint {
  template?: string // "{value}" substitution
  locale?: string // Intl.DateTimeFormat
  dateStyle?: 'full' | 'long' | 'medium' | 'short'
  timeStyle?: 'full' | 'long' | 'medium' | 'short'
  badge?: { icon?: string; className?: string }
}
```

```js file=src/kind-extension.js
/**
 * KindExtension = Partial<KindDescriptor> & { render?: KindRenderHint }
 *
 * Partial<KindDescriptor>: label, htmlInputType, promptType, plus the
 *   functions parse / serialize / toInput / fromInput / describe / validate.
 *   These run server-side (and in the browser when the bundle ships them).
 *
 * KindRenderHint: declarative DOM rendering forwarded to the iframe runtime
 *   through `window.__MCP_RUNE_KIND_RENDERERS__`. A closed allowlist of
 *   operations (template, Intl locale, badge variant) so the channel is
 *   CSP-safe — no inline JS is ever executed.
 *
 * @typedef {Object} KindRenderHint
 * @property {string} [template]   `{value}` substitution
 * @property {string} [locale]     Intl.DateTimeFormat
 * @property {'full' | 'long' | 'medium' | 'short'} [dateStyle]
 * @property {'full' | 'long' | 'medium' | 'short'} [timeStyle]
 * @property {{ icon?: string, className?: string }} [badge]
 */
```

The descriptor half (functions and metadata) registers with `src/mcp/models/kinds/` at `AppRegistry` construction time and runs on the server. Only the `render` hint serializes into the iframe via `AppRegistry.injectIntoHead` as `window.__MCP_RUNE_KIND_RENDERERS__`. One config entry, one mental model.

## `getKind` Lookup Rules

```ts file=examples/attribute-kinds-guide-03.ts
import { getKind } from '@mcp-rune/mcp-rune/models'

getKind('string', 'isbn') // 1. exact kind:format narrowing
getKind('string', 'url') // 2. format hop — 'url' is a top-level kind
getKind('uuid') // 3. base kind
getKind('totally-fake') // 4. falls back to 'string'
```

```js file=examples/attribute-kinds-guide-03.js
import { getKind } from '@mcp-rune/mcp-rune/models'
getKind('string', 'isbn') // 1. exact kind:format narrowing
getKind('string', 'url') // 2. format hop — 'url' is a top-level kind
getKind('uuid') // 3. base kind
getKind('totally-fake') // 4. falls back to 'string'
```

Both arguments are case-insensitive (`getKind('URL')` and `getKind('url')` are the same). The format-hop fallback (step 2) is what makes JSON-schema-style `format: 'email'` or `format: 'date-time'` work without each deployer registering every narrowing.

## Worked Example: ISBN as `string:isbn`

Suppose your books have an `isbn` attribute and you want:

- A text input with an ISBN pattern check on submit.
- The display layer to prefix `ISBN: ` before the value.
- The LLM-facing prompt docs to say "ISBN" instead of "string."
- A clear label in the form.

```ts file=src/registries/app-registry.ts
// your-server/config.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { MODEL_CLASSES } from './models'

export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookshelf',
  kinds: {
    'string:isbn': {
      label: 'ISBN',
      htmlInputType: 'text',
      promptType: 'string',
      validate: (v) => {
        if (v === null || v === undefined || v === '') return null
        const s = String(v)
        if (s.length < 10 || s.length > 17) return 'ISBN must be 10–17 characters'
        return /^(?:97[89][- ]?)?(?:\d[- ]?){9}[\dX]$/.test(s) ? null : 'invalid ISBN'
      },
      render: { template: 'ISBN: {value}' }
    }
  }
})
```

```js file=src/registries/app-registry.js
// your-server/config.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { MODEL_CLASSES } from './models'
export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookshelf',
  kinds: {
    'string:isbn': {
      label: 'ISBN',
      htmlInputType: 'text',
      promptType: 'string',
      validate: (v) => {
        if (v === null || v === undefined || v === '') return null
        const s = String(v)
        if (s.length < 10 || s.length > 17) return 'ISBN must be 10–17 characters'
        return /^(?:97[89][- ]?)?(?:\d[- ]?){9}[\dX]$/.test(s) ? null : 'invalid ISBN'
      },
      render: { template: 'ISBN: {value}' }
    }
  }
})
```

Declare the kind on the model attribute:

```ts file=src/book.ts
class Book extends BaseModel {
  static attributes = {
    isbn: { type: 'string', format: 'isbn', label: 'ISBN' }
    // …
  }
}
```

```js file=src/book.js
class Book extends BaseModel {
  static attributes = {
    isbn: { type: 'string', format: 'isbn', label: 'ISBN' }
    // …
  }
}
```

Now:

- `show-model-app-ui` and `find-model-app-ui` render `ISBN: 978-0-13-235088-4`.
- `new-model-app` / `edit-model-app` render `<input type="text">` for the create/update form (via shared `shared/model-form/main.js`).
- `validate_form` rejects values that don't match the pattern or are outside 10–17 chars.
- The prompt's attribute reference table says **ISBN** in the "Type" column.

One declaration, four surfaces.

## Worked Example: Currency Kind

Custom `parse` / `serialize` logic is just function fields on the same `KindExtension`. No separate "imperative" path:

```ts file=examples/attribute-kinds-guide-06.ts
// your-server/registries/app-registry.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'invoicing',
  kinds: {
    currency: {
      label: 'Currency',
      htmlInputType: 'number',
      promptType: 'number',
      parse: (v) => {
        if (v === null || v === undefined || v === '') return null
        if (typeof v === 'number') return v
        return Number(String(v).replace(/[^0-9.-]/g, ''))
      },
      serialize: (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : null),
      describe: (v) => {
        if (v === null || v === undefined) return ''
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
          Number(v)
        )
      },
      toInput: (v) => (v === null || v === undefined ? '' : String(v)),
      fromInput: (v) => (v === '' ? null : Number(v)),
      validate: (v) => {
        if (v === null || v === undefined || v === '') return null
        return typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number'
      }
    }
  }
})
```

```js file=examples/attribute-kinds-guide-06.js
// your-server/registries/app-registry.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
export const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'invoicing',
  kinds: {
    currency: {
      label: 'Currency',
      htmlInputType: 'number',
      promptType: 'number',
      parse: (v) => {
        if (v === null || v === undefined || v === '') return null
        if (typeof v === 'number') return v
        return Number(String(v).replace(/[^0-9.-]/g, ''))
      },
      serialize: (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : null),
      describe: (v) => {
        if (v === null || v === undefined) return ''
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
          Number(v)
        )
      },
      toInput: (v) => (v === null || v === undefined ? '' : String(v)),
      fromInput: (v) => (v === '' ? null : Number(v)),
      validate: (v) => {
        if (v === null || v === undefined || v === '') return null
        return typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number'
      }
    }
  }
})
```

At `AppRegistry` construction the descriptor half registers with the shared kind registry; server-side prompt summaries, form-schema generation, and `validate_form` all pick it up immediately. Call `validateRegistries(...)` _after_ construction so the boot-time guard sees deployer-defined kinds.

> The framework also exports `registerKind(...)` from `@mcp-rune/mcp-rune/models` for tests and framework-internal callers. Application code should configure kinds through `AppRegistry({ kinds })` so there's one extension point to find.

## Worked Example: DOM-Only Override

Sometimes you want to keep a kind's contract intact but change the rendered widget. Example: render `rating` as a slider instead of stars.

```ts file=src/max.ts
// your-server/apps/rating-slider.js
import { registerKindRenderer, helpers } from '@mcp-rune/mcp-rune/apps/kind-renderers'

registerKindRenderer('rating', {
  render: (value, opts) => {
    const max = opts?.column?.max ?? 5
    const span = document.createElement('span')
    span.textContent = `${value}/${max}`
    span.style.background = 'linear-gradient(to right, gold, gold)'
    span.style.backgroundSize = `${(Number(value) / max) * 100}% 100%`
    span.style.backgroundRepeat = 'no-repeat'
    return span
  }
})
```

```js file=src/max.js
// your-server/apps/rating-slider.js
import { registerKindRenderer } from '@mcp-rune/mcp-rune/apps/kind-renderers'
registerKindRenderer('rating', {
  render: (value, opts) => {
    const max = opts?.column?.max ?? 5
    const span = document.createElement('span')
    span.textContent = `${value}/${max}`
    span.style.background = 'linear-gradient(to right, gold, gold)'
    span.style.backgroundSize = `${(Number(value) / max) * 100}% 100%`
    span.style.backgroundRepeat = 'no-repeat'
    return span
  }
})
```

`registerKindRenderer` is **DOM-only**. It accepts only `{ render: (value, opts) => Node }` and throws if you try to pass `parse`, `serialize`, or any other key — those belong in the kind descriptor (configured via `AppRegistry({ kinds })`). The deliberate narrowing prevents drift where the server-side prompts and validation diverge from what the iframe rendered.

To register a brand-new kind, use `AppRegistry({ kinds })` above. `registerKindRenderer` only overrides the DOM rendering of an existing kind.

## How a Kind Flows Through the System

Trace a single `published_at` attribute (`type: 'datetime'`) from definition to LLM and back:

1. **Attribute definition** on the model: `published_at: { type: 'datetime', description: 'Publish timestamp' }`.

2. **Prompt docs**: `schema-derivation.ts` calls `getKind('datetime').promptType` → `'datetime'`. Renders in the LLM-facing attribute reference table.

3. **Form schema**: `form-schema.ts` calls `getKind('datetime').htmlInputType` → `'datetime-local'`. Renders as `<input type="datetime-local">` in the form-app iframes.

4. **Form prefill**: `shared/model-form/main.js` receives an API value `"2026-05-28T14:30:00Z"`, calls `getKindRenderer('datetime').parse(...)` → `Date`, then `.toInput(date)` → `"2026-05-28T14:30"`. Sets the `<input value="…">`.

5. **Cell rendering** in find-model-app: `renderCellValue(apiValue, column)` calls `getKindRenderer('datetime').render(parsedDate)` → a `<span>` with a localized "May 28, 2026, 2:30 PM" (locale overridable via `kinds.datetime.render.locale`).

6. **Form submit**: user changes the input to `"2026-06-01T09:00"`. `shared/model-form/main.js` calls `getKindRenderer('datetime').fromInput(raw)` → `Date`, then `.serialize(date)` → `"2026-06-01T09:00:00.000Z"`. Sent to the API.

7. **`validate_form`**: if the user instead pasted `"garbage"`, `BaseStrategy.validateField` calls `getKind('datetime').validate('garbage')` → `'must be a valid datetime'`. The tool returns the error before any API call.

8. **LLM summary**: when the prompt's `generate_form_summary` runs, `HybridStrategy.generateHumanSummary` calls `getKind('datetime').describe(date)` → full ISO string. The LLM sees the same value the iframe just displayed (in ISO form for unambiguous downstream reasoning).

Same kind, eight call sites, one descriptor.

## Testing Custom Kinds

Test the descriptor's pure functions directly:

```ts file=examples/attribute-kinds-guide-09.ts
import { getKind } from '@mcp-rune/mcp-rune/models'
import './kinds/currency' // ← side-effect import to register

describe('currency kind', () => {
  it('parses string with $ sign to number', () => {
    expect(getKind('currency').parse('$1,234.56')).toBe(1234.56)
  })

  it('describe humanizes for LLM summary', () => {
    expect(getKind('currency').describe(1234.5)).toBe('$1,234.50')
  })

  it('validate rejects non-numbers', () => {
    expect(getKind('currency').validate('not a number')).toBe('must be a number')
  })
})
```

```js file=examples/attribute-kinds-guide-09.js
import { getKind } from '@mcp-rune/mcp-rune/models'
import './kinds/currency' // ← side-effect import to register
describe('currency kind', () => {
  it('parses string with $ sign to number', () => {
    expect(getKind('currency').parse('$1,234.56')).toBe(1234.56)
  })
  it('describe humanizes for LLM summary', () => {
    expect(getKind('currency').describe(1234.5)).toBe('$1,234.50')
  })
  it('validate rejects non-numbers', () => {
    expect(getKind('currency').validate('not a number')).toBe('must be a number')
  })
})
```

Round-trips:

```ts file=src/k.ts
it('round-trips through input', () => {
  const k = getKind('currency')
  const api = '$42.99'
  const internal = k.parse(api)
  const inputValue = k.toInput(internal)
  const back = k.fromInput(inputValue)
  expect(k.serialize(back)).toBe(42.99)
})
```

```js file=src/k.js
it('round-trips through input', () => {
  const k = getKind('currency')
  const api = '$42.99'
  const internal = k.parse(api)
  const inputValue = k.toInput(internal)
  const back = k.fromInput(inputValue)
  expect(k.serialize(back)).toBe(42.99)
})
```

The DOM `format()` is tested in `happy-dom`:

```ts file=src/node.ts
/**
 * @vitest-environment happy-dom
 */
import { getKindRenderer } from '@mcp-rune/mcp-rune/apps/kind-renderers'

it('rating renders a custom widget after override', () => {
  // your registerKindRenderer override must run before this test
  const node = getKindRenderer('rating').render(3, { column: { max: 5 } })
  expect(node.textContent).toBe('3/5')
})
```

```js file=src/node.js
/**
 * @vitest-environment happy-dom
 */
import { getKindRenderer } from '@mcp-rune/mcp-rune/apps/kind-renderers'
it('rating renders a custom widget after override', () => {
  // your registerKindRenderer override must run before this test
  const node = getKindRenderer('rating').render(3, { column: { max: 5 } })
  expect(node.textContent).toBe('3/5')
})
```

## Migrating from `AppRegistry.formatters`

Pre-v0.79 the deployer extension was `AppRegistry({ formatters })` with a `FormatterDescriptor` shape that mixed kind-definitional fields, iframe-only validation hints, and a never-implemented `parser` block. v0.79 unifies it into `AppRegistry({ kinds })` with a single `KindExtension` per kind: descriptor fields run server-side; only `render` reaches the iframe.

```ts file=examples/attribute-kinds-guide-12.ts
// BEFORE (pre-0.79)
formatters: {
  'string:isbn': {
    label: 'ISBN',
    htmlInputType: 'text',
    validation: { pattern: '^[0-9-]+$', minLength: 10, maxLength: 17 },
    display: { template: 'ISBN: {value}' }
  }
}

// AFTER (0.79+)
kinds: {
  'string:isbn': {
    label: 'ISBN',
    htmlInputType: 'text',
    validate: (v) =>
      typeof v === 'string' && /^[0-9-]+$/.test(v) && v.length >= 10 && v.length <= 17
        ? null
        : 'must be an ISBN',
    render: { template: 'ISBN: {value}' }
  }
}
```

```js file=examples/attribute-kinds-guide-12.js
// BEFORE (pre-0.79)
formatters: {
  'string:isbn': {
    label: 'ISBN',
    htmlInputType: 'text',
    validation: { pattern: '^[0-9-]+$', minLength: 10, maxLength: 17 },
    display: { template: 'ISBN: {value}' }
  }
}

// AFTER (0.79+)
kinds: {
  'string:isbn': {
    label: 'ISBN',
    htmlInputType: 'text',
    validate: (v) =>
      typeof v === 'string' && /^[0-9-]+$/.test(v) && v.length >= 10 && v.length <= 17
        ? null
        : 'must be an ISBN',
    render: { template: 'ISBN: {value}' }
  }
}
```

What changed:

- `formatters:` → `kinds:` (the option is honest about what it configures).
- `display:` → `render:` (the sub-block is honest about being DOM-only).
- `validation: { pattern, minLength, maxLength, … }` → write a `validate(v)` function instead. Same field, runs on the server (and in the browser bundle), no longer drifts from `KindDescriptor.validate`.
- `parser:` removed — it was never wired up.
- `label`, `htmlInputType`, `promptType` are no longer silently ignored — they register with the kind descriptor on the server.

---

A model's `attributes` block is half the picture. The other half — how one model points at another — is the subject of the next chapter, [Associations](./associations.md): `belongsTo`, `hasMany`, the foreign-key columns the framework infers from them, and what pickers, validators, and forms get for free.

**Related guides:**

- [Custom MCP App](../10-extensions/custom-app.md) — building a custom iframe app that consumes the kind taxonomy through `getKindRenderer`.
- [Custom API Convention](../06-the-three-layers-up-close/api-convention.md) — convention-level transformations sit upstream of kind parsing.
- [Prompt Creation Guide](../03-the-prompt/prompt-creation.md) — how prompt strategies consume `promptType` and `describe`.
