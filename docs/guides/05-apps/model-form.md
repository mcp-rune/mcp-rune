# Model form customization

`new_model_app` and `edit_model_app` render their forms dynamically from a schema, and that schema comes from a **form class**. The default app registry synthesizes one for every model — each attribute that doesn't set `prompt_visible: false` becomes a field, in declaration order — which is fine for most cases. This chapter is for when the synthesized form doesn't match the UX you want: fewer fields, a different order, or fields grouped into titled fieldsets. You extend `BaseAppForm` (exported from `@mcp-rune/mcp-rune/apps`) and supply it via the registry's `formClasses:` map.

## What a form class declares

`BaseAppForm` is a bag of static declarations — there are no methods to override:

| Static | Type | Purpose |
| --- | --- | --- |
| `fields` | `string[]` | Attribute names the form renders, in order |
| `fieldsets` | `Record<string, AppFormFieldsetConfig> \| null` | Optional grouping of fields; `null` = one default fieldset |
| `associations` | `Array<string \| AppFormAssociationEntry> \| null` | Associations to resolve via pickers before the form opens |
| `postCreate` | `AppFormPostCreateConfig[] \| null` | Child records created after the main record is submitted |

Each fieldset entry is an `AppFormFieldsetConfig` — a purely presentational grouping:

```ts file=src/config/app-form-fieldset-config.ts
interface AppFormFieldsetConfig {
  title?: string // defaults to the humanized fieldset key
  description?: string
  required?: boolean
  fields?: string[] // which of the form's fields belong to this group
}
```

```js file=src/config/app-form-fieldset-config.js
/**
 * Types are a TypeScript-only artifact — no JS runtime equivalent.
 * The contract below is duck-typed at runtime.
 *
 * interface AppFormFieldsetConfig {
 *   title?: string // defaults to the humanized fieldset key
 *   description?: string
 *   required?: boolean
 *   fields?: string[] // which of the form's fields belong to this group
 * }
 */
```

