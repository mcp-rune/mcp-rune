// pages/quickstart.mjs
//
// Authoring source for the quickstart guide's illustration.
// Ported from the pilot's quickstart.html. Each named export is one
// figure; the build script writes one .svg per export into ../svgs/.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the "what you write → what the framework derives" diagram.
// Two side-by-side panels with a labelled arrow between them.
function buildFanDiagram() {
  // Overall canvas. Wide enough for two 300-px panels with a centred
  // arrow row between them, plus a caption row at the top.
  const width = 820
  const height = 316

  // The screen-reader description. Kept in a named variable so the
  // exported figure can surface it alongside the svg.
  const altText =
    'A class Book extending BaseModel with an attributes block ' +
    '(title, author, status, rating) fans out via derivation into ' +
    '8 polymorphic tools (list_models, find_records, ' +
    'create/update/delete_model, search_records, get_filters_guide, ' +
    'bulk_action_models), prompt and form validation, 7 schema-driven ' +
    'apps, and auto-generated docs.'

  // We accumulate the SVG body as a single string.
  let body = ''

  // ----- Left panel: "What you write" --------------------------------
  // Small caps caption above the panel.
  body += text(60, 44, 'WHAT YOU WRITE', {
    size: 10.5,
    letterSpacing: '0.1em',
    fill: colors.accentSoft
  })

  // The panel itself, with a thin accent bar on its left edge.
  body += rect(40, 58, 300, 236, {
    radius: 11,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += rect(40, 58, 3, 236, { radius: 1.5, fill: colors.accent })

  // Class declaration lines.
  body += text(64, 90, 'class Book', { size: 13, fill: colors.ink })
  body += text(64, 110, '  extends BaseModel', {
    size: 11.5,
    fill: colors.accentSoft
  })

  // Dotted divider under the class header.
  body += line(64, 128, 316, 128, { stroke: colors.line, dash: '2 4' })

  // The attributes block. The four attribute names are laid out on
  // evenly-spaced rows; rendering each by hand keeps the layout obvious.
  body += text(64, 152, 'attributes = {', {
    size: 11.5,
    fill: colors.inkMuted
  })
  const attributeRows = ['title,', 'author,', 'status,', 'rating']
  for (let i = 0; i < attributeRows.length; i += 1) {
    body += text(80, 174 + i * 20, attributeRows[i], {
      size: 11.5,
      fill: colors.inkSoft
    })
  }
  body += text(64, 254, '}', { size: 11.5, fill: colors.inkMuted })
  body += text(64, 282, 'the source of truth', {
    size: 10.5,
    fill: colors.inkDim
  })

  // ----- Arrow + "derivation" pill -----------------------------------
  // The arrow runs left-to-right between the two panels. Drawn as a
  // line + an inline tip path so the tip glyph matches the pilot
  // exactly (the generic arrowRight helper uses a slightly different
  // tip shape).
  body += line(348, 176, 452, 176, {
    stroke: colors.lineMid,
    strokeWidth: 1.6
  })
  body += `<path d="M452 170 l11 6 -11 6 z" fill="${colors.accent}"></path>`
  // The pill sits above the arrow body with the "derivation" label.
  body += rect(360, 154, 80, 20, {
    radius: 10,
    fill: colors.frame,
    stroke: colors.lineSoft
  })
  body += text(400, 168, 'derivation', {
    size: 10,
    fill: colors.accentSoft,
    anchor: 'middle'
  })

  // ----- Right panel: "What the framework derives" -------------------
  // Teal caption — the right side is the framework's contribution.
  body += text(484, 44, 'WHAT THE FRAMEWORK DERIVES', {
    size: 10.5,
    letterSpacing: '0.1em',
    fill: colors.teal
  })

  // Right panel uses the dimmer band fill to distinguish from the
  // source-of-truth panel on the left.
  body += rect(472, 58, 308, 236, {
    radius: 11,
    fill: colors.band,
    stroke: colors.panelStroke
  })
  body += rect(472, 58, 3, 236, { radius: 1.5, fill: colors.teal })

  // Heading + the four tool-group rows.
  body += text(496, 88, '8 polymorphic tools', {
    size: 12.5,
    fill: colors.ink
  })
  const toolRows = [
    'list_models · find_records',
    'create_ / update_ / delete_model',
    'search_records · get_filters_guide',
    'bulk_action_models'
  ]
  for (let i = 0; i < toolRows.length; i += 1) {
    body += text(508, 110 + i * 19, toolRows[i], {
      size: 11,
      fill: colors.teal
    })
  }

  // Dotted divider, then the three secondary derivations.
  body += line(496, 196, 764, 196, { stroke: colors.line, dash: '2 4' })
  body += text(496, 220, 'Prompt + form validation', {
    size: 12,
    fill: colors.inkSoft
  })
  body += text(496, 244, '7 schema-driven apps', {
    size: 12,
    fill: colors.inkSoft
  })
  body += text(496, 268, 'Auto-generated docs', {
    size: 12,
    fill: colors.inkSoft
  })

  // Wrap everything in the framed <svg> root. svg() adds the caption,
  // the viewBox, and the aria-label.
  const rendered = svg(width, height, 'QUICKSTART · ONE DECLARATION, ONE FAN-OUT', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

// Each export = one figure. The build script writes svgs/quickstart--fan.svg.
export const fan = buildFanDiagram()

// Single-figure pages also export a default so the short marker
// `<!-- illustration: quickstart -->` (no `#fig`) resolves to the
// same svg as `<!-- illustration: quickstart#fan -->`.
export default fan
