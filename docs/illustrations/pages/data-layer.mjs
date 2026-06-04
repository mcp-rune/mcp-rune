// pages/data-layer.mjs
//
// Authoring source for the data-layer guide's illustration.
// Ported from the pilot's data-layer.html.

import { colors, text, rect, band, verticalConnector, svg } from '../illus.mjs'

// Build the layered-seam diagram: projection layer above the seam,
// DataLayer interface in the middle, default adapter (ModelService)
// composed of ApiClient + Convention below.
function buildSeamFigure() {
  const width = 720
  const height = 500

  const altText =
    'The projection layer (tools, prompts, apps, workflows) reads and ' +
    'writes only through the DataLayer interface (create, find, list, ' +
    'update, delete and normalized variants plus dispatch/buildPayload ' +
    'escape hatches); the default adapter ModelService composes ApiClient ' +
    'and Convention beneath the seam.'

  let body = ''

  // ----- Band 1: Projection layer (top) ------------------------------
  body += band(60, 56, 600, 80, 'PROJECTION LAYER', {
    dot: colors.accentSoft,
    labelFill: colors.accentSoft
  })
  body += text(84, 112, 'tools · prompts · apps · workflows', {
    size: 12.5,
    fill: colors.inkSoft
  })

  // ----- Connector: "reads / writes through ONLY" --------------------
  body += verticalConnector(360, 136, 196, 'reads / writes through ONLY')

  // ----- Band 2: DataLayer interface --------------------------------
  // labelFill '#c9b8ff' has no token in colors; keep as literal.
  body += band(60, 196, 600, 116, 'DATALAYER', {
    dot: colors.accent,
    labelFill: '#c9b8ff',
    sub: 'interface',
    subOffsetX: 118
  })
  body += text(84, 250, 'create · find · list · update · delete', {
    size: 12.5,
    fill: colors.ink
  })
  body += text(84, 272, 'listNormalized · searchNormalized · …', {
    size: 12,
    fill: colors.inkMuted
  })
  body += text(84, 294, 'dispatch / buildPayload', {
    size: 12,
    fill: colors.amber
  })
  body += text(300, 294, 'escape hatches', {
    size: 11,
    fill: colors.inkDim
  })

  // ----- Connector: unlabeled drop to the adapter -------------------
  body += verticalConnector(360, 312, 372, '')

  // ----- Band 3: Default adapter (ModelService) ---------------------
  body += band(60, 372, 600, 100, 'DEFAULT ADAPTER · ModelService', {
    dot: colors.teal,
    labelFill: colors.teal
  })
  // Hairline divider under the band header row.
  body += rect(84, 418, 552, 1, { fill: colors.line, radius: 0 })
  body += text(84, 440, '├─ ApiClient', { size: 12.5, fill: colors.ink })
  body += text(210, 440, 'HTTP verbs against URLs', {
    size: 11,
    fill: colors.inkDim
  })
  body += text(84, 460, '└─ Convention', { size: 12.5, fill: colors.ink })
  body += text(210, 460, 'payload / association shape', {
    size: 11,
    fill: colors.inkDim
  })

  const rendered = svg(width, height, 'DATA LAYER · THE SEAM', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const seam = buildSeamFigure()
export default seam
