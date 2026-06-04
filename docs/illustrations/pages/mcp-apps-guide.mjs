// pages/mcp-apps-guide.mjs
//
// Authoring source for the mcp-apps-guide illustrations.
// Ported from the pilot's mcp-apps-guide.html. Five figures:
//   - overview:  protocol overview (client iframe ↔ MCP server)
//   - dataflow:  schema-driven form data flow (server metadata → form)
//   - tree:      src/mcp/apps/ file structure (colourised ASCII)
//   - selection: selection-store architecture (app · server · LLM)
//   - selflow:   selection flow vertical pipeline

import {
  colors,
  text,
  rect,
  line,
  band,
  panel,
  verticalConnector,
  arrowDown,
  svg,
  colorizeTree
} from '../illus.mjs'

// Small helper: an inbound notification row (left-pointing tip + label).
// Used inside the overview figure's "INBOUND" column.
function inboundRow(x, y, label, sub) {
  let body =
    `<path d="M${x} ${y - 4} l9 -4.5 v9 z" fill="${colors.blue}"></path>` +
    line(x, y, x + 15, y, { stroke: colors.blue, strokeWidth: 1.4 })
  body += text(x + 24, y + 4, label, { size: 11.5, fill: colors.ink })
  if (sub) {
    body += text(x + 24 + label.length * 7.0 + 8, y + 4, '· ' + sub, {
      size: 11,
      fill: colors.inkDim
    })
  }
  return body
}

// Small helper: an outbound call row (right-pointing tip + label).
function outboundRow(x, y, label) {
  return (
    line(x, y, x + 15, y, { stroke: colors.accent, strokeWidth: 1.4 }) +
    `<path d="M${x + 15} ${y - 4.5} l9 4.5 -9 4.5 z" fill="${colors.accent}"></path>` +
    text(x + 30, y + 4, label, { size: 11.5, fill: colors.ink })
  )
}

// ----- FIGURE 1: protocol overview --------------------------------------
// Two stacked bands joined by an "MCP protocol" pill. The client band
// contains a sandboxed-iframe sub-panel split into inbound (left) and
// outbound (right) columns; the server band carries the tool definition
// and the matching ui:// resource.
function buildOverviewFigure() {
  const width = 860
  const height = 470

  const altText =
    'MCP client sandboxed iframe with inbound notifications and outbound ' +
    'callServerTool calls, connected by MCP protocol to the MCP server ' +
    'pairing the create_book tool with a ui:// resource.'

  let body = ''

  // Client band + sandboxed-iframe sub-panel.
  body += band(24, 56, 812, 190, 'MCP CLIENT', {
    dot: colors.blue,
    labelFill: colors.aqua,
    sub: 'Claude Desktop · COC',
    subOffsetX: 118
  })
  body += panel(44, 92, 772, 134, 'Sandboxed iframe', {
    sub: 'MCP App HTML / JS / CSS',
    titleOffsetX: 170
  })
  body += line(64, 138, 796, 138, { stroke: colors.line, dash: '2 4' })

  // Inbound notification column.
  body += text(64, 164, 'INBOUND · client → app', {
    size: 10.5,
    letterSpacing: '0.06em',
    fill: colors.inkMuted
  })
  body += inboundRow(76, 184, 'ontoolinput', 'prefill data')
  body += inboundRow(76, 202, 'ontoolresult', 'schema + defaults')
  body += inboundRow(76, 220, 'onhostcontextchanged', 'theme')

  // Outbound call column.
  body += line(452, 150, 452, 232, { stroke: colors.line, dash: '2 4' })
  body += text(472, 164, 'OUTBOUND · app → server', {
    size: 10.5,
    letterSpacing: '0.06em',
    fill: colors.inkMuted
  })
  body += outboundRow(472, 184, "callServerTool('validate_form')")
  body += outboundRow(472, 210, "callServerTool('create_model')")

  // Connector pill between the two bands.
  body += verticalConnector(440, 246, 300, 'MCP protocol')

  // Server band + two sub-panels (tool, resource).
  body += band(24, 300, 812, 150, 'MCP SERVER', {
    dot: colors.accent,
    labelFill: '#c9b8ff'
  })
  body += panel(44, 338, 388, 96, 'Tool: create_book', {
    accentBar: colors.accent
  })
  body += text(64, 386, '→ handleToolCall(args, { apiClient })', {
    size: 11.5,
    fill: colors.accentSoft
  })
  body += text(64, 408, '→ Returns: { schema, defaults }', {
    size: 11.5,
    fill: colors.inkSoft
  })
  body += panel(452, 338, 384, 96, 'Resource: ui://engineer/create-book', {
    accentBar: colors.teal,
    titleOffsetX: 999
  })
  body += text(472, 386, '→ Returns: single-file HTML', {
    size: 11.5,
    fill: colors.teal
  })

  const rendered = svg(width, height, 'MCP APPS · ARCHITECTURE OVERVIEW', body, { alt: altText })

  return { svg: rendered, alt: altText }
}

