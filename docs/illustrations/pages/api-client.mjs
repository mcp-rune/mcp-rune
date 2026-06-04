// pages/api-client.mjs
//
// Authoring source for the api-client guide's illustration.
// Ported from the pilot's api-client.html. The pilot inlined the SVG
// directly (no buildable script block); this module reproduces that
// figure using the shared DSL.

import { colors, text, rect, svg } from '../illus.mjs'

// Build the per-request API client lifecycle pipeline. Two top boxes
// (incoming request + per-session OAuthService) fold into a sessionId
// pill, then drop through getValidAccessToken → createApiClient →
// the tool/app handler that uses the per-request ApiClient.
function buildLifecycleFigure() {
  const width = 560
  const height = 500

  const altText =
    'Per-request API client lifecycle: an incoming MCP tool request ' +
    'and the per-session OAuthService combine via sessionId into ' +
    'getValidAccessToken, which yields a token; createApiClient builds ' +
    'an ApiClient that lives for one request; the tool or app handler ' +
    'then calls apiClient.get/post.'

  let body = ''

  // ----- Top row: incoming request + OAuthService ---------------------
  // Incoming MCP tool request (left).
  body += rect(44, 50, 212, 60, {
    radius: 9,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += text(60, 78, 'Incoming MCP', { size: 12.5, fill: colors.ink })
  body += text(60, 96, 'tool request', { size: 12.5, fill: colors.inkMuted })

  // OAuthService, per session (right).
  body += rect(304, 50, 212, 60, {
    radius: 9,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += text(320, 78, 'OAuthService', { size: 12.5, fill: colors.ink })
  body += text(320, 96, '(per session)', { size: 12.5, fill: colors.inkMuted })

  // ----- Junction: the two top boxes fold into a sessionId pill -------
  // Inverted-U path joining the two boxes' bottoms above the pill.
  body += `<path d="M150 110 V134 H410 V110" fill="none" stroke="${colors.lineSoft}" stroke-width="1.25"></path>`
  body += rect(236, 122, 88, 20, { radius: 10, fill: colors.frame })
  body += text(280, 136, 'sessionId', {
    size: 10.5,
    fill: colors.inkMuted,
    anchor: 'middle'
  })
  // Drop arrow from the sessionId pill into getValidAccessToken.
  body += `<path d="M280 134 V160" fill="none" stroke="${colors.accent}" stroke-width="1.75"></path>`
  body += `<path d="M274 156 L280 168 L286 156 Z" fill="${colors.accent}"></path>`

  // ----- getValidAccessToken panel ------------------------------------
  body += rect(120, 170, 320, 84, {
    radius: 9,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += rect(120, 170, 3, 84, { radius: 1.5, fill: colors.accent })
  body += text(142, 198, 'getValidAccessToken(sessionId)', {
    size: 12.5,
    fill: colors.accentSoft
  })
  body += text(142, 220, '→ token', { size: 12, fill: colors.ink })
  body += text(142, 240, 'auto-refresh · 5 min expiry buffer', {
    size: 11,
    fill: colors.inkMuted
  })

  // Drop arrow into createApiClient.
  body += `<path d="M280 254 V286" fill="none" stroke="${colors.accent}" stroke-width="1.75"></path>`
  body += `<path d="M274 282 L280 294 L286 282 Z" fill="${colors.accent}"></path>`

  // ----- createApiClient panel ----------------------------------------
  body += rect(120, 296, 320, 72, {
    radius: 9,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += rect(120, 296, 3, 72, { radius: 1.5, fill: colors.accent })
  body += text(142, 324, 'createApiClient(token, { apiUrl })', {
    size: 12.5,
    fill: colors.accentSoft
  })
  body += text(142, 346, '→ ApiClient instance', { size: 12, fill: colors.ink })

  // Drop arrow into the handler box, with a "lifetime = ONE request"
  // side-label flagged off to the right.
  body += `<path d="M280 368 V400" fill="none" stroke="${colors.accent}" stroke-width="1.75"></path>`
  body += `<path d="M274 396 L280 408 L286 396 Z" fill="${colors.accent}"></path>`
  body += `<path d="M298 374 h10 v20 h-10" fill="none" stroke="${colors.lineSoft}" stroke-width="1.25"></path>`
  body += text(314, 388, 'lifetime = ONE request', {
    size: 10.5,
    fill: colors.teal
  })

  // ----- Tool / app handler panel -------------------------------------
  body += rect(120, 410, 320, 68, {
    radius: 9,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += text(142, 438, 'Tool / App handler', { size: 12.5, fill: colors.ink })
  body += text(142, 460, 'apiClient.get / post / …', {
    size: 12,
    fill: colors.accentSoft
  })

  const rendered = svg(width, height, 'PER-REQUEST CLIENT LIFECYCLE', body, {
    alt: altText
  })
  return { svg: rendered, alt: altText }
}

export const lifecycle = buildLifecycleFigure()
export default lifecycle
