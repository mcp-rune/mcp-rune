// pages/custom-app.mjs
//
// Authoring source for the custom-app guide's illustration.
// Ported from the pilot's custom-app.html. Two figures: the
// category decision tree, and the directory anatomy tree.

import { colors, text, rect, line, arrowDown, svg, colorizeTree } from '../illus.mjs'

// Build the "What does your app need?" decision-tree figure.
// A question pill fans out into three category columns, each with a
// rendered card showing the AppDefinition fields it populates.
function buildDecideFigure() {
  // Canvas: wide enough to space three 230-px cards across the width.
  const width = 860
  const height = 400

  const altText =
    'A decision tree from "What does your app need?". Static HTML only ' +
    'leads to Pure UI (getHtml, resourceUri). Server logic only leads to ' +
    'Tool-backed (toolName, toolInputSchema, handleToolCall). Server ' +
    'logic plus UI leads to Resource + tool — the most common — ' +
    'populating all of getHtml, resourceUri, toolName, toolInputSchema ' +
    'and handleToolCall.'

  // The three category columns. Each has a centre x, a two-line
  // condition label, a card name, the AppDefinition fields it sets,
  // an accent colour, and an optional "most common" star.
  const columns = [
    {
      centreX: 160,
      condition: ['Static HTML only', '(self-contained)'],
      name: 'Pure UI',
      props: ['getHtml', 'resourceUri'],
      accent: colors.inkMuted
    },
    {
      centreX: 430,
      condition: ['Server logic only', '(no iframe)'],
      name: 'Tool-backed',
      props: ['toolName', 'toolInputSchema', 'handleToolCall'],
      accent: colors.amber
    },
    {
      centreX: 700,
      condition: ['Server logic + UI', '(the standard widget)'],
      name: 'Resource + tool',
      props: ['getHtml', 'resourceUri', 'toolName', 'toolInputSchema', 'handleToolCall'],
      accent: colors.accent,
      star: true
    }
  ]

  let body = ''

  // ----- Top question pill -------------------------------------------
  body += rect(width / 2 - 150, 48, 300, 34, {
    radius: 9,
    fill: colors.panelHead,
    stroke: colors.panelStroke
  })
  body += text(width / 2, 70, 'What does your app need?', {
    size: 12.5,
    fill: colors.ink,
    anchor: 'middle'
  })

  // ----- Fan-out spine: short drop then a horizontal bar -------------
  // The bar runs across the three column centres.
  body += line(width / 2, 82, width / 2, 100, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  body += line(160, 100, 700, 100, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  // A short vertical drop and tip-triangle at each column.
  for (const column of columns) {
    body += line(column.centreX, 100, column.centreX, 120, {
      stroke: colors.lineMid,
      strokeWidth: 1.4
    })
    body +=
      `<path d="M${column.centreX - 4} 116 L${column.centreX} 124 ` +
      `L${column.centreX + 4} 116 Z" fill="${column.accent}"></path>`
  }

  // ----- Per-column condition labels, arrow, and card ----------------
  for (const column of columns) {
    // Two-line condition label, centred under the spine drop.
    body += text(column.centreX, 138, column.condition[0], {
      size: 12,
      fill: colors.inkSoft,
      anchor: 'middle'
    })
    body += text(column.centreX, 156, column.condition[1], {
      size: 10.5,
      fill: colors.inkDim,
      anchor: 'middle'
    })
    // Arrow pointing down into the card.
    body += arrowDown(column.centreX, 166, 190, { color: column.accent })

    // Card geometry. A "star" card is taller to make room for the
    // "most common" pill above the field list.
    const cardWidth = 230
    const cardX = column.centreX - cardWidth / 2
    const cardY = 196
    const baseHeight = column.star ? 80 : 58
    const cardHeight = baseHeight + column.props.length * 22

    // Card body + an accented border for the star (most-common) card.
    body += rect(cardX, cardY, cardWidth, cardHeight, {
      radius: 10,
      fill: colors.panel,
      stroke: column.star ? column.accent : colors.panelStroke,
      strokeOpacity: column.star ? 0.5 : 1
    })
    // Header bar (rounded top, square bottom is faked with a thin overlap).
    body += rect(cardX, cardY, cardWidth, 38, {
      radius: 10,
      fill: colors.panelHead
    })
    body += rect(cardX, cardY + 26, cardWidth, 12, { fill: colors.panelHead })
    // Card title in the accent colour.
    body += text(cardX + cardWidth / 2, cardY + 24, column.name, {
      size: 13,
      fill: column.accent,
      anchor: 'middle'
    })

    // Optional "most common" pill (only on the resource+tool card).
    let propY = cardY + 62
    if (column.star) {
      body += rect(cardX + cardWidth / 2 - 52, cardY + 48, 104, 20, {
        radius: 10,
        fill: colors.accent,
        fillOpacity: 0.14,
        stroke: colors.accent,
        strokeOpacity: 0.4
      })
      body += text(cardX + cardWidth / 2, cardY + 62, 'most common', {
        size: 9.5,
        fill: colors.accentSoft,
        anchor: 'middle'
      })
      propY = cardY + 84
    }

    // The AppDefinition fields — bullet dot + name per row.
    for (const prop of column.props) {
      body +=
        `<circle cx="${cardX + 22}" cy="${propY - 3}" r="2.5" ` +
        `fill="${column.accent}"></circle>`
      body += text(cardX + 34, propY, prop, {
        size: 11.5,
        fill: colors.inkSoft
      })
      propY += 22
    }
  }

  const rendered = svg(width, height, 'CUSTOM APP · CATEGORY DECISION', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

// Build the "Anatomy of a framework app" tree. Plain colorized ASCII.
function buildAnatomyFigure() {
  const ascii = `src/mcp/apps/
├── show-model-app/
│   ├── index.ts              ← server-side AppDefinition factory + handleToolCall
│   └── ui/                   ← iframe source (HTML + app.js + styles)
│       ├── app.js
│       ├── index.html
│       └── styles.css
└── dist/
    └── show-model-app.html   ← single-file iframe bundle (Vite output)`

  const altText =
    'Directory tree of show-model-app: a server-side index.ts (the ' +
    'AppDefinition factory and handleToolCall), a ui/ folder with the ' +
    'iframe source (app.js, index.html, styles.css), and a sibling dist/ ' +
    'with the bundled show-model-app.html iframe.'

  return { svg: colorizeTree(ascii), alt: altText }
}

export const decide = buildDecideFigure()
export const anatomy = buildAnatomyFigure()