// ----- FIGURE 2: schema-driven form data flow ---------------------------
// Server band with a metadata table, the pure schema generator, and an
// inline note about association-only API calls; joined by a tealed
// "JSON · ontoolresult" pill to the generic form-app band below.
function buildDataflowFigure() {
  const width = 860
  const height = 470

  const altText =
    'The MCP server derives a form schema from model attributes, ' +
    'associations, field groups and sections via the pure ' +
    'generateFormSchema(); association fields trigger API option lookups; ' +
    'the schema crosses to the generic form app via ontoolresult.'

  // The four metadata rows in the server band.
  const metadataRows = [
    ['Book.attributes', 'field types, validations, enums'],
    ['Book.associations', 'which fields need API options'],
    ['BookPrompt.fieldGroups', 'field grouping (fieldsets)'],
    ['BookPrompt.sections', 'section titles, ordering']
  ]

  let body = band(24, 56, 812, 236, 'MCP SERVER', {
    dot: colors.accent,
    labelFill: '#c9b8ff'
  })

  // Stack the metadata rows from y = 110 downward.
  let rowY = 110
  for (const [key, value] of metadataRows) {
    body += text(48, rowY, key, { size: 12, fill: colors.ink })
    body += text(300, rowY, '→ ' + value, { size: 11.5, fill: colors.inkMuted })
    rowY += 24
  }

  // Dotted divider, then the generator row and the association
  // sub-panel callout.
  body += line(44, rowY - 8, 816, rowY - 8, {
    stroke: colors.line,
    dash: '2 4'
  })
  body += text(48, rowY + 16, 'generateFormSchema()', {
    size: 12.5,
    fill: colors.accentSoft
  })
  body += text(300, rowY + 16, '→ JSON schema · pure, no API', {
    size: 11.5,
    fill: colors.teal
  })
  body += rect(48, rowY + 30, 768, 46, {
    radius: 8,
    fill: colors.frame,
    stroke: colors.line
  })
  body += text(64, rowY + 50, 'For association fields only:', {
    size: 10.5,
    fill: colors.inkDim
  })
  body += text(64, rowY + 68, "apiClient.get('/locations') → select options", {
    size: 11,
    fill: colors.amber
  })
  body += text(430, rowY + 68, "apiClient.get('/tags') → multiselect options", {
    size: 11,
    fill: colors.amber
  })

  // Connector pill — teal because it's data going to the app.
  body += verticalConnector(440, 292, 346, 'JSON · ontoolresult', {
    tip: colors.teal,
    color: colors.teal
  })

  // Generic form-app band at the bottom.
  body += band(24, 346, 812, 104, 'GENERIC FORM MCP APP', {
    dot: colors.teal,
    labelFill: colors.teal
  })
  body += text(48, 392, 'Receives schema → dynamically renders form', {
    size: 12,
    fill: colors.inkSoft
  })
  body += text(48, 414, "Validates via callServerTool('validate_form')", {
    size: 11.5,
    fill: colors.inkMuted
  })
  body += text(48, 434, "Submits via callServerTool('create_model')", {
    size: 11.5,
    fill: colors.inkMuted
  })

  const rendered = svg(width, height, 'GENERIC MODEL FORM · DATA FLOW', body, { alt: altText })

  return { svg: rendered, alt: altText }
}

