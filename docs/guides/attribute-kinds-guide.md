# Attribute Kinds Guide

An **attribute kind** describes how a single attribute value moves through three representations:

```
API value  ⇄  internal value  ⇄  HTML <input> value
   (parse / serialize)        (fromInput / toInput)
   describe(internal) -> string   (LLM-facing summary)
   validate(internal) -> string | null   (kind-aware errors)
   format(internal)  -> DOM Node   (display rendering, browser only)
```

mcp-rune ships 17 built-in kinds (`string`, `integer`, `boolean`, `date`, `enum`, `array`, `email`, `url`, `uuid`, `json`, `color`, `rating`, …). The same kind taxonomy is used by:

- The polymorphic **form generator** to pick the right `<input type="…">`.
- The **iframe display layer** (`list-view`, `record-detail`, `search-view`) to render cells.
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

All 17 kinds are registered in `src/core/kind-metadata.ts`. Browser-side display rendering (`format()`) for kinds whose output is more than `helpers.text(String(value))` lives in `src/mcp/apps/shared/formatters.ts`.

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
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * import type { KindDescriptor, KindOpts } from '@mcp-rune/mcp-rune/core'
 *
 * interface KindOpts {
 *   format?: string
 *   enumValues?: string[]
 *   max?: number
 * }
 *
 * interface KindDescriptor {
 *   htmlInputType: string
 *   promptType: string
 *   label: string
 *   describe(value: unknown, opts?: KindOpts): string
 *   validate(value: unknown, opts?: KindOpts): string | null
 *   parse(api: unknown, opts?: KindOpts): unknown
 *   serialize(internal: unknown, opts?: KindOpts): unknown
 *   toInput(internal: unknown, opts?: KindOpts): string
 *   fromInput(raw: string, opts?: KindOpts): unknown
 * }
 */
```

Each method has a precise role. Read them as a contract between three caller groups:

- **`form-schema.ts` (server)** reads `htmlInputType` when generating `FormFieldDefinition.type` so the iframe knows which `<input>` widget to render.
- **`schema-derivation.ts` (server)** reads `promptType` to populate the "Type" column of LLM-facing attribute reference tables.
- **`model-form-ui/app.js` (iframe)** calls `parse(apiValue)` to hydrate the form from a record, then `toInput(internal)` to write the `<input value="…">`. On submit, it calls `fromInput(rawString)` then `serialize(internal)` to produce the API payload.
- **`list-view-ui` / `record-detail-ui` / `search-view-ui`** call `parse` then `format` (the DOM-returning function from `formatters.ts`, which is layered on top of the descriptor and not part of it).
- **`HybridStrategy.generateHumanSummary` and `BasePrompt.generateHumanReadableSummary`** (server) call `describe(value)` for every populated field so the LLM-facing summary mirrors the iframe's `format()` output.
- **`BaseStrategy.validateField` (server)** calls `validate(value)` for kind-aware error messages. Range / length / pattern checks from `FieldValidation` are orthogonal and live in `base-strategy.ts`.

`parse / serialize / toInput / fromInput` follow the standard rule: `parse` accepts whatever the API gave you (string, number, boolean, null); `toInput` produces a value the HTML `<input>` is happy with (always a string); `fromInput` accepts the raw `<input>.value` string; `serialize` returns the shape your API expects.

## Three Extension Paths

| Path                            | When to use                                                                                          | Channel                                                                          | Crosses server boundary?                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Declarative descriptor**      | New kind your deployment needs (ISBN, currency, phone).                                              | `AppRegistry.formatters: Record<string, FormatterDescriptor>`                    | **Yes** — server + browser see the same descriptor.                                   |
| **Programmatic `registerKind`** | Framework-internal kinds, or rich server-side behavior (e.g. a custom `serialize` that does crypto). | `registerKind(kind, descriptor, { format })` called at boot                      | Yes, but you import `@mcp-rune/mcp-rune/core` and call it directly (no JSON channel). |
| **DOM-only display override**   | You want a different widget for an existing kind (slider for `rating`, gradient swatch for `color`). | `registerFormatter(kind, { format }, { format })` from `@mcp-rune/mcp-rune/apps` | **No** — only the iframe sees this.                                                   |

The declarative descriptor is the canonical path. Use it unless you genuinely need imperative code on the server.

### The `FormatterDescriptor` shape

```ts file=src/formatter-descriptor.ts
import type { FormatterDescriptor } from '@mcp-rune/mcp-rune/apps'

