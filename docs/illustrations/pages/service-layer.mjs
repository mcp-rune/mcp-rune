// pages/service-layer.mjs
//
// Authoring source for the service-layer guide's illustration.
// Ported from the pilot's service-layer.html. Two figures: the
// composition funnel from tools down to ApiClient, and the
// EndpointResolver resolution chain for a findById call.

import { colors, text, rect, line, arrowDown, svg } from '../illus.mjs'

// Build the service-layer composition funnel. Inlined from the pilot's
// shared `serviceFunnel()` composite in illus.js so this page is
// self-contained. The same composite is also inlined in tool-creation.mjs.
function buildFunnelFigure() {
  const altText =
    'The MCP tool layer delegates to ModelService and SearchService, ' +
    'which compose EndpointResolver, the shared Convention and ' +
    'SearchAdapter, all bottoming out at a single HTTP ApiClient.'

  // Helper: a rounded panel with a centred title (and optional sub).
  // Used for every box in the funnel.
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

  // Helper: a smooth cubic-bezier connector between two points,
  // matching the curvy "funnel" links from the pilot composite.
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
  // Two links from the tool layer down into the two services.
  body += funnelLink(240, 128, 220, 168)
  body += funnelLink(440, 128, 500, 168)
  body += funnelNode(120, 168, 200, 60, 'ModelService', 'CRUD ops', {
    titleFill: colors.accentSoft
  })
  body += funnelNode(400, 168, 200, 60, 'SearchService', 'search / lookup', {
    titleFill: colors.accentSoft
  })

  // ----- Lower row: composition pieces ------------------------------
  // EndpointResolver, the shared Convention, and SearchAdapter.
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

  // Connectors from services down into the composition row. Both
  // ModelService and SearchService reach into Convention (the shared
  // middle piece) — hence two links crossing into x=380.
  body += funnelLink(180, 228, 131, 288)
  body += funnelLink(240, 228, 340, 288)
  body += funnelLink(500, 228, 553, 288)
  body += funnelLink(520, 228, 380, 288)

  // Tiny "shared" caption above the Convention box to call out its role.
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

// Build the EndpointResolver resolution-chain trace for a findById call.
// A top pill (the originating call), a middle panel listing the four
// resolution steps, and a bottom pill (the final HTTP call).
function buildChainFigure() {
  const width = 720
  const x = 70
  const w = width - 140

  const altText =
    "ModelService.findById('book', 42) calls EndpointResolver.resolveRecord, " +
    'which checks api.endpoints.find, then api.endpoints.record (replacing ' +
    ':id), then whether the recordId is a compound path, then namespace plus ' +
    'endpoint giving /api/v1/books/42; first match wins and the result is ' +
    "apiClient.get('/api/v1/books/42')."

  let body = ''

  // ----- Top pill: the originating ModelService call -----------------
  body += rect(x + w / 2 - 150, 52, 300, 34, {
    radius: 8,
    fill: colors.panelHead,
    stroke: colors.panelStroke
  })
  body += text(width / 2, 74, "ModelService.findById('book', 42)", {
    size: 12,
    fill: colors.accentSoft,
    anchor: 'middle'
  })
  body += arrowDown(width / 2, 86, 112)

  // ----- Middle panel: EndpointResolver with its four checks ---------
  body += rect(x, 118, w, 176, {
    radius: 10,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  // Header bar (rounded top, square bottom is faked with a thin overlap).
  body += rect(x, 118, w, 38, { radius: 10, fill: colors.panelHead })
  body += rect(x, 146, w, 10, { fill: colors.panelHead })
  body += text(x + 20, 142, "EndpointResolver.resolveRecord({ model, recordId: '42' })", {
    size: 12,
    fill: colors.ink
  })

  // The four resolution steps: [number, question, result].
  const steps = [
    ['1', 'api.endpoints.find?', 'use it'],
    ['2', 'api.endpoints.record?', "replace ':id' with '42'"],
    ['3', "recordId contains '/'?", 'use compound id as path'],
    ['4', 'namespace + endpoint', '/api/v1/books/42']
  ]
  let stepY = 182
  for (const [number, question, result] of steps) {
    body += text(x + 22, stepY, number + '.', {
      size: 11.5,
      fill: colors.accentSoft
    })
    body += text(x + 42, stepY, question, {
      size: 11.5,
      fill: colors.inkSoft
    })
    body += text(x + 250, stepY, '─▶', { size: 11, fill: colors.inkDim })
    // The winning step (4) is highlighted in teal.
    body += text(x + 286, stepY, result, {
      size: 11.5,
      fill: number === '4' ? colors.teal : colors.inkMuted
    })
    stepY += 24
  }

  // Dashed divider + footer caption inside the panel.
  body += line(x + 16, stepY - 8, x + w - 16, stepY - 8, {
    stroke: colors.line,
    dash: '2 4'
  })
  body += text(x + 22, stepY + 12, 'First match wins · explicit overrides bypass namespace', {
    size: 10.5,
    fill: colors.inkDim
  })

  // ----- Drop-arrow to the final apiClient call ---------------------
  body += arrowDown(width / 2, 294, 330, { color: colors.teal })

  // ----- Bottom pill: the resolved apiClient HTTP call --------------
  // The fill keeps the pilot's teal-tinted background; the closest
  // palette token is `colors.teal` used as a translucent fill.
  body += rect(x + w / 2 - 150, 336, 300, 34, {
    radius: 8,
    fill: colors.teal,
    fillOpacity: 0.06,
    stroke: colors.tealDeep
  })
  body += text(width / 2, 358, "apiClient.get('/api/v1/books/42')", {
    size: 12,
    fill: colors.teal,
    anchor: 'middle'
  })

  const rendered = svg(width, 392, 'RESOLUTION CHAIN', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const funnel = buildFunnelFigure()
export const chain = buildChainFigure()
