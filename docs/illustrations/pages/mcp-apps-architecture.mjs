// pages/mcp-apps-architecture.mjs
//
// Authoring source for the mcp-apps-architecture guide's illustrations.
// Ported from the pilot's mcp-apps-architecture.html. Two figures:
//   - layered: the three-layer client / server / api architecture diagram,
//              originally hand-written as a static <svg> in the pilot
//              (every primitive is reproduced via illus.mjs so the colour
//              tokens drive the theme).
//   - tree:    the src/mcp/apps/ directory tree (colourised ASCII).

import { colors, text, rect, line, svg, colorizeTree } from '../illus.mjs'

// Build the three-layer architecture diagram. Top band is the MCP client
// (with its sandboxed iframe and inbound / outbound notification rows),
// middle band is the MCP server (AppRegistry, app definitions, schema
// generators), bottom band is the Rails API. The two bands in between
// are joined by labelled protocol pills with arrow tips at each end.
function buildLayeredFigure() {
  const width = 880
  const height = 752

  const altText =
    'MCP Apps high-level architecture, three layers. Top: the MCP Client ' +
    '(Claude Desktop or COC) hosts a sandboxed iframe running the ' +
    'single-file MCP App bundle, which receives inbound notifications ' +
    '(ontoolinput, ontoolresult, onhostcontextchanged) and makes outbound ' +
    'callServerTool calls (validate_form, create_model, find_model_app). ' +
    'Middle, connected by the MCP protocol: the MCP Server, with an ' +
    'AppRegistry that registers tools and resources, seven App Definitions ' +
    'pairing a tool with a ui:// resource, and pure-function Schema ' +
    'Generators (form, list, detail). Bottom, connected by HTTP with a ' +
    'Bearer token: the Rails API providing association options, record ' +
    'CRUD and search endpoints.'

  let body = ''

  // ----- Band 1: MCP CLIENT ------------------------------------------
  // The outer band rectangle, plus a coloured dot + caps label and a
  // dim subtitle to the right of the label.
  body += rect(24, 56, 832, 240, {
    radius: 12,
    fill: colors.band,
    stroke: colors.panelStroke
  })
  body += `<circle cx="44" cy="82" r="4" fill="${colors.blue}"></circle>`
  body += text(56, 86, 'MCP CLIENT', {
    size: 12,
    letterSpacing: '0.12em',
    fill: colors.aqua
  })
  body += text(160, 86, 'Claude Desktop / COC', {
    size: 11,
    fill: colors.inkDim
  })

  // Sandboxed iframe sub-panel inside the client band.
  body += rect(44, 100, 792, 180, {
    radius: 10,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += text(64, 128, 'Sandboxed iframe', {
    size: 12,
    fill: colors.accentSoft
  })
  body += text(190, 128, 'single-file HTML / JS / CSS bundle', {
    size: 11,
    fill: colors.inkDim
  })
  body += line(64, 140, 816, 140, { stroke: colors.line, dash: '2 4' })

  // ----- Inbound notification rows (client → app) -------------------
  body += text(64, 166, 'INBOUND · client → app', {
    size: 10.5,
    letterSpacing: '0.06em',
    fill: colors.inkMuted
  })
  // Three inbound rows: each is a small left-pointing tip glyph + a
  // short horizontal stroke + label.
  const inboundRows = [
    [184, 'ontoolinput', 'LLM arguments'],
    [210, 'ontoolresult', 'schema + records'],
    [236, 'onhostcontextchanged', 'theme, fonts']
  ]
  for (const [rowY, label, sub] of inboundRows) {
    body +=
      `<path d="M76 ${rowY} l8 -4 v8 z" fill="${colors.blue}"></path>` +
      line(76, rowY, 92, rowY, { stroke: colors.blue, strokeWidth: 1.4 })
    body +=
      `<text x="100" y="${rowY + 4}" font-size="11.5" fill="${colors.ink}" xml:space="preserve">` +
      `${label} <tspan fill="${colors.inkDim}">· ${sub}</tspan></text>`
  }

  // ----- Outbound call rows (app → server) ---------------------------
  body += line(452, 156, 452, 262, { stroke: colors.line, dash: '2 4' })
  body += text(472, 166, 'OUTBOUND · app → server', {
    size: 10.5,
    letterSpacing: '0.06em',
    fill: colors.inkMuted
  })
  const outboundRows = [
    [184, 'validate_form'],
    [210, 'create_model'],
    [236, 'find_model_app']
  ]
  for (const [rowY, toolName] of outboundRows) {
    body += line(472, rowY, 486, rowY, {
      stroke: colors.accent,
      strokeWidth: 1.4
    })
    body += `<path d="M486 ${rowY - 4} l8 4 -8 4 z" fill="${colors.accent}"></path>`
    body +=
      `<text x="502" y="${rowY + 4}" font-size="11.5" fill="${colors.ink}" xml:space="preserve">` +
      `callServerTool(<tspan fill="${colors.teal}">'${toolName}'</tspan>)</text>`
  }

  // ----- Connector pill between client and server bands -------------
  // Vertical line with arrow tips at both ends and a centred pill
  // labelled "MCP protocol".
  body += line(440, 296, 440, 350, {
    stroke: colors.lineMid,
    strokeWidth: 1.5
  })
  body += `<path d="M436 300 L440 294 L444 300 Z" fill="${colors.accent}"></path>`
  body += `<path d="M436 346 L440 352 L444 346 Z" fill="${colors.accent}"></path>`
  body += rect(384, 312, 112, 22, {
    radius: 11,
    fill: colors.frame,
    stroke: colors.lineSoft
  })
  body += text(440, 327, 'MCP protocol', {
    size: 10.5,
    fill: colors.accentSoft,
    anchor: 'middle'
  })

  // ----- Band 2: MCP SERVER ------------------------------------------
  body += rect(24, 352, 832, 300, {
    radius: 12,
    fill: colors.band,
    stroke: colors.panelStroke
  })
  body += `<circle cx="44" cy="378" r="4" fill="${colors.accent}"></circle>`
  // labelFill '#c9b8ff' has no token in colors; keep as literal (matches
  // the pilot exactly and is intentionally lighter than accentSoft).
  body += text(56, 382, 'MCP SERVER', {
    size: 12,
    letterSpacing: '0.12em',
    fill: '#c9b8ff'
  })

  // AppRegistry sub-panel (single thin row at the top of the server band).
  body += rect(44, 396, 792, 50, {
    radius: 9,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += text(64, 417, 'AppRegistry', { size: 12, fill: colors.accentSoft })
  body +=
    `<text x="64" y="435" font-size="11" fill="${colors.inkMuted}" xml:space="preserve">` +
    `registerTools(mcpServer, { getAccessToken })` +
    `<tspan fill="${colors.lineMid}">  ·  </tspan>` +
    `registerResources(mcpServer)</text>`

  // ----- App Definitions sub-panel (left half) ----------------------
  body += rect(44, 458, 486, 178, {
    radius: 9,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body +=
    `<text x="64" y="482" font-size="12" fill="${colors.ink}" xml:space="preserve">` +
    `App Definitions <tspan fill="${colors.inkDim}">· tool → ui:// resource</tspan></text>`
  const appDefs = [
    [506, 'new_model_app', '→ ui://…/new-model-app'],
    [527, 'edit_model_app', '→ ui://…/edit-model-app'],
    [548, 'find_model_app', '→ ui://…/find-model-app'],
    [569, 'show_model_app', '→ ui://…/show-model-app'],
    [590, 'pick_model_app', '→ ui://…/pick-model-app'],
    [611, 'multi_pick_model_app', '→ ui://…/multi-pick-model-app'],
    [632, 'view_selection_app', '→ ui://…/view-selection-app']
  ]
  for (const [rowY, toolName, resource] of appDefs) {
    body += text(64, rowY, toolName, { size: 11, fill: colors.inkSoft })
    body += text(232, rowY, resource, { size: 11, fill: colors.teal })
  }

  // ----- Schema Generators sub-panel (right half) -------------------
  body += rect(546, 458, 290, 178, {
    radius: 9,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += text(566, 482, 'Schema Generators', { size: 12, fill: colors.ink })
  body += text(566, 500, 'pure functions · no API calls', {
    size: 10.5,
    fill: colors.inkDim
  })
  const generators = [
    [528, 'generateFormSchema', '(Model, Prompt)'],
    [556, 'generateListSchema', '(Model)'],
    [584, 'generateDetailSchema', '(Model, Prompt?)']
  ]
  for (const [rowY, fnName, signature] of generators) {
    body +=
      `<text x="566" y="${rowY}" font-size="11" fill="${colors.accentSoft}" xml:space="preserve">` +
      `${fnName}<tspan fill="${colors.inkDim}">${signature}</tspan></text>`
  }
  body += line(566, 602, 816, 602, { stroke: colors.line, dash: '2 4' })
  body += text(566, 622, 'deterministic · cache-friendly', {
    size: 10.5,
    fill: colors.inkDim
  })

  // ----- Connector pill between server and Rails API ----------------
  body += line(440, 652, 440, 706, {
    stroke: colors.lineMid,
    strokeWidth: 1.5
  })
  body += `<path d="M436 656 L440 650 L444 656 Z" fill="${colors.amber}"></path>`
  body += `<path d="M436 702 L440 708 L444 702 Z" fill="${colors.amber}"></path>`
  body += rect(368, 668, 144, 22, {
    radius: 11,
    fill: colors.frame,
    stroke: colors.lineSoft
  })
  body += text(440, 683, 'HTTP · Bearer token', {
    size: 10.5,
    fill: colors.amber,
    anchor: 'middle'
  })

  // ----- Band 3: RAILS API (thin band at the bottom) ----------------
  body += rect(24, 708, 832, 44, {
    radius: 10,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += `<circle cx="44" cy="730" r="4" fill="${colors.teal}"></circle>`
  body += text(56, 734, 'RAILS API', {
    size: 12,
    letterSpacing: '0.12em',
    fill: colors.teal
  })
  body += text(170, 734, 'association options · record CRUD · search endpoints', {
    size: 11,
    fill: colors.inkMuted
  })

  const rendered = svg(width, height, 'MCP APPS · HIGH-LEVEL ARCHITECTURE', body, { alt: altText })

  return { svg: rendered, alt: altText }
}

// Build the src/mcp/apps/ directory tree figure.
// Verbatim from the pilot's #tree-raw script block.
function buildTreeFigure() {
  const ascii = `src/mcp/apps/
├── lib/                               # Shared server-side helpers
│   ├── form-schema.ts                 # generateFormSchema() — pure function
│   ├── list-schema.ts                 # generateListSchema() — pure function
│   ├── detail-schema.ts               # generateDetailSchema() — pure function
│   ├── form-app-helpers.ts            # Shared form-app server helpers
│   ├── registry.ts                    # AppRegistry + createAppRegistry()
│   └── …                              # types, formatters, stores, etc.
│
├── new-model-app/                     # New-record form
│   ├── index.ts                       # Server factory
│   └── ui/                            # Iframe entry
│       ├── index.html
│       ├── app.js                     # Thin shim → shared/model-form/main.js
│       └── (no per-app CSS — shared)
│
├── edit-model-app/                    # Edit-record form
│   ├── index.ts
│   └── ui/                            # Thin shim → shared/model-form/main.js
│
├── find-model-app/                    # Browseable table + query + filter popover
│   ├── index.ts
│   └── ui/
│
├── show-model-app/                    # Record detail
│   ├── index.ts
│   └── ui/
│
├── view-selection-app/                # Inspect + manage the selection store
│   ├── index.ts
│   └── ui/
│
├── shared/                            # Cross-app iframe code
│   ├── app-init.js
│   ├── base.css
│   ├── helpers.js
│   ├── formatters.js / .runtime.js
│   └── model-form/                    # Shared form UI consumed by new + edit
│       ├── main.js                    # initModelFormApp() — bulk of form code
│       └── styles.css
│
├── vite.config.js                     # Multi-target build config
└── dist/                              # Built single-file HTML (git-tracked)
    ├── new-model-app.html
    ├── edit-model-app.html
    ├── find-model-app.html
    ├── show-model-app.html
    └── view-selection-app.html`

  const altText =
    'Directory tree of src/mcp/apps/: lib/ (shared server-side helpers ' +
    'including form-schema, list-schema, detail-schema, form-app-helpers, ' +
    'registry); one folder per app (new-model-app, edit-model-app, ' +
    'find-model-app, show-model-app, view-selection-app), each with an ' +
    'index.ts server factory and a ui/ iframe entry; shared/ cross-app ' +
    'iframe code (app-init, base.css, helpers, formatters, model-form ' +
    'subfolder); vite.config.js; and dist/ holding the git-tracked ' +
    'single-file HTML build outputs.'

  return { svg: colorizeTree(ascii), alt: altText }
}

export const layered = buildLayeredFigure()
export const tree = buildTreeFigure()