// ----- FIGURE 3: src/mcp/apps/ directory tree --------------------------
// Verbatim from the pilot's #src-tree2 script block.
function buildTreeFigure() {
  const ascii = `src/mcp/apps/
├── new-model-app/              # Create-record form
│   ├── index.ts                # Factory + handleToolCall (server)
│   └── ui/                     # Thin shim → shared/model-form/main.js
│       ├── index.html
│       └── app.js
├── edit-model-app/             # Edit-record form (mirrors new-model-app)
│   ├── index.ts
│   └── ui/
├── find-model-app/             # Browseable table — query + filter popover + selection
│   ├── index.ts
│   └── ui/
├── show-model-app/             # Record detail view
│   ├── index.ts
│   └── ui/
├── view-selection-app/         # Inspect + manage the in-session selection store
│   ├── index.ts
│   └── ui/
├── pick-model-app/             # Type-ahead picker (single-model or group)
│   ├── index.ts
│   └── ui/
├── multi-pick-model-app/       # Browse-and-select picker for small/medium sets
│   ├── index.ts
│   └── ui/
├── lib/                        # Shared server-side helpers
│   ├── form-schema.ts          # generateFormSchema() — pure function
│   ├── list-schema.ts          # generateListSchema() — list/table schema
│   ├── detail-schema.ts        # generateDetailSchema() — record detail schema
│   ├── form-app-helpers.ts     # Shared helpers for new/edit form factories
│   ├── selection-store.ts      # SelectionStore — session-scoped Map
│   ├── selection-tools.ts      # createSelectionTools() — per-app selection
│   ├── registry.ts             # AppRegistry + createAppRegistry
│   └── …                       # types, helpers, formatters, etc.
├── shared/                     # Shared client-side JS/CSS for ui/ folders
│   ├── base.css, app-init.js, helpers.js, formatters.{js,runtime.js}, …
│   └── model-form/             # Shared form UI consumed by new + edit
│       ├── main.js             # initModelFormApp() — bulk of form code
│       └── styles.css
├── vite.config.js              # Build config (multi-target single-file HTML)
└── dist/                       # Built outputs (one HTML per app)
    ├── new-model-app.html
    ├── edit-model-app.html
    ├── find-model-app.html
    ├── show-model-app.html
    ├── view-selection-app.html
    ├── pick-model-app.html
    └── multi-pick-model-app.html`

  const altText =
    'Directory tree of src/mcp/apps/: seven app folders (new-model-app, ' +
    'edit-model-app, find-model-app, show-model-app, view-selection-app, ' +
    'pick-model-app, multi-pick-model-app), each with index.ts and a ui/ ' +
    'iframe entry; lib/ shared server-side helpers (form/list/detail ' +
    'schema, form-app-helpers, selection-store, selection-tools, ' +
    'registry); shared/ client-side JS/CSS plus a model-form subfolder; ' +
    'vite.config.js; and dist/ holding the built single-file HTML outputs.'

  return { svg: colorizeTree(ascii), alt: altText }
}

