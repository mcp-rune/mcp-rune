// pages/attribute-kinds.mjs
//
// Authoring source for the attribute-kinds guide's illustration.
// Ported from the pilot's attribute-kinds.html.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the conversion-hub diagram: API JSON and HTML form input both
// normalize into one internal value, which fans out via four hooks
// (serialize, describe, validate, format).
function buildHubFigure() {
  const width = 880
  const height = 372

  const altText =
    'API JSON parses (parse) and HTML form input feeds back (toInput) to ' +
    'one normalized Internal value. From the internal value, serialize ' +
    'emits API JSON, describe emits a humanized LLM-facing summary like ' +
    'ISBN-13: 978-0-13-235088-4, validate returns ok, null or an error, ' +
    'and format emits a DOM node for the browser.'

  let body = ''

  // Local helper: a multi-line centred node card with a coloured
  // stroke. Mirrors the pilot's `node()` closure.
  function nodeCard(x, y, w, h, lines, strokeColor, options = {}) {
    const fill = options.fill ?? colors.panel
    const strokeOpacity = options.strokeOpacity ?? 0.5
    let out = rect(x, y, w, h, {
      radius: 9,
      fill,
      stroke: strokeColor,
      strokeOpacity
    })
    let lineY = y + (lines.length > 1 ? 22 : h / 2 + 4)
    for (const [label, fillColor, size] of lines) {
      out += text(x + w / 2, lineY, label, {
        size: size ?? 11,
        fill: fillColor ?? colors.inkSoft,
        anchor: 'middle'
      })
      lineY += 16
    }
    return out
  }

  // ----- Sources: API JSON (left) and HTML form input (right) -------
  body += nodeCard(
    70,
    56,
    300,
    52,
    [
      ['API JSON', colors.ink, 12],
      ['{ isbn: "9780132350884" }', colors.inkMuted]
    ],
    colors.blue
  )
  body += nodeCard(
    510,
    56,
    300,
    52,
    [
      ['HTML form input', colors.ink, 12],
      ['<input value="978…">', colors.inkMuted]
    ],
    colors.amber
  )

  // ----- Central hub: the normalized Internal value -----------------
  // Translucent teal fill 'rgba(126,226,193,0.05)' has no token; literal.
  body += nodeCard(
    190,
    170,
    500,
    58,
    [
      ['Internal value', colors.ink, 13],
      ['"9780132350884"  ·  normalized, hyphens out', colors.teal]
    ],
    colors.teal,
    { fill: 'rgba(126,226,193,0.05)', strokeOpacity: 0.6 }
  )

  // ----- parse() arrow: from API JSON down into the hub -------------
  body += line(220, 108, 220, 170, {
    stroke: colors.lineMid,
    strokeWidth: 1.5
  })
  body += `<path d="M216 162 L220 172 L224 162 Z" fill="${colors.blue}"></path>`
  body += text(230, 142, 'parse(api)', { size: 10.5, fill: colors.inkDim })

  // ----- toInput() arrow: from hub up into HTML form input ----------
  body += line(660, 170, 660, 108, {
    stroke: colors.lineMid,
    strokeWidth: 1.5
  })
  body += `<path d="M656 116 L660 106 L664 116 Z" fill="${colors.amber}"></path>`
  body += text(548, 142, 'toInput(internal)', {
    size: 10.5,
    fill: colors.inkDim
  })

  // ----- Four output hooks, fanned out below the hub ----------------
  const outputs = [
    ['serialize', 'API JSON', '{ isbn: "…" }', colors.blue, 90, 180],
    [
      'describe',
      '"ISBN-13: 978-0-13-235088-4"',
      'LLM-facing · humanized',
      colors.accentSoft,
      290,
      230
    ],
    ['validate', '"ok" | null | error', '', colors.amber, 540, 170],
    ['format', '<code>9780132350884</code>', 'DOM node · browser only', colors.teal, 724, 170]
  ]

  for (const [hook, line1, line2, color, cx, boxWidth] of outputs) {
    // Hook arrow (hub -> output card).
    body += line(cx, 228, cx, 290, {
      stroke: colors.lineMid,
      strokeWidth: 1.4
    })
    body += `<path d="M${cx - 4} 282 L${cx} 292 L${cx + 4} 282 Z" ` + `fill="${color}"></path>`
    body += text(cx, 250, hook, {
      size: 10.5,
      fill: color,
      anchor: 'middle'
    })
    // Output card: panel + left accent bar.
    const cardHeight = line2 ? 52 : 38
    body += rect(cx - boxWidth / 2, 296, boxWidth, cardHeight, {
      radius: 9,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    body += rect(cx - boxWidth / 2, 296, 3, cardHeight, {
      radius: 1.5,
      fill: color
    })
    body += text(cx, line2 ? 316 : 320, line1, {
      size: 11,
      fill: colors.inkSoft,
      anchor: 'middle'
    })
    if (line2) {
      body += text(cx, 334, line2, {
        size: 9.5,
        fill: colors.inkDim,
        anchor: 'middle'
      })
    }
  }

  const rendered = svg(width, height, 'ATTRIBUTE KIND · CONVERSION HUB', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const hub = buildHubFigure()
export default hub
