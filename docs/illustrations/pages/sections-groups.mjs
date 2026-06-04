// pages/sections-groups.mjs
//
// Authoring source for the sections-groups guide's illustration.
// Ported from the pilot's sections-groups.html. Two columns map
// user-facing sections on the left to validation field groups on
// the right; the timing section fans out to two groups.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the sections → field groups mapping diagram. Three sections
// stack on the left, three groups on the right, with arrows showing
// the one-to-one (basics, classification) and one-to-many (timing)
// relationships.
function buildMapFigure() {
  const width = 840
  const height = 468

  const altText =
    'Sections map to field groups: the basics section maps to the basics ' +
    'group, classification to classification, and the timing section ' +
    'fans out to two groups, timing-when (occurred_at) and ' +
    'timing-duration (duration_min).'

  let body = ''

  // ----- Column headers -----------------------------------------------
  body += text(50, 52, 'SECTIONS', {
    size: 11,
    letterSpacing: '0.1em',
    fill: colors.accentSoft
  })
  body += text(150, 52, 'user-facing flow', { size: 10.5, fill: colors.inkDim })
  body += text(540, 52, 'FIELD GROUPS', {
    size: 11,
    letterSpacing: '0.1em',
    fill: colors.teal
  })
  body += text(672, 52, 'validation', { size: 10.5, fill: colors.inkDim })

  // Section card: title + key/value rows, with an accent bar on the left.
  function sectionCard(x, y, w, h, title, lines, accentColor) {
    let out = rect(x, y, w, h, {
      radius: 9,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    out += rect(x, y, 3, h, { radius: 1.5, fill: accentColor })
    out += text(x + 18, y + 24, title, { size: 12.5, fill: colors.ink })
    let lineY = y + 44
    for (const row of lines) {
      out += text(x + 18, lineY, row[0], {
        size: 11,
        fill: row[1] || colors.inkMuted
      })
      lineY += 18
    }
    return out
  }

  // Group card: same shape but with a fixed teal accent and band fill.
  function groupCard(x, y, w, h, title, lines) {
    let out = rect(x, y, w, h, {
      radius: 9,
      fill: colors.band,
      stroke: colors.panelStroke
    })
    out += rect(x, y, 3, h, { radius: 1.5, fill: colors.teal })
    out += text(x + 18, y + 24, title, { size: 12.5, fill: colors.teal })
    let lineY = y + 44
    for (const row of lines) {
      out += text(x + 18, lineY, row[0], {
        size: 11,
        fill: row[1] || colors.inkMuted
      })
      lineY += 18
    }
    return out
  }

  // Straight section → group arrow with an optional centred label.
  function mapArrow(y, label) {
    body += line(360, y, 448, y, {
      stroke: colors.lineMid,
      strokeWidth: 1.4
    })
    body += `<path d="M448 ${y - 4.5} l9 4.5 -9 4.5 z" fill="${colors.accent}"></path>`
    if (label) {
      body += text(404, y - 8, label, {
        size: 9.5,
        fill: colors.inkDim,
        anchor: 'middle'
      })
    }
  }

  // ----- basics: one-to-one mapping -----------------------------------
  body += sectionCard(
    40,
    72,
    300,
    88,
    'basics',
    [['title : "Basics"'], ['required: true']],
    colors.accentSoft
  )
  body += groupCard(480, 72, 300, 88, 'basics', [
    ["fields: ['title', 'desc']", colors.inkSoft],
    ['required: true']
  ])
  mapArrow(116, 'groups: basics')

  // ----- classification: one-to-one mapping ---------------------------
  body += sectionCard(
    40,
    176,
    300,
    88,
    'classification',
    [['title : "Classify"'], ['required: true']],
    colors.accentSoft
  )
  body += groupCard(480, 176, 300, 88, 'classification', [
    ["fields: ['theme_id',", colors.inkSoft],
    ["         'category_id']", colors.inkSoft]
  ])
  mapArrow(220, 'groups: classification')

  // ----- timing: one-to-two fork --------------------------------------
  body += sectionCard(
    40,
    288,
    300,
    88,
    'timing',
    [['title : "Timing"'], ['required: false']],
    colors.amber
  )
  body += groupCard(480, 288, 300, 70, 'timing-when', [["fields: ['occurred_at']", colors.inkSoft]])
  body += groupCard(480, 372, 300, 70, 'timing-duration', [
    ["fields: ['duration_min']", colors.inkSoft]
  ])

  // Fork: stem from the section, vertical splitter, two arrow heads.
  body += line(360, 332, 404, 332, { stroke: colors.lineMid, strokeWidth: 1.4 })
  body += line(404, 332, 404, 407, { stroke: colors.lineMid, strokeWidth: 1.4 })
  body += line(404, 323, 448, 323, { stroke: colors.lineMid, strokeWidth: 1.4 })
  body += `<path d="M448 318.5 l9 4.5 -9 4.5 z" fill="${colors.accent}"></path>`
  body += line(404, 407, 448, 407, { stroke: colors.lineMid, strokeWidth: 1.4 })
  body += `<path d="M448 402.5 l9 4.5 -9 4.5 z" fill="${colors.accent}"></path>`
  body += text(404, 360, 'groups: 2', {
    size: 9.5,
    fill: colors.inkDim,
    anchor: 'middle'
  })

  const rendered = svg(width, height, 'SECTIONS → FIELD GROUPS', body, {
    alt: altText
  })
  return { svg: rendered, alt: altText }
}

export const map = buildMapFigure()
export default map