// ----- FIGURE 4: selection-store architecture --------------------------
// Three stacked bands: the iframe app, the server's SelectionStore +
// tool surface, and the LLM that reads selections back.
function buildSelectionFigure() {
  const width = 860
  const height = 652

  const altText =
    'Three layers: the MCP app captures a selection and calls an app-only ' +
    'select tool; the MCP server holds it in a session-scoped ' +
    'SelectionStore exposing app-only and model-visible tools; the LLM ' +
    'reads the selection back for bulk operations.'

  let body = ''

  // ----- Band 1: MCP app (iframe) -----------------------------------
  body += band(24, 56, 812, 140, 'MCP APP (iframe)', {
    dot: colors.teal,
    labelFill: colors.teal
  })
  body += text(48, 100, 'User checks rows →', { size: 12, fill: colors.inkSoft })
  // Two checked-row pills next to the row.
  body += rect(190, 88, 108, 20, {
    radius: 5,
    fill: colors.teal,
    fillOpacity: 0.1,
    stroke: colors.teal,
    strokeOpacity: 0.3
  })
  body += text(202, 102, '✓ Activity 1', { size: 11, fill: colors.teal })
  body += rect(306, 88, 108, 20, {
    radius: 5,
    fill: colors.teal,
    fillOpacity: 0.1,
    stroke: colors.teal,
    strokeOpacity: 0.3
  })
  body += text(318, 102, '✓ Activity 3', { size: 11, fill: colors.teal })

  // Call-out code block.
  body += text(48, 128, 'Click "Send (Replace)" / "Send (Add)" →', {
    size: 12,
    fill: colors.inkSoft
  })
  body += rect(48, 142, 788, 40, {
    radius: 8,
    fill: colors.frame,
    stroke: colors.line
  })
  body += text(64, 160, "callServerTool('select_find_records', {", {
    size: 11,
    fill: colors.accentSoft
  })
  body += text(
    64,
    176,
    "  model:'activity', mode:'ids', ids:['1','3'], total:2, strategy:'replace' })",
    { size: 11, fill: colors.inkMuted }
  )

  // App ↔ Server connector.
  body += verticalConnector(440, 196, 250, 'MCP protocol')

  // ----- Band 2: MCP server ----------------------------------------
  body += band(24, 250, 812, 222, 'MCP SERVER', {
    dot: colors.accent,
    labelFill: '#c9b8ff'
  })
  body += text(48, 292, 'SelectionStore', { size: 12, fill: colors.ink })
  body += text(170, 292, 'session-scoped Map', {
    size: 10.5,
    fill: colors.inkDim
  })
  body += text(64, 314, "activity → { mode:'ids', ids:['1','3'], total:2 }", {
    size: 11,
    fill: colors.inkSoft
  })
  body += text(64, 332, "contact  → { mode:'filter', filters:{ city:'NY' } }", {
    size: 11,
    fill: colors.inkSoft
  })
  body += line(44, 348, 816, 348, { stroke: colors.line, dash: '2 4' })

  // Per-app tools row.
  body += text(48, 370, 'Per-app tools', { size: 11.5, fill: colors.amber })
  body += text(160, 370, "visibility: ['app']", {
    size: 10.5,
    fill: colors.inkDim
  })
  body += text(
    64,
    388,
    'select_find_records · select_view_records · select_autocomplete_records · select_multi_records',
    { size: 10.5, fill: colors.inkMuted }
  )

  // Shared tools row.
  body += text(48, 414, 'Shared tools', { size: 11.5, fill: colors.teal })
  body += text(160, 414, "visibility: ['model']", {
    size: 10.5,
    fill: colors.inkDim
  })
  body += text(64, 432, 'get_selection · add_to_selection · remove_from_selection', {
    size: 10.5,
    fill: colors.inkMuted
  })
  body += text(64, 450, 'clear_selection · materialize_selection', {
    size: 10.5,
    fill: colors.inkMuted
  })

  // Server ↔ LLM connector.
  body += verticalConnector(440, 472, 526, 'reads')

  // ----- Band 3: LLM -----------------------------------------------
  body += band(24, 526, 812, 104, 'LLM', {
    dot: colors.amber,
    labelFill: colors.amber
  })
  body += text(
    48,
    572,
    "Calls get_selection({ model:'activity' })  →  { ids:['1','3'], total:2 }",
    { size: 11.5, fill: colors.inkSoft }
  )
  body += text(48, 596, 'Uses IDs for', { size: 11.5, fill: colors.inkMuted })
  body += text(150, 596, 'bulk_action_models · update · export · …', {
    size: 11.5,
    fill: colors.accentSoft
  })

  const rendered = svg(width, height, 'SELECTION STORE · ARCHITECTURE', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

// ----- FIGURE 5: selection flow vertical pipeline ----------------------
// A stack of step panels joined by downward arrows.
function buildSelflowFigure() {
  const width = 760
  const insetX = 40
  const panelWidth = width - 80

  const altText =
    'Selection flow: user selects in UI, app calls an app-only select ' +
    'tool, SelectionStore.set persists it, the app sends a status message, ' +
    'then the LLM reads it back via the shared selection tools for ' +
    'follow-up operations.'

  // Each step: panel height, optional accent bar colour, body painter.
  const steps = [
    {
      height: 46,
      draw: (x, y, w) =>
        text(x + w / 2, y + 28, 'User selects records in UI', {
          size: 12.5,
          fill: colors.ink,
          anchor: 'middle'
        })
    },
    {
      height: 58,
      draw: (x, y, w) => {
        let painted = text(x + 20, y + 26, 'App calls select_*_records tool', {
          size: 12.5,
          fill: colors.ink
        })
        // Right-aligned visibility pill.
        painted += rect(x + w - 244, y + 18, 226, 24, {
          radius: 7,
          fill: colors.amber,
          fillOpacity: 0.08,
          stroke: colors.amber,
          strokeOpacity: 0.3
        })
        painted += text(x + w - 131, y + 34, "['app'] only · not LLM-callable", {
          size: 10,
          fill: colors.amber,
          anchor: 'middle'
        })
        return painted
      }
    },
    {
      height: 46,
      draw: (x, y, w) =>
        text(
          x + w / 2,
          y + 28,
          'SelectionStore.set({ model, mode, ids, filters, total, strategy })',
          { size: 12, fill: colors.accentSoft, anchor: 'middle' }
        )
    },
    {
      height: 60,
      draw: (x, y, w) => {
        let painted = text(x + 20, y + 26, 'App sends status message', {
          size: 12.5,
          fill: colors.ink
        })
        painted += text(x + 20, y + 46, '"Selection saved: 2 Activities" (replace)', {
          size: 11,
          fill: colors.teal
        })
        painted += text(x + w - 300, y + 46, '"Added 2 — total is now 5" (add)', {
          size: 11,
          fill: colors.teal
        })
        return painted
      }
    },
    {
      height: 58,
      draw: (x, y, _w) => {
        let painted = text(x + 20, y + 26, 'LLM calls the shared selection tools', {
          size: 12.5,
          fill: colors.ink
        })
        painted += text(
          x + 20,
          y + 46,
          'get_selection · add_to_selection · remove_from_selection · clear_selection · materialize_selection',
          { size: 10, fill: colors.inkMuted }
        )
        return painted
      }
    },
    {
      height: 46,
      accent: colors.teal,
      draw: (x, y, w) =>
        text(x + w / 2, y + 28, 'Returns stored selection → LLM uses it for follow-up operations', {
          size: 12,
          fill: colors.teal,
          anchor: 'middle'
        })
    }
  ]

  let body = ''
  let y = 60
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]
    body += rect(insetX, y, panelWidth, step.height, {
      radius: 9,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    if (step.accent) {
      body += rect(insetX, y, 3, step.height, {
        radius: 1.5,
        fill: step.accent
      })
    }
    body += step.draw(insetX, y, panelWidth)
    if (i < steps.length - 1) {
      body += arrowDown(insetX + panelWidth / 2, y + step.height, y + step.height + 30)
    }
    y += step.height + 30
  }

  const rendered = svg(width, y - 14, 'SELECTION FLOW', body, { alt: altText })

  return { svg: rendered, alt: altText }
}

// Each pilot figure id (`fig-overview`, `fig-dataflow`, `fig-tree2`,
// `fig-selection`, `fig-selflow`) becomes a named export with `fig-`
// stripped. Multi-figure pages do not export default.
export const overview = buildOverviewFigure()
export const dataflow = buildDataflowFigure()
export const tree2 = buildTreeFigure()
export const selection = buildSelectionFigure()
export const selflow = buildSelflowFigure()
