// pages/model-form-customization.mjs
//
// Authoring source for the model-form-customization guide's illustration.
// Ported from the pilot's model-form-customization.html. Five figures:
// four form previews (rendered HTML, not SVG) and one data-flow diagram
// showing how a layout declaration flows from prompt to CSS.

import { colors, text, rect, arrowRight, svg } from '../illus.mjs'

// ----- Form previews ------------------------------------------------
// The pilot renders four "form preview" figures as styled DOM rather
// than SVG. The CSS classes (.fs, .frow, .checks, etc.) live in the
// gallery's ds.css; the site picks them up via illustrations.css. Each
// helper here returns the HTML markup the pilot showed inside the
// <figure> element.

// Build the "Default — horizontal label-field" form preview.
function buildDefaultFigure() {
  const altText =
    'A Fieldset form preview with two rows: a required Title field ' +
    'with a single-line input, and a Description field with a taller ' +
    'textarea — both rendered horizontally with the label on the left.'

  const html =
    '<div class="prevtag">rendered preview</div>' +
    '<div class="fs">' +
    '<span class="fs-leg">Fieldset</span>' +
    '<div class="frow"><label>Title <em>*</em></label><div class="inp"></div></div>' +
    '<div class="frow top"><label>Description</label><div class="inp ta"></div></div>' +
    '</div>'

  return { svg: html, alt: altText }
}

// Build the "Stacked — inline option labels" form preview.
function buildStackedFigure() {
  const altText =
    'A Formats field rendered in stacked layout: the label sits above ' +
    'a row of checkbox options — Physical and Ebook checked, PDF and ' +
    'Audio unchecked.'

  const html =
    '<div class="prevtag">rendered preview</div>' +
    '<div class="fs">' +
    '<div class="stacklabel">Formats</div>' +
    '<div class="checks">' +
    '<span class="chk"><span class="box on"></span>Physical</span>' +
    '<span class="chk"><span class="box on"></span>Ebook</span>' +
    '<span class="chk"><span class="box"></span>PDF</span>' +
    '<span class="chk"><span class="box"></span>Audio</span>' +
    '</div>' +
    '</div>'

  return { svg: html, alt: altText }
}

// Build the "Row layout — layout: { type: 'row' }" form preview.
function buildRowFigure() {
  const altText =
    'A Classification fieldset with two side-by-side stacked-label ' +
    'selects: Theme and Category, each showing the placeholder ' +
    '"Select…" with a dropdown caret.'

  const html =
    '<div class="prevtag">rendered preview</div>' +
    '<div class="fs">' +
    '<span class="fs-leg">Classification</span>' +
    '<div class="row2">' +
    '<div class="field-stacked"><label>Theme</label>' +
    '<div class="sel">Select… <span class="car">▾</span></div></div>' +
    '<div class="field-stacked"><label>Category</label>' +
    '<div class="sel">Select… <span class="car">▾</span></div></div>' +
    '</div>' +
    '</div>'

  return { svg: html, alt: altText }
}

// Build the "Default rendering — no layout" form preview.
function buildBasicFigure() {
  const altText =
    'A Basic Information fieldset with two rows: a required Title field ' +
    'with a single-line input, and a Description field with a taller ' +
    'textarea — the default horizontal label-field layout.'

  const html =
    '<div class="prevtag">rendered preview</div>' +
    '<div class="fs">' +
    '<span class="fs-leg">Basic Information</span>' +
    '<div class="frow"><label>Title <em>*</em></label><div class="inp"></div></div>' +
    '<div class="frow top"><label>Description</label><div class="inp ta"></div></div>' +
    '</div>'

  return { svg: html, alt: altText }
}

// ----- Layout-flow data-flow diagram -------------------------------

