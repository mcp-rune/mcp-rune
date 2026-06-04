// pages/prompt-derivation-framework.mjs
//
// Authoring source for the prompt-derivation-framework guide's illustration.
// Ported from the pilot's prompt-derivation-framework.html.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the five-layer derivation stack with a rotated bottom-up arrow
// on the left. Layers run top-down visually but the composition flows
// bottom-up: schema -> grouping -> section docs -> assembly -> behavioral.
function buildLayersFigure() {
  const width = 820
  const panelX = 84
  const panelWidth = width - 168
  const panelHeight = 68
  const gap = 10

  const altText =
    'Five derivation layers shown bottom-up: Layer 1 Schema ' +
    '(derivePromptSchema) produces field definitions from model config; ' +
    'Layer 2 Grouping arranges sections and fieldGroups; Layer 3 Section ' +
    'Docs builds per-section tables; Layer 4 Assembly composes via ' +
    'PromptContentGenerator.build(); Layer 5 Behavioral wraps it with ' +
    'stateful guidance instructions.'

  // [number, layer name, function ref, description, accent colour].
  // Layer 1 uses colors.rose (pilot used '#ff8a9b' literally).
  const layers = [
    [
      '5',
      'BEHAVIORAL',
      'generateStatefulGuidanceInstructions()',
      '(BasePrompt) Turn-taking, validation, mode selection',
      colors.accentSoft
    ],
    [
      '4',
      'ASSEMBLY',
      'PromptContentGenerator.build()',
      'Composes all layers into final promptContent',
      colors.blue
    ],
    [
      '3',
      'SECTION DOCS',
      'PromptContentGenerator + BasePrompt',
      'Per-section field tables, enum tables, content notes',
      colors.teal
    ],
    [
      '2',
      'GROUPING',
      'sections + fieldGroups',
      '(BasePrompt static config) Workflow structure, field org',
      colors.amber
    ],
    [
      '1',
      'SCHEMA',
      'derivePromptSchema()',
      '(schema-derivation.js) fieldDefinitions from model config',
      colors.rose
    ]
  ]

  let body = ''
  let y = 56

  // ----- Stacked layer panels ---------------------------------------
  for (const [num, name, fn, desc, color] of layers) {
    // Panel + left accent bar.
    body += rect(panelX, y, panelWidth, panelHeight, {
      radius: 9,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    body += rect(panelX, y, 3, panelHeight, { radius: 1.5, fill: color })
    // Numbered circle badge.
    body +=
      `<circle cx="${panelX + 26}" cy="${y + panelHeight / 2}" ` +
      `r="13" fill="${color}" fill-opacity="0.14" stroke="${color}" ` +
      `stroke-opacity="0.4"></circle>`
    body += text(panelX + 26, y + panelHeight / 2 + 4, num, {
      size: 13,
      fill: color,
      anchor: 'middle'
    })
    // Layer title + function reference.
    body += text(panelX + 52, y + 27, 'Layer ' + num + ': ' + name, {
      size: 12.5,
      fill: color,
      letterSpacing: '0.04em'
    })
    body += text(panelX + 52 + (9 + name.length) * 7.7 + 12, y + 27, '— ' + fn, {
      size: 11.5,
      fill: colors.ink
    })
    // Description row.
    body += text(panelX + 52, y + 48, desc, {
      size: 11,
      fill: colors.inkMuted
    })
    y += panelHeight + gap
  }

  // ----- Bottom-up data-flow arrow on the left ----------------------
  const arrowYBottom = y - gap - 12
  const arrowYTop = 68
  body += line(46, arrowYBottom, 46, arrowYTop, {
    stroke: colors.lineMid,
    strokeWidth: 1.5
  })
  body +=
    `<path d="M42 ${arrowYTop + 8} L46 ${arrowYTop} L50 ${arrowYTop + 8} Z" ` +
    `fill="${colors.teal}"></path>`
  // Vertical rotated label "data flows bottom-up ↑".
  const labelY = (arrowYBottom + arrowYTop) / 2
  body +=
    `<text x="30" y="${labelY}" font-size="10.5" ` +
    `fill="${colors.inkDim}" text-anchor="middle" ` +
    `transform="rotate(-90 30 ${labelY})">data flows bottom-up ↑</text>`

  const rendered = svg(width, y + 8, 'PROMPT DERIVATION · FIVE LAYERS', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const layers = buildLayersFigure()
export default layers
