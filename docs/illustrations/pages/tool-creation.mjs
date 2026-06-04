// pages/tool-creation.mjs
//
// Authoring source for the tool-creation guide's illustration.
// Ported from the pilot's tool-creation.html. Four figures: the
// two-layer directory tree, the inheritance chain, the service-layer
// composition funnel, and the interceptor pipeline.

import { colors, text, rect, line, arrowDown, svg, colorizeTree } from '../illus.mjs'

// Build the two-layer directory tree.
function buildTreeFigure() {
  const ascii = `mcp-rune/src/mcp/tools/
├── base-tool.ts              # BaseTool — root base class (with serverContext)
├── save-model-base-tool.ts   # SaveModelBaseTool — base for create/update tools
├── tool-registry.ts          # ToolRegistry — convention-based tool registration
├── tool-pipeline.ts          # ToolInterceptor + wrapToolHandler
├── interceptors.ts           # Built-in interceptors (logging, tracing, error-catch)
├── validators.ts             # Generic model validators
├── categories.ts             # Tool category definitions
└── data/                     # Generic CRUD tools (reusable across servers)
    ├── list-models-tool.ts
    ├── find-records-tool.ts
    ├── create-model-tool.ts
    ├── update-model-tool.ts
    └── delete-model-tool.ts

your-server/tools/
├── base-tool.js              # ServerBaseTool — extends mcp-rune BaseTool
├── registry.js               # Factory using mcp-rune ToolRegistry
└── {custom}-tool.js          # Server-specific tools only`

  const altText =
    'Two directory trees: mcp-rune/src/mcp/tools/ contains the framework ' +
    'BaseTool, SaveModelBaseTool, ToolRegistry, the tool pipeline, ' +
    'built-in interceptors, validators, categories, and a data/ folder of ' +
    'generic CRUD tools (list, find, create, update, delete). The server ' +
    'side has its own ServerBaseTool extending the framework one, a ' +
    'registry factory, and server-specific custom tools.'

  return { svg: colorizeTree(ascii), alt: altText }
}