Note what is _not_ here: there is no `layout` key. Per-group layout is a renderer capability without a declaration path today — see [the layout gap](#the-layout-gap-renderer-support-without-a-declaration-path) below.

## Declaring fields and fieldsets

A bookshelf deployment that wants the book form trimmed and grouped:

```js file=examples/model-form-guide-01.js
import { BaseAppForm } from '@mcp-rune/mcp-rune/apps'

export class BookForm extends BaseAppForm {
  // Only these attributes render, in this order.
  static fields = ['title', 'isbn', 'published_on', 'formats', 'notes']

  // Group them into fieldsets. Every field above should appear in
  // exactly one fieldset -- a field claimed by no fieldset is
  // silently skipped by the renderer.
  static fieldsets = {
    identity: {
      title: 'Book Identity',
      description: 'What the book is',
      fields: ['title', 'isbn']
    },
    publication: {
      title: 'Publication',
      fields: ['published_on', 'formats']
    },
    extras: {
      fields: ['notes'] // title defaults to the humanized key: "Extras"
    }
  }
}
```

```ts file=examples/model-form-guide-01.ts
import { BaseAppForm } from '@mcp-rune/mcp-rune/apps'

export class BookForm extends BaseAppForm {
  // Only these attributes render, in this order.
  static fields = ['title', 'isbn', 'published_on', 'formats', 'notes']

  // Group them into fieldsets. Every field above should appear in
  // exactly one fieldset -- a field claimed by no fieldset is
  // silently skipped by the renderer.
  static fieldsets = {
    identity: {
      title: 'Book Identity',
      description: 'What the book is',
      fields: ['title', 'isbn']
    },
    publication: {
      title: 'Publication',
      fields: ['published_on', 'formats']
    },
    extras: {
      fields: ['notes'] // title defaults to the humanized key: "Extras"
    }
  }
}
```

Three rules, all enforced by the binding and schema-generation steps:

- A field name must exist in `ModelClass.attributes` and not set `prompt_visible: false` — anything else is dropped during binding.
- When `fieldsets` is declared, every field should be claimed by one fieldset. Unclaimed fields stay in an internal `default` group that no declared fieldset points at, so they never render.
- Fieldsets whose `fields` end up empty (all dropped) are filtered out of the schema.

## Wiring it through the registry

Supply the class in `createDefaultAppRegistry`'s `formClasses:` map, keyed by model name:

```js file=examples/model-form-guide-02.js
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

import { MODEL_CLASSES } from './models/index.js'
import { BookForm } from './forms/book-form.js'

const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  formClasses: { book: BookForm }, // other models keep the synthesized default
  namespace: 'bookshelf'
})
```

```ts file=examples/model-form-guide-02.ts
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'

import { MODEL_CLASSES } from './models/index.js'
import { BookForm } from './forms/book-form.js'

const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  formClasses: { book: BookForm }, // other models keep the synthesized default
  namespace: 'bookshelf'
})
```

Models absent from `formClasses` fall back to the synthesized default; models whose synthesized form would have zero renderable fields are skipped entirely, so `new_model_app` / `edit_model_app` don't list them as eligible. Anything satisfying the structural `AppFormClass` shape works — a plain object literal `{ fields: ['title', 'isbn'] }` is as valid as a `BaseAppForm` subclass. By default the registry boot-validates the resolved form classes (explicit + synthesized) via `validateRegistries` and throws on error-level issues, so a typo'd field name or an empty `fields` array fails at startup, not at form-open time.

## How the schema flows: end-to-end

<!-- illustration: model-form-customization#flow -->

```
BaseAppForm subclass      bindAppForm()             generateAppFormSchema()    shared/model-form/main.js
────────────────────      ─────────────             ───────────────────────    ─────────────────────────

static fields        →    merges each field    →    schema.fields          →   renderForm(schema)
static fieldsets          with its attribute        (each field stamped        groups fields by
                          and any belongsTo /       with its group key)        field.group, walks
                          hasMany association       schema.fieldsets           schema.fieldsets
                          from the ModelClass       (key, title, groups)       in declaration order
```

1. **`new_model_app` / `edit_model_app`** look up the model's form class and call `bindAppForm(FormClass, ModelClass)`, which merges each field name with its attribute definition and any association metadata into a `BoundAppForm`.
2. **`generateAppFormSchema(boundForm)`** produces the schema — `{ model, title, fieldsets, fields }` — deriving each field's input type, options, validation, placeholder, and `group` (its fieldset key).
3. The app's tool result carries the schema **as JSON** to the sandboxed iframe.
4. The shared client renderer — `src/mcp/apps/shared/model-form/main.js`, bundled into both form apps — reads `schema.fields` and `schema.fieldsets` and builds the DOM: fields grouped by `field.group`, groups emitted in `schema.fieldsets` order.

One renderer detail worth knowing: `renderForm()` renders the fields directly, without `<fieldset>` / `<legend>` chrome. Fieldset `title` and `description` travel in the schema (custom apps can use them), but the stock form UI uses fieldsets only for membership and ordering.

## Default layout: horizontal label-field

Every field renders as a CSS grid row — label on the left, input on the right:

<!-- illustration: model-form-customization#default-layout -->

```
┌─────────────────────────────────────────────────┐
│  ┌────────────────────────────────────────────┐  │
│  │                                            │  │
│  │  Title *      [________________________]   │  │
│  │  Isbn         [________________________]   │  │
│  │  Notes        [________________________]   │  │
│  │               [________________________]   │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

The `.mr-field` grid is `grid-template-columns: 168px 1fr` with an `18px` gap and `align-items: start` (labels stay top-aligned next to textareas). Labels get `padding-top: 9px` to line up with the input text, and rows alternate a subtle zebra background.

### Stacked variant

Field types with inline option labels — `checkbox_group`, `multiselect`, and `checkbox` — automatically get the `mr-field--stacked` class, collapsing the grid to a single column (label above, options below):

<!-- illustration: model-form-customization#stacked -->

```
┌────────────────────────────────────────────┐
│  Formats                                   │
│  ☑ Physical  ☑ Ebook  ☐ PDF  ☐ Audio     │
└────────────────────────────────────────────┘
```

## The layout gap: renderer support without a declaration path

The client renderer has a second layout mode that nothing currently activates. `renderForm()` reads `schema.groupLayouts?.[groupKey]` and hands it to `renderFieldGroup(fields, layout)`; when `layout.type === 'row'` the group's fields render side by side in an `.mr-field-row` flex container — equal widths, label-above positioning, vertical separators:

<!-- illustration: model-form-customization#row -->

```
┌─ Classification ──────────────────────────────┐
│  ┌─ Genre ──────────┐  ┌─ Shelf ────────────┐ │
│  │ Select…       ▾  │  │ Select…          ▾ │ │
│  └──────────────────┘  └────────────────────┘ │
└───────────────────────────────────────────────┘
```

Unknown layout types fall back to sequential rendering, so the hook is forward-compatible.

**But no declaration reaches it.** `generateAppFormSchema` never emits a `groupLayouts` map — its output is exactly `{ model, title, fieldsets, fields }` — and `AppFormFieldsetConfig` has no `layout` key to declare one from. Today there is no supported way to get a row layout out of a `BaseAppForm` subclass; the renderer and CSS are in place, the wiring is not.

If a deployment needs this, the seam is `AppFormFieldsetConfig`: add a `layout` key there, pass it through `generateAppFormSchema` into a `groupLayouts` map on the schema, and the existing renderer picks it up unchanged. That is a framework contribution (schema generation lives in `src/mcp/apps/lib/app-form-schema.ts`), not a deployer-side override — until it lands, treat `.mr-field-row` as internal.

## CSS class reference

All form classes carry the `mr-` prefix (they come from the default app theme in `src/mcp/apps/shared/model-form/styles.css`):

| Class | Applied to | Purpose |
| --- | --- | --- |
| `.mr-form` | The `<form>` container | Rounded bordered card around the field rows |
| `.mr-field` | Every field container | Horizontal grid layout (`168px 1fr`, label left, input right) |
| `.mr-field--stacked` | `checkbox_group`, `multiselect`, `checkbox` fields | Single-column layout for inline options |
| `.mr-field-row` | Group wrapper when a `row` layout is passed | Flex row, equal-width children (see [the layout gap](#the-layout-gap-renderer-support-without-a-declaration-path)) |
| `.mr-field--error` / `.mr-field__err` | Fields with validation errors | Red border on the input; message spans the full grid via `grid-column: 1 / -1` |

## Responsive behavior

On viewports narrower than 460px (via `@media (max-width: 460px)`):

- `.mr-field` collapses to a single column — label above input, left-aligned
- `.mr-field-row` switches to `flex-direction: column` and drops its vertical separators

### Edge cases

- **Long labels**: the fixed `168px` label column word-wraps overflow
- **Error messages**: `grid-column: 1 / -1` spans errors across the full grid width
- **Textarea**: `align-items: start` on `.mr-field` keeps labels top-aligned (not centered vertically)

## Rebuilding the app bundles (framework contributors only)

Deployers never rebuild anything — the form apps ship prebuilt in `src/mcp/apps/dist/`, and form customization happens entirely through `formClasses:`. If you are contributing to the framework itself and edit the shared renderer (`src/mcp/apps/shared/model-form/main.js`) or its CSS, rebuild the two bundles that embed it:

```bash
npm run build:apps:new-model-app
npm run build:apps:edit-model-app
```

(`npm run build:apps` rebuilds every app bundle.)

## Related Guides

- **[MCP Apps Guide](./mcp-apps.md)** — Architecture, protocol flow, building custom and generic apps
- **[Apps architecture](./mcp-apps-arch.md)** — How the framework resolves `ui://` resources and wires the message channels
- **[Prompt Creation Guide](../03-the-prompt/prompt-creation.md)** — Prompt classes supply form _defaults_ (`getDefaultFormState()`); grouping comes from the form class's `fieldsets`
