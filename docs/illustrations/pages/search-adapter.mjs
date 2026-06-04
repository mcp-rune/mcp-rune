// pages/search-adapter.mjs
//
// Authoring source for the search-adapter guide's illustration.
// Ported from the pilot's search-adapter.html.

import { colors, text, rect, arrowDown, svg } from '../illus.mjs'

// Build the concentric-scopes diagram: SearchService.search() drops into
// buildRequest(), which contains the inner buildBody() (primary) and
// _buildQueryParams() (edge case) hooks.
function buildScopeFigure() {
  const width = 720
  const height = 440

  const altText =
    'SearchService.search() enters buildRequest() (rarely overridden), ' +
    'which contains buildBody() (overridden in 95% of cases, shaping the ' +
    'POST body or filter envelope) and _buildQueryParams() (edge cases, ' +
    'adding expansion hints and sparse fieldsets as URL params).'

  let body = ''

  // ----- Entry pill: SearchService.search() -------------------------
  body += rect(width / 2 - 130, 46, 260, 32, {
    radius: 8,
    fill: colors.panelHead,
    stroke: colors.panelStroke
  })
  body += text(width / 2, 67, 'SearchService.search()', {
    size: 12,
    fill: colors.accentSoft,
    anchor: 'middle'
  })
  body += arrowDown(width / 2, 78, 104)

  // ----- Outer panel: buildRequest() --------------------------------
  // The pilot used a translucent accent fill 'rgba(124,92,255,0.03)';
  // keep it as a literal (no token in colors).
  body += rect(60, 110, 600, 300, {
    radius: 12,
    fill: 'rgba(124,92,255,0.03)',
    stroke: colors.panelStroke
  })
  body += text(84, 140, 'buildRequest()', { size: 13, fill: colors.ink })
  // "rare" tag pill (right).
  body += rect(556, 124, 80, 22, {
    radius: 11,
    fill: colors.frame,
    stroke: colors.lineSoft
  })
  body += text(596, 139, 'rare', {
    size: 10.5,
    fill: colors.inkDim,
    anchor: 'middle'
  })

  // ----- Inner panel: buildBody() (primary, 95% of cases) -----------
  body += rect(88, 160, 544, 96, {
    radius: 10,
    fill: colors.panel,
    stroke: colors.accent,
    strokeOpacity: 0.4
  })
  body += rect(88, 160, 3, 96, { radius: 1.5, fill: colors.accent })
  body += text(110, 190, 'buildBody()', { size: 13, fill: colors.accentSoft })
  // "95% of cases" tag pill — translucent accent fill, kept as literal.
  body += rect(500, 174, 112, 22, {
    radius: 11,
    fill: colors.accent,
    fillOpacity: 0.12,
    stroke: colors.accent,
    strokeOpacity: 0.35
  })
  body += text(556, 189, '95% of cases', {
    size: 10.5,
    fill: colors.accentSoft,
    anchor: 'middle'
  })
  body += text(110, 222, 'shape the POST body / filter envelope', {
    size: 11.5,
    fill: colors.inkMuted
  })

  // ----- Inner panel: _buildQueryParams() (edge) --------------------
  body += rect(88, 276, 544, 112, {
    radius: 10,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += rect(88, 276, 3, 112, { radius: 1.5, fill: colors.amber })
  body += text(110, 306, '_buildQueryParams()', {
    size: 13,
    fill: colors.amber
  })
  // "edge" tag pill (right).
  body += rect(556, 290, 76, 22, {
    radius: 11,
    fill: colors.frame,
    stroke: colors.lineSoft
  })
  body += text(594, 305, 'edge', {
    size: 10.5,
    fill: colors.inkDim,
    anchor: 'middle'
  })
  body += text(110, 338, 'add expansion hints, sparse fieldsets,', {
    size: 11.5,
    fill: colors.inkMuted
  })
  body += text(110, 358, 'etc. as URL params', {
    size: 11.5,
    fill: colors.inkMuted
  })

  const rendered = svg(width, height, 'SEARCH ADAPTER · CONCENTRIC HOOKS', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const scope = buildScopeFigure()
export default scope