// Build the inheritance-chain figure. Nested class boxes connected
// by elbow lines: BaseTool branches to data/*.ts and ServerBaseTool;
// ServerBaseTool further branches to {custom}-tool.js.
function buildInheritFigure() {
  const width = 760

  const altText =
    'BaseTool from mcp-rune is extended by generic CRUD tools and by ' +
    'your ServerBaseTool, which in turn is extended by your custom tools.'

  // Helper: a class card — left accent bar + title + optional sub.
  function classBox(x, y, w, title, sub, options = {}) {
    const fill = options.fill ?? colors.panel
    const stroke = options.stroke ?? colors.panelStroke
    const barColor = options.bar ?? colors.accent
    const titleFill = options.titleFill ?? colors.ink
    let out = rect(x, y, w, 42, { radius: 9, fill, stroke })
    out += rect(x, y, 3, 42, { radius: 1.5, fill: barColor })
    out += text(x + 20, y + 20, title, { size: 12.5, fill: titleFill })
    if (sub) {
      out += text(x + 20, y + 34, sub, { size: 10.5, fill: colors.inkDim })
    }
    return out
  }

  let body = ''

  // ----- Root: BaseTool ---------------------------------------------
  body += classBox(40, 56, 300, 'BaseTool', 'root base · mcp-rune', {
    bar: colors.accentSoft,
    titleFill: colors.accentSoft
  })

  // ----- Branch connectors down to the two children ------------------
  // Vertical spine plus two elbow runs to the child cards.
  body += line(70, 98, 70, 210, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  body += line(70, 150, 120, 150, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  body += line(70, 210, 120, 210, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })

  // ----- Children of BaseTool: generic CRUD + ServerBaseTool --------
  body += classBox(120, 129, 420, 'data/*.ts', 'generic CRUD tools · from mcp-rune', {
    bar: colors.teal
  })
  body += classBox(120, 189, 420, 'ServerBaseTool', 'your server', {
    bar: colors.amber,
    titleFill: colors.amber
  })

  // ----- Sub-branch: ServerBaseTool → {custom}-tool.js --------------
  body += line(150, 231, 150, 290, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  body += line(150, 290, 200, 290, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  body += classBox(200, 269, 400, '{custom}-tool.js', 'server-specific tools', {
    bar: colors.accent
  })

  const rendered = svg(width, 340, 'TOOL · INHERITANCE CHAIN', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

// Build the service-layer composition funnel. Inlined from the pilot's
// shared `serviceFunnel()` composite — duplicated here so this page is
// self-contained. The same composite is also inlined in
// service-layer.mjs; duplication is accepted per the porting plan.
function buildServiceFigure() {
  const altText =
    'The MCP tool layer delegates to ModelService and SearchService; ' +
    'ModelService composes EndpointResolver and the shared Convention, ' +
    'SearchService composes SearchAdapter and Convention; all bottom out ' +
    'at a single HTTP ApiClient.'

  // Helper: a rounded panel with a centred title (and optional sub).
  function funnelNode(x, y, w, h, title, sub, options = {}) {
    const fill = options.fill ?? colors.panel
    const stroke = options.stroke ?? colors.panelStroke
    const titleSize = options.titleSize ?? 12.5
    const titleFill = options.titleFill ?? colors.ink
    let out = rect(x, y, w, h, { radius: 9, fill, stroke })
    out += text(x + w / 2, y + (sub ? h / 2 - 2 : h / 2 + 4), title, {
      size: titleSize,
      fill: titleFill,
      anchor: 'middle'
    })
    if (sub) {
      out += text(x + w / 2, y + h / 2 + 15, sub, {
        size: 10.5,
        fill: colors.inkDim,
        anchor: 'middle'
      })
    }
    return out
  }

  // Helper: a smooth cubic-bezier connector between two points.
  function funnelLink(x1, y1, x2, y2) {
    const midY = (y1 + y2) / 2
    return (
      `<path d="M${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" ` +
      `fill="none" stroke="${colors.lineMid}" stroke-width="1.4"></path>`
    )
  }

  let body = ''

  // ----- Top band: the MCP Tool Layer --------------------------------
  body += rect(40, 56, 640, 72, {
    radius: 10,
    fill: colors.band,
    stroke: colors.panelStroke
  })
  body += rect(40, 56, 3, 72, { radius: 1.5, fill: colors.accent })
  body += text(60, 84, 'MCP Tool Layer', { size: 13, fill: colors.ink })
  body += text(60, 106, 'input validation · response formatting · vector storage · usage rules', {
    size: 11,
    fill: colors.inkMuted
  })

  // ----- Mid row: ModelService + SearchService ----------------------
  body += funnelLink(240, 128, 220, 168)
  body += funnelLink(440, 128, 500, 168)
  body += funnelNode(120, 168, 200, 60, 'ModelService', 'CRUD ops', {
    titleFill: colors.accentSoft
  })
  body += funnelNode(400, 168, 200, 60, 'SearchService', 'search / lookup', {
    titleFill: colors.accentSoft
  })

  // ----- Lower row: composition pieces ------------------------------
  body += funnelNode(56, 288, 150, 60, 'EndpointResolver', 'URLs', {
    titleSize: 11.5
  })
  body += funnelNode(286, 288, 150, 60, 'Convention', 'payload / response', {
    titleSize: 11.5,
    stroke: colors.lineMid
  })
  body += funnelNode(478, 288, 170, 60, 'SearchAdapter', 'query body building', {
    titleSize: 11.5
  })

  // Service-to-component links — crossing into Convention from both sides.
  body += funnelLink(180, 228, 131, 288)
  body += funnelLink(240, 228, 340, 288)
  body += funnelLink(500, 228, 553, 288)
  body += funnelLink(520, 228, 380, 288)

  // The "shared" caption above the Convention node.
  body += text(361, 272, 'shared', {
    size: 9.5,
    fill: colors.inkDim,
    anchor: 'middle',
    letterSpacing: '0.1em'
  })

  // ----- Bottom: the single ApiClient that everything bottoms out at -
  body += funnelNode(280, 400, 160, 60, 'ApiClient', 'HTTP', {
    titleFill: colors.teal
  })
  body += funnelLink(131, 348, 330, 400)
  body += funnelLink(361, 348, 360, 400)
  body += funnelLink(563, 348, 390, 400)

  const rendered = svg(720, 480, 'SERVICE LAYER · COMPOSITION', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

// Build the interceptor pipeline diagram. A vertical stack of stages:
// request → wrapToolHandler → logging (before) → tracing (before) →
// errorInterceptor (around, wrapping YourTool.execute) → tracing
// (after) + logging (after) → MCP response.
function buildPipelineFigure() {
  const width = 680
  const x = 70
  const w = width - 140

  const altText =
    'A tool call is wrapped by wrapToolHandler, passes loggingInterceptor ' +
    'and tracingInterceptor before, then errorInterceptor wraps ' +
    'YourTool.execute (input validation, service calls, return shaped ' +
    'result; catch becomes an MCP error), then tracing and logging close ' +
    'after, producing the MCP response.'

  // Mutable accumulators — `body` is the SVG output, `y` is the next-row
  // cursor. `needsArrow` toggles after the first stage so subsequent
  // stages are linked by a down-arrow.
  let body = ''
  let y = 54
  let needsArrow = false

  // Helper: render one pipeline stage box, optionally with a side tag
  // ("before"/"after"/"around"), and advance the cursor.
  function appendStage(stageHeight, stageFill, drawInner, tag, tagColor) {
    body += rect(x, y, w, stageHeight, {
      radius: 9,
      fill: stageFill ?? colors.panel,
      stroke: colors.panelStroke
    })
    drawInner(y)
    if (tag) {
      body += text(x + w + 10, y + stageHeight / 2 + 4, tag, {
        size: 10.5,
        fill: tagColor ?? colors.inkDim
      })
    }
    const nextY = y + stageHeight + 26
    if (needsArrow) {
      body += arrowDown(x + w / 2, y + stageHeight, nextY - 6)
    }
    needsArrow = true
    y = nextY
  }

  // ----- Top: the incoming MCP request -------------------------------
  body += text(width / 2, y + 4, 'MCP request: { tool: "create_model", args: {…} }', {
    size: 11.5,
    fill: colors.inkSoft,
    anchor: 'middle'
  })
  y += 22
  body += arrowDown(width / 2, y, y + 24)
  y += 24

  // ----- Outer wrapper: wrapToolHandler ------------------------------
  appendStage(40, colors.band, (stageY) => {
    body += text(x + 20, stageY + 25, 'wrapToolHandler(handler, [interceptors])', {
      size: 12,
      fill: colors.accentSoft
    })
  })

  // ----- Before-phase interceptors: logging, then tracing ------------
  appendStage(
    38,
    null,
    (stageY) => {
      body += text(x + 20, stageY + 24, 'loggingInterceptor', {
        size: 12,
        fill: colors.ink
      })
      body += text(x + 200, stageY + 24, '(start, args)', {
        size: 11,
        fill: colors.inkDim
      })
    },
    'before',
    colors.blue
  )

  appendStage(
    38,
    null,
    (stageY) => {
      body += text(x + 20, stageY + 24, 'tracingInterceptor', {
        size: 12,
        fill: colors.ink
      })
      body += text(x + 200, stageY + 24, '(span open)', {
        size: 11,
        fill: colors.inkDim
      })
    },
    'before',
    colors.blue
  )

  // ----- Around-phase: errorInterceptor wrapping YourTool.execute ----
  // This stage is hand-drawn (not via appendStage) because it nests an
  // inner panel and has its own custom internal layout. The rose-tinted
  // fill and deeper stroke come from the pilot — no token captures them
  // exactly, so we use rose for the stroke approximation.
  body += rect(x, y, w, 118, {
    radius: 9,
    fill: colors.rose,
    fillOpacity: 0.04,
    stroke: colors.rose,
    strokeOpacity: 0.5
  })
  body += text(x + 20, y + 24, 'errorInterceptor', {
    size: 12,
    fill: colors.rose
  })
  body += text(x + 200, y + 24, 'try { … } catch', {
    size: 11,
    fill: colors.inkDim
  })
  body += text(x + w + 10, y + 24, 'around', {
    size: 10.5,
    fill: colors.rose
  })

  // Nested panel: the user's tool.execute() lives inside the catch.
  body += rect(x + 24, y + 38, w - 48, 52, {
    radius: 8,
    fill: colors.panel,
    stroke: colors.lineMid
  })
  body += text(x + 42, y + 58, 'YourTool.execute(args, context)', {
    size: 11.5,
    fill: colors.teal
  })
  body += text(x + w - 30, y + 58, '← your code', {
    size: 10,
    fill: colors.inkDim,
    anchor: 'end'
  })
  body += text(
    x + 42,
    y + 78,
    'input validation · service calls (DataLayer) · return shaped result',
    { size: 10, fill: colors.inkMuted }
  )
  body += text(x + 20, y + 108, 'catch → MCP-shaped error response', {
    size: 10.5,
    fill: colors.rose
  })

  // Advance past this hand-drawn stage and draw the inbound arrow that
  // appendStage would normally add.
  y += 118 + 26
  body += arrowDown(width / 2, y - 26, y - 6)

  // ----- After-phase: tracing close + logging finish -----------------
  appendStage(
    56,
    null,
    (stageY) => {
      body += text(x + 20, stageY + 24, 'tracingInterceptor', {
        size: 12,
        fill: colors.ink
      })
      body += text(x + 200, stageY + 24, '(span close)', {
        size: 11,
        fill: colors.inkDim
      })
      body += text(x + 20, stageY + 44, 'loggingInterceptor', {
        size: 12,
        fill: colors.ink
      })
      body += text(x + 200, stageY + 44, '(duration, status)', {
        size: 11,
        fill: colors.inkDim
      })
    },
    'after',
    colors.teal
  )

  // ----- Footer: the outgoing MCP response ---------------------------
  body += text(width / 2, y + 4, 'MCP response', {
    size: 12,
    fill: colors.ink,
    anchor: 'middle'
  })

  const rendered = svg(width, y + 24, 'TOOL PIPELINE', body, { alt: altText })
  return { svg: rendered, alt: altText }
}

export const tree = buildTreeFigure()
export const inherit = buildInheritFigure()
export const service = buildServiceFigure()
export const pipeline = buildPipelineFigure()
