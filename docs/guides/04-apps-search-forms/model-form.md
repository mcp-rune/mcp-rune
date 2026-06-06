# Model Form Customization Guide

The generic model-form MCP app renders forms dynamically from schema. This guide covers the layout system that controls how fields are positioned — from horizontal label-field alignment to side-by-side field groups.

## Default Layout: Horizontal Label-Field

All fields render in a **horizontal layout** by default: right-aligned label on the left, input on the right, using CSS grid.

<!-- illustration: model-form-customization#default-layout -->

```
┌─────────────────────────────────────────────────┐
│  ┌─ Fieldset ────────────────────────────────┐  │
│  │                                            │  │
│  │      Title *  [________________________]   │  │
│  │  Description  [________________________]   │  │
│  │               [________________________]   │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

The grid uses `minmax(100px, 25%)` for labels and `1fr` for inputs. Labels are right-aligned with `padding-top: 7px` to align with input text.

### Stacked Variant

Field types with inline option labels — `checkbox_group`, `multiselect`, and `checkbox` — automatically use a stacked layout (label above, options below). This is applied via `field--stacked` CSS class based on field type.

<!-- illustration: model-form-customization#stacked -->

```
┌────────────────────────────────────────────┐
│  Formats                                   │
│  ☑ Physical  ☑ Ebook  ☐ PDF  ☐ Audio     │
└────────────────────────────────────────────┘
```

## Field Group Layouts

Field groups can declare a `layout` property to control how their fields render together. This flows from the prompt's `fieldGroups` config through the schema to the client renderer.

### Configuring a Layout

Add `layout` to a field group in the prompt class:

```js file=examples/model-form-customization-guide-01.js
static fieldGroups = {
  classification: {
    fields: ['theme_id', 'category_id'],
    context: 'Classification',
    required: true,
    description: 'Theme and category',
    layout: { type: 'row' }  // renders fields side-by-side
  }
}
```

```ts file=examples/model-form-customization-guide-01.ts
static fieldGroups = {
  classification: {
    fields: ['theme_id', 'category_id'],
    context: 'Classification',
    required: true,
    description: 'Theme and category',
    layout: { type: 'row' }  // renders fields side-by-side
  }
}
```

### Available Layout Types

| Type        | Behavior                                       | Best for                    |
| ----------- | ---------------------------------------------- | --------------------------- |
| `'row'`     | Fields side-by-side in a flex row, equal width | 2-3 selects or short inputs |
| _(default)_ | Fields stacked vertically                      | Most field groups           |

Unknown layout types fall back to default rendering (forward-compatible).

## How Layout Flows: End-to-End

<!-- illustration: model-form-customization#flow -->

```
Prompt fieldGroups          form-schema.js             Client app.js            CSS
─────────────────          ──────────────             ─────────────            ───

fieldGroups: {        →   buildGroupLayouts()    →   renderFieldGroup()   →  .field-row
  classification: {        extracts layout            checks layout.type      flex row
    layout: {              from each group            wraps fields in         equal-width
      type: 'row'          into groupLayouts          <div class="field-row"> children
    }                      on schema output
  }
}
```

1. **Prompt** declares `layout` on `fieldGroups` entries
2. **`form-schema.js`** calls `buildGroupLayouts()` to extract layouts into a `groupLayouts` map on the schema
3. **Client `app.js`** reads `schema.groupLayouts[groupKey]` and calls `renderFieldGroup(fields, layout)`
4. **CSS** styles the container (`.field-row` for row layout)

## Adding a New Layout Type

### Step 1: Add rendering in `renderFieldGroup()`

In `src/mcp/apps/shared/model-form/main.js`:

```js file=src/render-field-group.js
function renderFieldGroup(fields, layout) {
  if (layout?.type === 'row') {
    // existing row logic
  }

  if (layout?.type === 'grid') {
    const grid = document.createElement('div')
    grid.className = 'field-grid'
    grid.style.gridTemplateColumns = `repeat(${layout.columns || 2}, 1fr)`
    for (const field of fields) grid.appendChild(renderField(field))
    return grid
  }

  // Default: sequential
  const fragment = document.createDocumentFragment()
  for (const field of fields) fragment.appendChild(renderField(field))
  return fragment
}
```

```ts file=src/render-field-group.ts
function renderFieldGroup(fields, layout) {
  if (layout?.type === 'row') {
    // existing row logic
  }

  if (layout?.type === 'grid') {
    const grid = document.createElement('div')
    grid.className = 'field-grid'
    grid.style.gridTemplateColumns = `repeat(${layout.columns || 2}, 1fr)`
    for (const field of fields) grid.appendChild(renderField(field))
    return grid
  }

  // Default: sequential
  const fragment = document.createDocumentFragment()
  for (const field of fields) fragment.appendChild(renderField(field))
  return fragment
}
```

### Step 2: Add CSS

In `src/mcp/apps/shared/model-form/styles.css`:

```css
.field-grid {
  display: grid;
  gap: 12px;
}
.field-grid > .field {
  grid-template-columns: 1fr;
}
.field-grid > .field label {
  text-align: left;
  padding-top: 0;
}
```

### Step 3: Build

```bash
npm run build:engineer:apps
```

No schema changes needed — `buildGroupLayouts()` already passes through any layout object.

## CSS Class Reference

| Class             | Applied to                                   | Purpose                                          |
| ----------------- | -------------------------------------------- | ------------------------------------------------ |
| `.field`          | Every field container                        | Horizontal grid layout (label left, input right) |
| `.field--stacked` | checkbox_group, multiselect, checkbox fields | Single-column layout for inline options          |
| `.field-row`      | Group wrapper when `layout.type === 'row'`   | Flex row, equal-width children                   |

## Examples

### Activity: Side-by-Side Selects

The Activity prompt's `classification` group uses `layout: { type: 'row' }` to render theme and category selects side by side:

<!-- illustration: model-form-customization#row -->

```
┌─ Classification ──────────────────────────────┐
│  ┌─ Theme ──────────┐  ┌─ Category ─────────┐ │
│  │ Select…       ▾  │  │ Select…          ▾ │ │
│  └──────────────────┘  └────────────────────┘ │
└───────────────────────────────────────────────┘
```

Note that fields inside a `row` layout use stacked (label-above) positioning, since horizontal labels don't work well at half-width.

### Default Rendering (No Layout)

Most field groups render with the default horizontal layout:

<!-- illustration: model-form-customization#basic -->

```
┌─ Basic Information ────────────────────────────┐
│      Title *  [_______________________________] │
│  Description  [_______________________________] │
│               [_______________________________] │
└────────────────────────────────────────────────┘
```

## Responsive Behavior

On viewports narrower than 400px (via `@media (max-width: 400px)`):

- All fields revert to stacked layout (label above input)
- `.field-row` switches to `flex-direction: column` (fields stack vertically)

### Edge Cases

- **Long labels**: `minmax(100px, 25%)` constrains label width; word-wrap handles overflow
- **Error messages**: `grid-column: 1 / -1` spans errors across the full grid width
- **Textarea**: `align-items: start` keeps labels top-aligned (not centered vertically)

## Related Guides

- **[MCP Apps Guide](./mcp-apps.md)** — Architecture, protocol flow, building custom and generic apps
- **[Prompt Creation Guide](../02-prompt-dsl/prompt-creation.md)** — Configuring `fieldGroups`, `sections`, and prompt content