// Build the "How layout flows" diagram. Four columns connected by
// right-pointing arrows: prompt fieldGroups → form-schema.js →
// client app.js → CSS.
function buildFlowFigure() {
  const width = 880
  const height = 308
  // Each column starts at one of these x positions and is 180 wide.
  const columnXs = [24, 232, 440, 648]
  const columnWidth = 180

  const altText =
    'A layout declared on a prompt fieldGroup flows through ' +
    'buildGroupLayouts() in form-schema.js into groupLayouts on the ' +
    'schema, is read by renderFieldGroup() in the client app.js which ' +
    'wraps fields in a field-row div, and is finally styled by the ' +
    '.field-row CSS as an equal-width flex row.'

  // Per-line styling marker → colour map. The pilot's compact code
  // used single-character keys; here they are spelled out:
  //   ink      — plain code, soft ink
  //   accent   — an "active" line (function call or selector)
  //   muted    — supporting note text
  //   code     — JSX-like literal in teal
  const styleFills = {
    ink: colors.inkSoft,
    accent: colors.accentSoft,
    muted: colors.inkMuted,
    code: colors.teal
  }

  // Each column has a coloured header dot, a label, and an array of
  // [text, styleKey] rows. Blank rows leave a vertical gap.
  const columns = [
    {
      label: 'Prompt fieldGroups',
      fill: colors.accentSoft,
      lines: [
        ['fieldGroups: {', 'ink'],
        ['  classification: {', 'ink'],
        ['    layout: {', 'ink'],
        ["      type: 'row'", 'accent'],
        ['    }', 'ink'],
        ['  }', 'ink'],
        ['}', 'ink']
      ]
    },
    {
      label: 'form-schema.js',
      fill: colors.blue,
      lines: [
        ['buildGroupLayouts()', 'accent'],
        ['', ''],
        ['extracts layout', 'muted'],
        ['from each group', 'muted'],
        ['into groupLayouts', 'muted'],
        ['on schema output', 'muted']
      ]
    },
    {
      label: 'Client app.js',
      fill: colors.teal,
      lines: [
        ['renderFieldGroup()', 'accent'],
        ['', ''],
        ['checks layout.type', 'muted'],
        ['wraps fields in', 'muted'],
        ['<div class=', 'code'],
        [' "field-row">', 'code']
      ]
    },
    {
      label: 'CSS',
      fill: colors.amber,
      lines: [
        ['.field-row', 'accent'],
        ['', ''],
        ['flex row', 'muted'],
        ['equal-width', 'muted'],
        ['children', 'muted']
      ]
    }
  ]

  let body = ''

  // ----- Per-column panel: panel rect, header bar, dot, label, rows --
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex]
    const x = columnXs[columnIndex]

    // Panel body + header strip (rounded top, square seam at y+76).
    body += rect(x, 56, columnWidth, 224, {
      radius: 10,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    body += rect(x, 56, columnWidth, 30, { radius: 10, fill: colors.panelHead })
    body += rect(x, 76, columnWidth, 10, { fill: colors.panelHead })

    // Header dot + label, in the column's own accent.
    body += `<circle cx="${x + 16}" cy="71" r="3.5" fill="${column.fill}"></circle>`
    body += text(x + 28, 75, column.label, {
      size: 11,
      fill: column.fill
    })

    // Code lines, fixed line height regardless of empty rows.
    let lineY = 110
    for (const [content, styleKey] of column.lines) {
      if (content) {
        body += text(x + 14, lineY, content, {
          size: 10.5,
          fill: styleFills[styleKey]
        })
      }
      lineY += 18
    }

    // Right-pointing arrow into the next column (skip after last).
    if (columnIndex < 3) {
      body += arrowRight(x + columnWidth + 4, 168, x + columnWidth + 24, {
        color: colors.accent
      })
    }
  }

  const rendered = svg(width, height, 'LAYOUT FLOW · PROMPT → SCHEMA → CLIENT → CSS', body, {
    alt: altText
  })
  return { svg: rendered, alt: altText }
}

// Note: the pilot's `fig-default` is exported as `defaultLayout` here
// because `default` is a reserved word in JS export bindings (and the
// build script treats a real `default` export as the bare-slug svg,
// which would collide with the multi-figure naming scheme).
export const defaultLayout = buildDefaultFigure()
export const stacked = buildStackedFigure()
export const flow = buildFlowFigure()
export const row = buildRowFigure()
export const basic = buildBasicFigure()
// Multi-figure pages do NOT export default.
