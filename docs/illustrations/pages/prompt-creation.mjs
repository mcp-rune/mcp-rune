// pages/prompt-creation.mjs
//
// Authoring source for the prompt-creation guide's illustration.
// Ported from the pilot's prompt-creation.html.

import { colors, text, rect, line, arrowRight, svg } from '../illus.mjs'

// Build the strategy-escalation diagram: three side-by-side strategy
// columns (Stateless / Hybrid / Stateful) with arrows between them,
// highlighting newly-added ops at each escalation.
function buildStratFigure() {
  const width = 892
  const height = 432

  const altText =
    'Three escalating prompt strategies. Stateless (<10 fields) offers ' +
    'getDocumentation and validates at submit only — simple forms. ' +
    'Hybrid (10–20 fields) adds validateFields and generateSummary, ' +
    'validating the full form once before submit — medium forms. ' +
    'Stateful (20+ fields) further adds validateSection and getProgress, ' +
    'validating per section and tracking progress — complex forms.'

  // Column positions and width.
  const columnXs = [28, 320, 612]
  const columnWidth = 252

  // Stroke '#3a3450' for the stateful column has no token; keep literal.
  const cols = [
    {
      name: 'STATELESS',
      badge: '< 10 fields',
      foot: 'Simple forms',
      ops: [['getDocumentation', 0]],
      val: ['Validate at', 'submit only']
    },
    {
      name: 'HYBRID',
      badge: '10 – 20 fields',
      foot: 'Medium forms',
      ops: [
        ['getDocumentation', 0],
        ['validateFields', 1],
        ['generateSummary', 1]
      ],
      val: ['Validate full', 'form once before submit']
    },
    {
      name: 'STATEFUL',
      badge: '20+ fields',
      foot: 'Complex forms',
      ops: [
        ['getDocumentation', 0],
        ['validateFields', 0],
        ['generateSummary', 0],
        ['validateSection', 1],
        ['getProgress', 1]
      ],
      val: ['Validate per', 'section + track progress']
    }
  ]

  let body = ''

  // ----- Three strategy columns -------------------------------------
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i]
    const x = columnXs[i]
    const colHeight = 340
    // Card body + accent stroke (Stateful gets a hinted purple stroke).
    body += rect(x, 52, columnWidth, colHeight, {
      radius: 11,
      fill: colors.panel,
      stroke: i === 2 ? '#3a3450' : colors.panelStroke
    })
    // Header band — rounded top then a 12-px filler to square the bottom.
    body += rect(x, 52, columnWidth, 40, {
      radius: 11,
      fill: colors.panelHead
    })
    body += rect(x, 80, columnWidth, 12, { fill: colors.panelHead })
    // Strategy name in the header.
    body += text(x + columnWidth / 2, 77, col.name, {
      size: 13,
      fill: i === 0 ? colors.inkSoft : i === 1 ? colors.accentSoft : colors.teal,
      anchor: 'middle',
      letterSpacing: '0.1em'
    })
    // Field-count badge pill below the header.
    body += rect(x + 16, 104, columnWidth - 32, 26, {
      radius: 7,
      fill: colors.frame,
      stroke: colors.lineSoft
    })
    body += text(x + columnWidth / 2, 121, col.badge, {
      size: 11.5,
      fill: colors.ink,
      anchor: 'middle'
    })
    // OPS section header.
    body += text(x + 20, 156, 'OPS', {
      size: 10,
      letterSpacing: '0.12em',
      fill: colors.inkDim
    })
    // List of ops; newly-introduced ops get a tinted accent background.
    let opY = 178
    for (const [op, isNew] of col.ops) {
      if (isNew) {
        body += rect(x + 16, opY - 14, columnWidth - 32, 22, {
          radius: 6,
          fill: colors.accent,
          fillOpacity: 0.12,
          stroke: colors.accent,
          strokeOpacity: 0.32
        })
      }
      body +=
        `<circle cx="${x + 26}" cy="${opY - 3}" r="2.5" ` +
        `fill="${isNew ? colors.accent : colors.inkDim}"></circle>`
      body += text(x + 36, opY, op, {
        size: 11.5,
        fill: isNew ? colors.accentSoft : colors.inkSoft
      })
      opY += 26
    }
    // Validation note divider + two-line description near the bottom.
    body += line(x + 16, 332, x + columnWidth - 16, 332, {
      stroke: colors.line,
      dash: '2 4'
    })
    body += text(x + 20, 352, col.val[0], {
      size: 11,
      fill: colors.inkMuted
    })
    body += text(x + 20, 370, col.val[1], {
      size: 11,
      fill: colors.inkMuted
    })
    // Footer caption beneath the card.
    body += text(x + columnWidth / 2, 410, col.foot, {
      size: 11,
      fill: colors.inkDim,
      anchor: 'middle'
    })
    // Escalation arrow to the next column.
    if (i < 2) {
      body += arrowRight(columnXs[i] + columnWidth + 6, 200, columnXs[i + 1] - 6, {
        color: colors.accent
      })
    }
  }

  const rendered = svg(width, height, 'PROMPT STRATEGIES · ESCALATION', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const strat = buildStratFigure()
export default strat
