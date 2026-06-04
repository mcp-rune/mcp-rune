// pages/oauth2-discovery-flow.mjs
//
// Authoring source for the oauth2-discovery-flow guide's illustration.
// Ported from the pilot's oauth2-discovery-flow.html (inline SVG).
// One figure: the full proxied OAuth2 handshake across three actors,
// rendered as a phased sequence diagram.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the proxied OAuth2 discovery sequence diagram.
function buildFlowFigure() {
  // Canvas — matches the pilot's 860×690 viewBox.
  const width = 860
  const height = 690

  const altText =
    'OAuth2 discovery sequence between Client, MCP Server, and Auth ' +
    'Server. The client posts to /mcp without a token and gets a 401 ' +
    'with a WWW-Authenticate header (RFC 9728). It discovers ' +
    'protected-resource and authorization-server metadata, performs ' +
    'dynamic client registration (RFC 7591), authorizes with PKCE ' +
    '(RFC 6749/8707), exchanges the code for access and refresh ' +
    'tokens, then reconnects to /mcp with a Bearer token; the server ' +
    'introspects it and serves MCP tools. The MCP server proxies ' +
    'registration, authorize, token and introspection to the upstream ' +
    'auth server.'

  // The three lifeline x-coordinates: client (left), MCP server
  // (middle), auth server (right). Used by every message row below.
  const clientX = 150
  const mcpX = 460
  const authX = 760
  // Mid-point between client and MCP — anchors centred message labels.
  const midX = 305

  let body = ''

  // ----- Lifelines (three vertical dashed rules) -----------------------
  body += line(clientX, 104, clientX, 676, {
    stroke: colors.panelStroke,
    dash: '2 5'
  })
  body += line(mcpX, 104, mcpX, 676, {
    stroke: colors.panelStroke,
    dash: '2 5'
  })
  body += line(authX, 104, authX, 676, {
    stroke: colors.panelStroke,
    dash: '2 5'
  })

  // ----- Actor labels at the top --------------------------------------
  body += rect(104, 74, 92, 28, {
    radius: 8,
    fill: colors.panelHead,
    stroke: colors.lineSoft
  })
  body += text(clientX, 92, 'Client', {
    size: 12,
    fill: colors.ink,
    anchor: 'middle'
  })
  // MCP server is highlighted in accent — it's the actor the guide is
  // about.
  body += rect(404, 74, 112, 28, {
    radius: 8,
    fill: colors.accent,
    fillOpacity: 0.14,
    stroke: colors.accent,
    strokeOpacity: 0.45
  })
  body += text(mcpX, 92, 'MCP Server', {
    size: 12,
    fill: colors.accentSoft,
    anchor: 'middle'
  })
  body += rect(708, 74, 104, 28, {
    radius: 8,
    fill: colors.panelHead,
    stroke: colors.lineSoft
  })
  body += text(authX, 92, 'Auth Server', {
    size: 12,
    fill: colors.ink,
    anchor: 'middle'
  })

  // ----- Phase-band helper --------------------------------------------
  // A thin dashed rule across the canvas with a small caps-label pill
  // centred over the MCP lifeline. Marks the start of each RFC stage.
  function phaseBand(y, label, pillX, pillW) {
    let result = line(28, y, 832, y, {
      stroke: colors.frameStroke,
      dash: '1 5'
    })
    result += rect(pillX, y - 9, pillW, 18, {
      radius: 9,
      fill: colors.frame
    })
    result += text(mcpX, y + 4, label, {
      size: 10,
      fill: colors.inkDim,
      anchor: 'middle',
      letterSpacing: '0.06em'
    })
    return result
  }

  // ----- Message-row helpers ------------------------------------------
  // Solid right-going arrow (client → MCP).
  function clientToMcp(y) {
    let result = line(clientX + 8, y, mcpX - 8, y, {
      stroke: colors.accent,
      strokeWidth: 1.6
    })
    result += `<path d="M${mcpX - 12} ${y - 4} L${mcpX} ${y} L${mcpX - 12} ${y + 4} Z" fill="${colors.accent}"></path>`
    return result
  }
  // Dashed left-going reply (MCP → client).
  function mcpToClient(y) {
    let result = line(mcpX - 8, y, clientX + 8, y, {
      stroke: colors.inkDim,
      strokeWidth: 1.4,
      dash: '5 4'
    })
    result += `<path d="M${clientX + 12} ${y - 4} L${clientX} ${y} L${clientX + 12} ${y + 4} Z" fill="${colors.inkDim}"></path>`
    return result
  }
  // Solid right-going arrow (MCP → auth).
  function mcpToAuth(y) {
    let result = line(mcpX + 10, y, authX - 10, y, {
      stroke: colors.lineMid,
      strokeWidth: 1.3
    })
    result += `<path d="M${authX - 14} ${y - 4} L${authX - 2} ${y} L${authX - 14} ${y + 4} Z" fill="${colors.inkFaint}"></path>`
    return result
  }
  // Both-tipped proxied arrow (MCP ↔ auth — drawn as MCP→auth with an
  // extra incoming tip on the MCP side).
  function mcpProxiedAuth(y) {
    let result = mcpToAuth(y)
    result += `<path d="M${mcpX + 14} ${y - 4} L${mcpX + 2} ${y} L${mcpX + 14} ${y + 4} Z" fill="${colors.inkFaint}"></path>`
    return result
  }

  // ===== Phase 1 — Discovery · 401 =====================================
  body += phaseBand(128, 'DISCOVERY · 401', 392, 136)

  body += text(midX, 150, 'POST /mcp  (no token)', {
    size: 11,
    fill: colors.inkSoft,
    anchor: 'middle'
  })
  body += clientToMcp(158)

  // 401 reply — uses an inline <tspan> so the RFC ref is rendered
  // dimmer than the rest of the label.
  body += `<text x="${midX}" y="182" font-size="11" fill="${colors.inkMuted}" text-anchor="middle" xml:space="preserve">`
  body += `401 · WWW-Authenticate: Bearer <tspan fill="${colors.inkDim}">· RFC 9728</tspan></text>`
  body += mcpToClient(190)

  // ===== Phase 2 — Metadata discovery ==================================
  body += phaseBand(214, 'METADATA DISCOVERY', 376, 168)

  body += `<text x="${midX}" y="236" font-size="11" fill="${colors.inkSoft}" text-anchor="middle" xml:space="preserve">`
  body += `GET protected-resource metadata <tspan fill="${colors.inkDim}">· 9728</tspan></text>`
  body += clientToMcp(244)

  body += text(midX, 268, '{ resource, authorization_servers }', {
    size: 11,
    fill: colors.inkMuted,
    anchor: 'middle'
  })
  body += mcpToClient(276)

  body += `<text x="${midX}" y="300" font-size="11" fill="${colors.inkSoft}" text-anchor="middle" xml:space="preserve">`
  body += `GET authorization-server metadata <tspan fill="${colors.inkDim}">· 8414</tspan></text>`
  body += clientToMcp(308)
  // Upstream fetch label + proxied arrow (MCP ↔ auth).
  body += text(610, 300, 'fetch + rewrite upstream', {
    size: 10.5,
    fill: colors.inkDim,
    anchor: 'middle'
  })
  body += mcpProxiedAuth(308)

  // ===== Phase 3 — Dynamic client registration =========================
  body += phaseBand(332, 'DYNAMIC CLIENT REGISTRATION', 362, 196)

  body += `<text x="${midX}" y="354" font-size="11" fill="${colors.inkSoft}" text-anchor="middle" xml:space="preserve">`
  body += `POST /oauth/register <tspan fill="${colors.inkDim}">· RFC 7591</tspan></text>`
  body += clientToMcp(362)
  body += text(610, 354, 'proxied', {
    size: 10.5,
    fill: colors.inkDim,
    anchor: 'middle'
  })
  body += mcpProxiedAuth(362)

  body += text(midX, 386, '{ client_id, client_secret }', {
    size: 11,
    fill: colors.inkMuted,
    anchor: 'middle'
  })
  body += mcpToClient(394)

  // ===== Phase 4 — Authorization · PKCE ================================
  body += phaseBand(418, 'AUTHORIZATION · PKCE', 372, 176)

  body += `<text x="${midX}" y="440" font-size="11" fill="${colors.inkSoft}" text-anchor="middle" xml:space="preserve">`
  body += `GET /oauth/authorize <tspan fill="${colors.inkDim}">· 6749 + PKCE + 8707</tspan></text>`
  body += clientToMcp(448)
  body += text(610, 440, '302 redirect', {
    size: 10.5,
    fill: colors.inkDim,
    anchor: 'middle'
  })
  body += mcpToAuth(448)

  // Interstitial note — the user authenticates on the auth server.
  body += rect(176, 466, 568, 26, {
    radius: 7,
    fill: colors.band,
    stroke: colors.frameStroke
  })
  body += text(
    mcpX,
    483,
    'user authenticates on auth server → redirect to /oauth/callback with auth code',
    { size: 10.5, fill: colors.inkMuted, anchor: 'middle' }
  )

  // ===== Phase 5 — Token exchange ======================================
  body += phaseBand(512, 'TOKEN EXCHANGE', 386, 148)

  body += `<text x="${midX}" y="534" font-size="11" fill="${colors.inkSoft}" text-anchor="middle" xml:space="preserve">`
  body += `POST /oauth/token <tspan fill="${colors.inkDim}">· PKCE + resource</tspan></text>`
  body += clientToMcp(542)
  body += text(610, 534, 'proxied', {
    size: 10.5,
    fill: colors.inkDim,
    anchor: 'middle'
  })
  body += mcpProxiedAuth(542)

  body += text(midX, 566, '{ access_token, refresh_token }', {
    size: 11,
    fill: colors.inkMuted,
    anchor: 'middle'
  })
  body += mcpToClient(574)

  // ===== Phase 6 — Authenticated session ===============================
  body += phaseBand(598, 'AUTHENTICATED SESSION', 368, 184)

  body += text(midX, 620, 'POST /mcp + Authorization: Bearer', {
    size: 11,
    fill: colors.inkSoft,
    anchor: 'middle'
  })
  body += clientToMcp(628)
  body += text(610, 620, 'introspect (cached)', {
    size: 10.5,
    fill: colors.inkDim,
    anchor: 'middle'
  })
  body += mcpProxiedAuth(628)

  // Final teal reply — session created.
  body += text(midX, 652, 'Session created · MCP tools served', {
    size: 11,
    fill: colors.teal,
    anchor: 'middle'
  })
  body += line(mcpX - 8, 660, clientX + 8, 660, {
    stroke: colors.tealDeep,
    strokeWidth: 1.5,
    dash: '5 4'
  })
  body += `<path d="M${clientX + 12} 656 L${clientX} 660 L${clientX + 12} 664 Z" fill="${colors.teal}"></path>`

  const rendered = svg(width, height, 'OAUTH2 DISCOVERY · PROXIED FLOW', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const flow = buildFlowFigure()
export default flow