interface FormatterDescriptor {
  htmlInputType?: string
  promptType?: string
  label?: string
  validation?: {
    pattern?: string
    minLength?: number
    maxLength?: number
    minimum?: number
    maximum?: number
  }
  display?: {
    template?: string // "{value}" substitution
    locale?: string // Intl.DateTimeFormat
    dateStyle?: 'full' | 'long' | 'medium' | 'short'
    timeStyle?: 'full' | 'long' | 'medium' | 'short'
    badge?: { icon?: string; className?: string }
  }
  parser?: {
    regex?: string
    replacement?: string
  }
}
```

```js file=src/formatter-descriptor.js
/**
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * import type { FormatterDescriptor } from '@mcp-rune/mcp-rune/apps'
 *
 * interface FormatterDescriptor {
 *   htmlInputType?: string
 *   promptType?: string
 *   label?: string
 *   validation?: {
 *     pattern?: string
 *     minLength?: number
 *     maxLength?: number
 *     minimum?: number
 *     maximum?: number
 *   }
 *   display?: {
 *     template?: string // "{value}" substitution
 *     locale?: string // Intl.DateTimeFormat
 *     dateStyle?: 'full' | 'long' | 'medium' | 'short'
 *     timeStyle?: 'full' | 'long' | 'medium' | 'short'
 *     badge?: { icon?: string; className?: string }
 *   }
 *   parser?: {
 *     regex?: string
 *     replacement?: string
 *   }
 * }
 */
```

Notice the descriptor is JSON-serializable. It rides into the iframe through `AppRegistry.injectIntoHead` as `window.__MCP_RUNE_FORMATTERS__` (CSP-safe — no inline JS), and into the server through the same `formatters` config that `AppRegistry` already has. One source of truth.

## `getKind` Lookup Rules

```ts file=examples/attribute-kinds-guide-03.ts
import { getKind } from '@mcp-rune/mcp-rune/core'

