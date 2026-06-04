// pages/extension-recipes.mjs
//
// Authoring source for the extension-recipes guide's illustration.
// Ported from the pilot's extension-recipes.html. The figure is a
// routing index: a top "I want to…" node spines down into eight
// intents, each mapped to the extension point that handles it.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the "I want to… → extension point" routing index.
function buildRecipesFigure() {
  const width = 880
  const spineX = 56

  // The eight intent rows. Each row is:
  //   [intent, intentSubtitle, solution, tag, accentColor].
  // The 'composite' row uses a rose accent; the palette has a token.
  const rows = [
    [
      'Add a non-CRUD verb to a model',
      'publish, archive, status changes',
      'customActionsExtension',
      'ApiExtension',
      colors.accentSoft
    ],
    [
      'Add an MCP tool unrelated to a model',
      '',
      'ToolRegistry + BaseTool subclass',
      'tool',
      colors.blue
    ],
    [
      'Add an HTTP route',
      'webhook, health, custom OAuth',
      'HttpExtension',
      'transport',
      colors.blue
    ],
    [
      'Stage a write for human review',
      'collect → review → submit',
      'ToolFlowExtension',
      'centerOfControl',
      colors.amber
    ],
    ['Add a new summary lens', '', 'SummaryStrategy', 'ApiExtension', colors.teal],
    [
      'Swap payload / association shape',
      'for one model',
      'BaseConvention override',
      'convention',
      colors.accentSoft
    ],
    ['Stub the API for integration tests', '', 'DataLayer override', 'in-memory', colors.teal],
    [
      'Touch many surfaces at once',
      'Stripe-style integration',
      'Multi-surface recipe',
      'composite',
      colors.rose
    ]
  ]

  const altText =
    'Eight intents routed to extension points: add a non-CRUD verb to a ' +
    'model uses customActionsExtension (ApiExtension); add an unrelated ' +
    'MCP tool uses ToolRegistry plus a BaseTool subclass; add an HTTP ' +
    'route uses HttpExtension; stage a write for human review uses ' +
    'ToolFlowExtension; add a summary lens uses a SummaryStrategy via ' +
    'ApiExtension; swap payload or association shape uses a BaseConvention ' +
    'override; stub the API for tests uses a DataLayer override; touch ' +
    'many surfaces uses the multi-surface recipe.'

  let body = ''

  // ----- Header node: "I want to…" ------------------------------------
  body += rect(40, 48, 150, 30, {
    radius: 8,
    fill: colors.panelHead,
    stroke: colors.panelStroke
  })
  body += text(64, 68, 'I want to…', { size: 12.5, fill: colors.ink })

  // ----- Spine + each branch ------------------------------------------
  let y = 96
  const rowHeight = 58
  const lastY = 96 + (rows.length - 1) * rowHeight + 18

  // Vertical spine that all branch ticks attach to.
  body += line(spineX, 78, spineX, lastY, {
    stroke: colors.lineSoft,
    strokeWidth: 1.4
  })

  for (const row of rows) {
    const [intent, intentSubtitle, solution, tag, accentColor] = row
    const centerY = y + 18

    // Branch tick from the spine into the intent label.
    body += line(spineX, centerY, spineX + 22, centerY, {
      stroke: colors.lineSoft,
      strokeWidth: 1.4
    })
    body += text(spineX + 34, centerY - 2, intent, {
      size: 12.5,
      fill: colors.ink
    })
    if (intentSubtitle) {
      body += text(spineX + 34, centerY + 15, intentSubtitle, {
        size: 10.5,
        fill: colors.inkDim
      })
    }

    // Solution box on the right with an accent-bar marker and a tag pill.
    const boxX = 500
    const boxWidth = 336
    body += rect(boxX, y + 2, boxWidth, 34, {
      radius: 8,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    body += rect(boxX, y + 2, 3, 34, { radius: 1.5, fill: accentColor })
    body += text(boxX + 16, y + 23, '→ ' + solution, {
      size: 11.5,
      fill: accentColor
    })

    // Tag pill on the far-right of the solution box.
    const tagWidth = tag.length * 6.4 + 16
    body += rect(boxX + boxWidth - tagWidth - 10, y + 10, tagWidth, 18, {
      radius: 9,
      fill: colors.frame,
      stroke: colors.lineSoft
    })
    body += text(boxX + boxWidth - tagWidth / 2 - 10, y + 23, tag, {
      size: 9.5,
      fill: colors.inkDim,
      anchor: 'middle'
    })

    // Dashed connector from the intent text to the solution box.
    body += line(spineX + 34 + intent.length * 6.6 + 14, centerY - 2, boxX - 8, centerY - 2, {
      stroke: colors.line,
      dash: '2 4'
    })
    body += `<path d="M${boxX - 8} ${centerY - 6} l8 4 -8 4 z" fill="${accentColor}" fill-opacity="0.6"></path>`

    y += rowHeight
  }

  const height = y + 10
  const rendered = svg(width, height, 'EXTENSION RECIPES · ROUTING INDEX', body, {
    alt: altText
  })
  return { svg: rendered, alt: altText }
}

export const recipes = buildRecipesFigure()
export default recipes
