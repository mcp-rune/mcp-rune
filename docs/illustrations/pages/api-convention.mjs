// pages/api-convention.mjs
//
// Authoring source for the api-convention guide's illustration.
// Ported from the pilot's api-convention.html. One figure: an
// internal record forking into HAL and JSON:API wire shapes.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the "wire shapes" diagram.
// A centred record panel forks two ways into HAL and JSON:API panels.
function buildConvFigure() {
  // Overall canvas — matches the pilot exactly so the layout coordinates
  // below stay in lock-step with the original.
  const width = 860
  const height = 492

  const altText =
    'An internal Book record with a belongsTo author and hasMany tags ' +
    'serializes two ways: HAL emits author_link plus author_id and ' +
    'tag_ids; JSON:API nests data with type, attributes and ' +
    'relationships objects.'

  let body = ''

  // ----- code() helper -----------------------------------------------
  // A boxed code panel with a coloured header strip and a dot+label
  // identifying the shape (record, HAL, JSON:API). Each row may be a
  // bare string (default ink colour) or a [text, fill] tuple.
  function codePanel(x, y, w, h, label, labelColor, rows) {
    let q = rect(x, y, w, h, {
      radius: 10,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    // Header band (a tall pill faked with two stacked rects so the
    // bottom corners stay square against the body).
    q += rect(x, y, w, 28, { radius: 10, fill: colors.panelHead })
    q += rect(x, y + 18, w, 10, { fill: colors.panelHead })
    // Dot + label inside the header band.
    q += `<circle cx="${x + 16}" cy="${y + 14}" r="3.5" fill="${labelColor}"></circle>`
    q += text(x + 28, y + 18, label, { size: 11, fill: labelColor })
    // Body rows, evenly spaced.
    let rowY = y + 50
    for (const row of rows) {
      if (row) {
        const [content, fill] = Array.isArray(row) ? row : [row, colors.inkSoft]
        q += text(x + 18, rowY, content, { size: 11, fill })
      }
      rowY += 18
    }
    return q
  }

  // ----- Internal record (centred top) -------------------------------
  const recordX = 300
  const recordW = 260
  body += text(recordX + recordW / 2, 46, 'Internal record', {
    size: 11,
    fill: colors.inkDim,
    anchor: 'middle',
    letterSpacing: '0.08em'
  })
  body += codePanel(recordX, 56, recordW, 128, 'record', colors.accentSoft, [
    ['Book {', colors.inkSoft],
    ['  title: "Clean Code",', colors.inkSoft],
    [' author: <Author#7>,', colors.accentSoft],
    [' tags: [<Tag#1>, <Tag#3>]', colors.accentSoft],
    ['}', colors.inkSoft]
  ])
  // Inline annotations on the relationship rows.
  body += text(recordX + recordW - 86, 118, '← belongsTo', {
    size: 9.5,
    fill: colors.inkDim
  })
  body += text(recordX + recordW - 86, 136, '← hasMany', {
    size: 9.5,
    fill: colors.inkDim
  })

  // ----- Fork tree from the record down to two output panels ---------
  // Trunk drops from the record, then a horizontal bar spans across to
  // the two target columns, then short drops with arrowhead tips land
  // on the HAL (left) and JSON:API (right) panel headers.
  body += line(recordX + recordW / 2, 184, recordX + recordW / 2, 206, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  body += line(220, 206, 610, 206, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  // Left drop + amber tip onto HAL.
  body += line(220, 206, 220, 228, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  body += `<path d="M216 224 L220 232 L224 224 Z" fill="${colors.amber}"></path>`
  // Right drop + blue tip onto JSON:API.
  body += line(610, 206, 610, 228, {
    stroke: colors.lineMid,
    strokeWidth: 1.4
  })
  body += `<path d="M606 224 L610 232 L614 224 Z" fill="${colors.blue}"></path>`

  // ----- HAL panel (left) -------------------------------------------
  body += codePanel(40, 236, 380, 232, 'HAL', colors.amber, [
    ['{', colors.inkMuted],
    ['  title: "...",', colors.inkSoft],
    ['  author_link: "/authors/7",', colors.teal],
    ['  author_id: 7,', colors.inkSoft],
    ['  tag_ids: [1, 3]', colors.inkSoft],
    ['}', colors.inkMuted],
    null,
    ['belongsTo: {rel}_link + {rel}_id', colors.amber],
    ['hasMany:   {singular}_ids[]', colors.amber]
  ])

  // ----- JSON:API panel (right) -------------------------------------
  body += codePanel(440, 236, 380, 232, 'JSON:API', colors.blue, [
    ['{', colors.inkMuted],
    ['  data: {', colors.inkSoft],
    ['    type: "books",', colors.teal],
    ['    attributes: { title: "..." },', colors.inkSoft],
    ['    relationships: {', colors.accentSoft],
    ['      author: { data: { id: "7" } },', colors.inkSoft],
    ['      tags:   { data: [...] }', colors.inkSoft],
    ['    }', colors.accentSoft],
    ['  }', colors.inkSoft],
    ['}', colors.inkMuted]
  ])

  const rendered = svg(width, height, 'CONVENTION · WIRE SHAPES', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const conv = buildConvFigure()
export default conv