getKind('string', 'isbn') // 1. exact kind:format narrowing
getKind('string', 'url') // 2. format hop — 'url' is a top-level kind
getKind('uuid') // 3. base kind
getKind('totally-fake') // 4. falls back to 'string'
```

```js file=examples/attribute-kinds-guide-03.js
import { getKind } from '@mcp-rune/mcp-rune/core'
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
  formatters: {
    'string:isbn': {
      label: 'ISBN',
      htmlInputType: 'text',
      promptType: 'string',
      validation: {
        pattern: '^(?:97[89][- ]?)?(?:\\d[- ]?){9}[\\dX]$',
        minLength: 10,
        maxLength: 17
      },
      display: { template: 'ISBN: {value}' }
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
  formatters: {
    'string:isbn': {
      label: 'ISBN',
      htmlInputType: 'text',
      promptType: 'string',
      validation: {
        pattern: '^(?:97[89][- ]?)?(?:\\d[- ]?){9}[\\dX]$',
        minLength: 10,
        maxLength: 17
      },
      display: { template: 'ISBN: {value}' }
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

- `record-detail-ui` and `list-view-ui` render `ISBN: 978-0-13-235088-4`.
- `model-form-ui` renders `<input type="text">` for the create/update form.
- `validate_form` rejects values that don't match the pattern or are outside 10–17 chars.
- The prompt's attribute reference table says **ISBN** in the "Type" column.

One declaration, four surfaces.

## Worked Example: Currency Kind via `registerKind`

When the declarative descriptor isn't expressive enough — typically because you need custom `parse` or `serialize` logic that can't be expressed as a regex or a template — call `registerKind` directly at boot:

```ts file=examples/attribute-kinds-guide-06.ts
// your-server/kinds/currency.ts
import { registerKind } from '@mcp-rune/mcp-rune/core'

registerKind('currency', {
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
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v))
  },
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : Number(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    return typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number'
  }
})
```

```js file=examples/attribute-kinds-guide-06.js
// your-server/kinds/currency.ts
import { registerKind } from '@mcp-rune/mcp-rune/core'
registerKind('currency', {
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
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v))
  },
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : Number(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    return typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number'
  }
})
```

Import this file once from your server's entry point — the `registerKind` call mutates the shared `KIND_REGISTRY` module. Both server-side prompt summaries and form-schema generation pick it up immediately.

The iframe also needs to know about it. Add a matching declarative entry in `formatters` so the iframe registry sees the descriptor (the iframe can't import server-only code):

```ts file=examples/attribute-kinds-guide-07.ts
formatters: {
  currency: {
    label: 'Currency',
    htmlInputType: 'number',
    promptType: 'number'
    // Server-side parse/serialize/describe are unused in the iframe; the
    // iframe only needs htmlInputType + display rendering.
  }
}
```

```js file=examples/attribute-kinds-guide-07.js
/**
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * formatters: {
 *   currency: {
 *     label: 'Currency',
 *     htmlInputType: 'number',
 *     promptType: 'number'
 *     // Server-side parse/serialize/describe are unused in the iframe; the
 *     // iframe only needs htmlInputType + display rendering.
 *   }
 * }
 */
```

In practice, the declarative channel covers ~80% of cases. Reach for `registerKind` only when you genuinely need imperative server-side code.

## Worked Example: DOM-Only Override

Sometimes you want to keep a kind's contract intact but change the rendered widget. Example: render `rating` as a slider instead of stars.

```ts file=src/max.ts
// your-server/apps/rating-slider.js
import { registerFormatter, helpers } from '@mcp-rune/mcp-rune/apps'

registerFormatter('rating', {
  format: (value, opts) => {
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
import { registerFormatter } from '@mcp-rune/mcp-rune/apps'
registerFormatter('rating', {
  format: (value, opts) => {
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

`registerFormatter` is **DOM-only**. It accepts only `{ format: (value, opts) => Node }` and throws if you try to pass `parse`, `serialize`, or any other key — those belong in `kind-metadata` (declarative descriptor or `registerKind`). The deliberate narrowing prevents the v0.50 drift where deployers used a JS-hook escape valve and the server-side prompts had no idea what kinds existed.

To register a brand-new kind via the iframe, use the declarative `FormatterDescriptor` channel above. `registerFormatter` only overrides the DOM rendering of an existing kind.

## How a Kind Flows Through the System

Trace a single `published_at` attribute (`type: 'datetime'`) from definition to LLM and back:

1. **Attribute definition** on the model: `published_at: { type: 'datetime', description: 'Publish timestamp' }`.

2. **Prompt docs**: `schema-derivation.ts` calls `getKind('datetime').promptType` → `'datetime'`. Renders in the LLM-facing attribute reference table.

3. **Form schema**: `form-schema.ts` calls `getKind('datetime').htmlInputType` → `'datetime-local'`. Renders as `<input type="datetime-local">` in `model-form-ui`.

4. **Form prefill**: `model-form-ui/app.js` receives an API value `"2026-05-28T14:30:00Z"`, calls `getFormatter('datetime').parse(...)` → `Date`, then `.toInput(date)` → `"2026-05-28T14:30"`. Sets the `<input value="…">`.

5. **Cell rendering** in list-view: `renderCellValue(apiValue, column)` calls `getFormatter('datetime').format(parsedDate)` → a `<span>` with a localized "May 28, 2026, 2:30 PM" (locale overridable via `formatters.datetime.display.locale`).

6. **Form submit**: user changes the input to `"2026-06-01T09:00"`. `model-form-ui/app.js` calls `getFormatter('datetime').fromInput(raw)` → `Date`, then `.serialize(date)` → `"2026-06-01T09:00:00.000Z"`. Sent to the API.

7. **`validate_form`**: if the user instead pasted `"garbage"`, `BaseStrategy.validateField` calls `getKind('datetime').validate('garbage')` → `'must be a valid datetime'`. The tool returns the error before any API call.

8. **LLM summary**: when the prompt's `generate_form_summary` runs, `HybridStrategy.generateHumanSummary` calls `getKind('datetime').describe(date)` → full ISO string. The LLM sees the same value the iframe just displayed (in ISO form for unambiguous downstream reasoning).

Same kind, eight call sites, one descriptor.

## Testing Custom Kinds

Test the descriptor's pure functions directly:

```ts file=examples/attribute-kinds-guide-09.ts
import { getKind } from '@mcp-rune/mcp-rune/core'
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
import { getKind } from '@mcp-rune/mcp-rune/core'
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
import { getFormatter } from '@mcp-rune/mcp-rune/apps'

it('rating renders a custom widget after override', () => {
  // your registerFormatter override must run before this test
  const node = getFormatter('rating').format(3, { column: { max: 5 } })
  expect(node.textContent).toBe('3/5')
})
```

```js file=src/node.js
/**
 * @vitest-environment happy-dom
 */
import { getFormatter } from '@mcp-rune/mcp-rune/apps'
it('rating renders a custom widget after override', () => {
  // your registerFormatter override must run before this test
  const node = getFormatter('rating').format(3, { column: { max: 5 } })
  expect(node.textContent).toBe('3/5')
})
```

## Migrating from v0.50 `formatterScript`

v0.50 shipped a `formatterScript` option on `AppRegistry` — a JS hook that ran inside the iframe and could register entirely new kinds. It was deleted in v0.51 because the server couldn't see what the hook registered (the prompt system and `validate_form` had no idea your `isbn` kind existed). The declarative `FormatterDescriptor` channel covers every case the hook covered, and now the server sees the kind too.

```ts file=examples/attribute-kinds-guide-12.ts
// BEFORE (v0.50)
formatterScript: `
  window.__MCP_RUNE_REGISTER_FORMATTERS__ = (registerFormatter, helpers) => {
    registerFormatter('isbn', {
      format: (v) => helpers.text('ISBN: ' + v)
    })
  }
`

// AFTER (v0.51+)
formatters: {
  'string:isbn': {
    label: 'ISBN',
    htmlInputType: 'text',
    validation: { pattern: '^[0-9-]+$', minLength: 10, maxLength: 17 },
    display: { template: 'ISBN: {value}' }
  }
}
```

```js file=examples/attribute-kinds-guide-12.js
// BEFORE (v0.50)
formatterScript: `
  window.__MCP_RUNE_REGISTER_FORMATTERS__ = (registerFormatter, helpers) => {
    registerFormatter('isbn', {
      format: (v) => helpers.text('ISBN: ' + v)
    })
  }
`
// AFTER (v0.51+)
formatters: {
  ;('string:isbn')
  {
    label: ('ISBN', htmlInputType)
    ;('text', validation)
    {
      pattern: ('^[0-9-]+$', minLength)
      ;(10, maxLength)
      17
    }
    display: {
      template: 'ISBN: {value}'
    }
  }
}
```

If your old `formatterScript` did something genuinely imperative on the server (rare), use `registerKind` per the [Currency example](#worked-example-currency-kind-via-registerkind) above instead.

---

**Related guides:**

- [Custom MCP App](./custom-app-guide.md) — building a custom iframe app that consumes the kind taxonomy through `getFormatter`.
- [Custom API Convention](./api-convention-guide.md) — convention-level transformations sit upstream of kind parsing.
- [Prompt Creation Guide](./prompt-creation-guide.md) — how prompt strategies consume `promptType` and `describe`.
