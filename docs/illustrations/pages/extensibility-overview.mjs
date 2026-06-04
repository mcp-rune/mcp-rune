// pages/extensibility-overview.mjs
//
// Authoring source for the extensibility-overview guide's illustration.
// Ported from the pilot's extensibility-overview.html.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the tier-stack diagram: three composable tiers stacked top to
// bottom, with a rotated bottom-up composition arrow on the left.
function buildTiersFigure() {
  const width = 760
  const panelX = 70
  const panelWidth = width - 140

  const altText =
    'Three composable tiers, bottom-up. Tier 1 Core Adapters (DataLayer, ' +
    'ApiClient, BaseConvention, SearchAdapter, Kinds) handles the data ' +
    'path. Tier 2 Tool & App Extensions (ApiExtension, ToolFlowExtension, ' +
    'AppDefinition, BasePrompt, custom BaseTool) extends the MCP surface. ' +
    'Tier 3 HTTP & Transport (HttpExtension, OAuthService) adds routes ' +
    'and discovery. Tier 1 powers Tier 2; Tier 2 powers Tier 3.'

  // Each tier: [number, name, body rows, footnote, accent colour].
  const tiers = [
    [
      '3',
      'HTTP & Transport',
      ['HttpExtension · OAuthService'],
      'express routes, middleware, RFC discovery',
      colors.blue
    ],
    [
      '2',
      'Tool & App Extensions',
      ['ApiExtension · ToolFlowExtension · AppDefinition', 'BasePrompt · custom BaseTool'],
      'extend the MCP surface itself: tools, apps, prompts',
      colors.accentSoft
    ],
    [
      '1',
      'Core Adapters',
      [
        'DataLayer · ApiClient · BaseConvention · SearchAdapter',
        'Kinds (KindDescriptor / FormatterDescriptor)'
      ],
      'data path: HTTP → normalize → CRUD → projection',
      colors.teal
    ]
  ]

  let body = ''
  let y = 58

  // ----- Stacked tier panels ----------------------------------------
  for (const [num, name, rows, note, color] of tiers) {
    const h = 58 + rows.length * 19
    // Panel + left accent bar.
    body += rect(panelX, y, panelWidth, h, {
      radius: 10,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    body += rect(panelX, y, 3, h, { radius: 1.5, fill: color })
    // Numbered circle badge on the left.
    body +=
      `<circle cx="${panelX + 26}" cy="${y + 27}" r="13" ` +
      `fill="${color}" fill-opacity="0.14" stroke="${color}" ` +
      `stroke-opacity="0.4"></circle>`
    body += text(panelX + 26, y + 31, num, {
      size: 13,
      fill: color,
      anchor: 'middle'
    })
    // Tier title.
    body += text(panelX + 52, y + 31, 'Tier ' + num + ' — ' + name, {
      size: 13,
      fill: color
    })
    // Body rows.
    let rowY = y + 52
    for (const row of rows) {
      body += text(panelX + 52, rowY, row, {
        size: 11.5,
        fill: colors.inkSoft
      })
      rowY += 19
    }
    // Footnote.
    body += text(panelX + 52, rowY + 2, note, {
      size: 10.5,
      fill: colors.inkDim
    })
    y += h + 12
  }

  // ----- Bottom-up composition arrow on the left --------------------
  const arrowYBottom = y - 24
  const arrowYTop = 70
  body += line(46, arrowYBottom, 46, arrowYTop, {
    stroke: colors.lineMid,
    strokeWidth: 1.5
  })
  body += `<path d="M42 78 L46 70 L50 78 Z" fill="${colors.teal}"></path>`
  // Vertical label, rotated -90 around its midpoint.
  const labelY = (arrowYBottom + arrowYTop) / 2
  body +=
    `<text x="30" y="${labelY}" font-size="10.5" ` +
    `fill="${colors.inkDim}" text-anchor="middle" ` +
    `transform="rotate(-90 30 ${labelY})">composition · bottom-up ↑</text>`

  // ----- Trailing summary line --------------------------------------
  body += text(width / 2, y + 6, 'Tier 1 powers Tier 2 · Tier 2 powers Tier 3', {
    size: 11,
    fill: colors.inkMuted,
    anchor: 'middle'
  })

  const rendered = svg(width, y + 22, 'EXTENSIBILITY · THREE TIERS', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const tiers = buildTiersFigure()
export default tiers
