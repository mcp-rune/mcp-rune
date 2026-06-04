// pages/search-filter-integration.mjs
//
// Authoring source for the search-filter-integration guide's
// illustration. Ported from the pilot's search-filter-integration.html.
// Three-column wire mapping: each row shows a model declaration, the
// MCP wire shape it produces, and what Rails receives via params.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the filter-types wire-mapping diagram. Five rows (text, enum,
// relation, date_range, integer_range) each render as three side-by-side
// cells with arrows between them.
function buildFiltersFigure() {
  const width = 880

  // Three columns: model declaration / MCP wire shape / Rails receives.
  const col1 = { x: 40, w: 230 }
  const col2 = { x: 316, w: 286 }
  const col3 = { x: 648, w: 200 }

  const altText =
    'Five filter types map model declaration to MCP wire shape to Rails ' +
    'params. text → "title" → params[:filters][:title]; enum → "status" ' +
    '→ [:status]; relation → "author_id" → [:author_id]; date_range and ' +
    'integer_range carry a {from,to} object read via params.dig(:filters, ' +
    'key, :from/:to).'

  let body = ''

  // ----- Column headers -----------------------------------------------
  body += text(col1.x + 6, 52, 'MODEL DECLARATION', {
    size: 10.5,
    letterSpacing: '0.08em',
    fill: colors.accentSoft
  })
  body += text(col2.x + 6, 52, 'MCP WIRE SHAPE', {
    size: 10.5,
    letterSpacing: '0.08em',
    fill: colors.teal
  })
  body += text(col3.x + 6, 52, 'RAILS RECEIVES', {
    size: 10.5,
    letterSpacing: '0.08em',
    fill: colors.amber
  })

  // A single cell — accent bar on the left, one text row per line.
  function cell(col, y, h, lines, accentColor) {
    let out = rect(col.x, y, col.w, h, {
      radius: 9,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    out += rect(col.x, y, 3, h, { radius: 1.5, fill: accentColor })
    let lineY = y + 24
    for (const row of lines) {
      if (row) {
        out += text(col.x + 18, lineY, row[0], {
          size: row[2] || 11,
          fill: row[1] || colors.inkSoft
        })
      }
      lineY += 17
    }
    return out
  }

  // Horizontal arrow between two adjacent cells.
  function rowArrow(x1, x2, y) {
    body += line(x1, y, x2 - 8, y, {
      stroke: colors.lineMid,
      strokeWidth: 1.4
    })
    body += `<path d="M${x2 - 8} ${y - 4.5} l9 4.5 -9 4.5 z" fill="${colors.accent}"></path>`
  }

  // The five rows. Each row has a height, accent for the model-decl
  // cell, and three line groups for the three cells.
  const rows = [
    {
      h: 54,
      accent: colors.accentSoft,
      a: [['text', colors.ink, 12.5]],
      b: [
        ['"title":', colors.teal],
        ['"clean architect"', colors.inkSoft]
      ],
      c: [
        ['params[:filters]', colors.inkMuted],
        ['[:title]', colors.amber]
      ]
    },
    {
      h: 72,
      accent: colors.accentSoft,
      a: [
        ['enum', colors.ink, 12.5],
        ["{ enum: ['draft',", colors.inkMuted],
        ["         'pub'] }", colors.inkMuted]
      ],
      b: [
        ['"status":', colors.teal],
        ['"published"', colors.inkSoft]
      ],
      c: [
        ['params[:filters]', colors.inkMuted],
        ['[:status]', colors.amber]
      ]
    },
    {
      h: 72,
      accent: colors.accentSoft,
      a: [
        ['relation', colors.ink, 12.5],
        ['{ relatedModel:', colors.inkMuted],
        ["  'author' }", colors.inkMuted]
      ],
      b: [
        ['"author_id":', colors.teal],
        ['"7"', colors.inkSoft]
      ],
      c: [
        ['params[:filters]', colors.inkMuted],
        ['[:author_id]', colors.amber]
      ]
    },
    {
      h: 90,
      accent: colors.blue,
      a: [['date_range', colors.ink, 12.5]],
      b: [
        ['"started_at": {', colors.teal],
        ['  "from": "2025-01-01",', colors.inkSoft],
        ['  "to":   "2025-12-31"', colors.inkSoft],
        ['}', colors.teal]
      ],
      c: [
        ['params.dig(', colors.inkMuted],
        ['  :filters,', colors.inkMuted],
        ['  :started_at,', colors.amber],
        ['  :from / :to )', colors.amber]
      ]
    },
    {
      h: 90,
      accent: colors.blue,
      a: [['integer_range', colors.ink, 12.5]],
      b: [
        ['"duration_minutes": {', colors.teal],
        ['  "from": 30,', colors.inkSoft],
        ['  "to":   120', colors.inkSoft],
        ['}', colors.teal]
      ],
      c: [
        ['params.dig(', colors.inkMuted],
        ['  :filters,', colors.inkMuted],
        ['  :duration_minutes,', colors.amber],
        ['  :from / :to )', colors.amber]
      ]
    }
  ]

  // ----- Render each row across the three columns ---------------------
  let y = 70
  for (const row of rows) {
    body += cell(col1, y, row.h, row.a, row.accent)
    body += cell(col2, y, row.h, row.b, colors.tealDeep)
    body += cell(col3, y, row.h, row.c, colors.amber)
    const midY = y + row.h / 2
    rowArrow(col1.x + col1.w, col2.x, midY)
    rowArrow(col2.x + col2.w, col3.x, midY)
    y += row.h + 16
  }

  const height = y + 4
  const rendered = svg(width, height, 'FILTER TYPES · WIRE MAPPING', body, {
    alt: altText
  })
  return { svg: rendered, alt: altText }
}

export const filters = buildFiltersFigure()
export default filters
