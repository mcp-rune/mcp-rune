// pages/api-config.mjs
//
// Authoring source for the api-config guide's illustration.
// Ported from the pilot's api-config.html. The figure is a five-step
// decision chain: EndpointResolver tries each rung in order and the
// first match yields the URL; falling through everything lands on
// the pluralized default.

import { colors, text, rect, arrowDown, arrowRight, svg } from '../illus.mjs'

// Build the endpoint-resolution chain. Each rung shows the question
// and the config key consulted; a "yes" branch on the right shows the
// URL that would result, and the "no" branch drops down to the next
// rung. The terminal box at the bottom is the pluralize-default.
function buildChainFigure() {
  const width = 720
  const rungX = 60
  const rungWidth = 300
  let body = ''

  const altText =
    'EndpointResolver tests, in order: a per-action override ' +
    '(api.endpoints[action]), a collection override (api.endpoint), ' +
    'a parent path (api.parent), a namespace (api.namespace); the first ' +
    'yes yields that URL, otherwise it falls through to the default ' +
    'which pluralizes the model name, e.g. book becomes /books.'

  // ----- Start label + drop arrow -------------------------------------
  body += text(rungX + rungWidth / 2, 46, 'Resolve endpoint for (model, action)', {
    size: 12,
    fill: colors.inkSoft,
    anchor: 'middle'
  })
  body += arrowDown(rungX + rungWidth / 2, 54, 80)

  // The four chain rungs — each is [question, configKey, resultLabel].
  const rungs = [
    ['Per-action override?', 'api.endpoints[<action>]', 'endpoints[<action>]'],
    ['Collection override?', 'api.endpoint', 'api.endpoint'],
    ['Parent path?', 'api.parent', 'parent.endpoint + own'],
    ['Namespace?', 'api.namespace', 'namespace + default']
  ]

  // ----- Render each rung in sequence ---------------------------------
  let y = 86
  for (const [question, configKey, resultLabel] of rungs) {
    // The rung box with the question and the config key it consults.
    body += rect(rungX, y, rungWidth, 56, {
      radius: 9,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    body += text(rungX + 18, y + 24, question, {
      size: 12.5,
      fill: colors.ink
    })
    body += text(rungX + 18, y + 42, configKey, {
      size: 11,
      fill: colors.accentSoft
    })

    // The "yes" branch on the right: a teal-tinted result pill with
    // a small "yes" label above the arrow.
    body += text(rungX + rungWidth + 34, y + 18, 'yes', {
      size: 10.5,
      fill: colors.teal
    })
    body += arrowRight(rungX + rungWidth, y + 28, rungX + rungWidth + 60, {
      color: colors.teal
    })
    body += rect(rungX + rungWidth + 66, y + 14, 260, 28, {
      radius: 7,
      fill: colors.teal,
      fillOpacity: 0.06,
      stroke: colors.tealDeep
    })
    body += text(rungX + rungWidth + 80, y + 32, resultLabel, {
      size: 11.5,
      fill: colors.teal
    })

    // The "no" branch drops down to the next rung.
    body += text(rungX + rungWidth / 2 + 8, y + 74, 'no', {
      size: 10,
      fill: colors.inkDim
    })
    body += arrowDown(rungX + rungWidth / 2, y + 56, y + 86)
    y += 86
  }

  // ----- Default terminal: pluralize(model name) ----------------------
  body += rect(rungX, y, rungWidth, 74, {
    radius: 9,
    fill: colors.panelHead,
    stroke: colors.lineMid
  })
  body += rect(rungX, y, 3, 74, { radius: 1.5, fill: colors.amber })
  body += text(rungX + 18, y + 24, 'Default', { size: 12.5, fill: colors.amber })
  body += text(rungX + 18, y + 44, 'pluralize(model name)', {
    size: 11.5,
    fill: colors.inkSoft
  })
  body += text(rungX + 18, y + 62, '"book" → /books', {
    size: 11.5,
    fill: colors.inkMuted
  })

  const height = y + 96
  const rendered = svg(width, height, 'ENDPOINTRESOLVER · FIVE-STEP CHAIN', body, {
    alt: altText
  })
  return { svg: rendered, alt: altText }
}

export const chain = buildChainFigure()
export default chain
