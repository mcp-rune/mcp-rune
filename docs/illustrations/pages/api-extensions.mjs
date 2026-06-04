// pages/api-extensions.mjs
//
// Authoring source for the api-extensions guide's illustration.
// Ported from the pilot's api-extensions.html. The figure is a
// wiring graph of the six pieces of an API extension: author-facing
// pieces on the left, framework-facing pieces on the right, meeting
// at BaseModel.extensions and the ToolRegistry.

import { colors, text, rect, line, band, svg } from '../illus.mjs'

// Build the API-extensions wiring graph.
function buildWireFigure() {
  const width = 880
  const height = 576

  const altText =
    'Inside your extension, the author-facing xxxConfig helper declares ' +
    'config onto BaseModel.extensions; on the framework side ' +
    'getXxxConfig feeds capability getters, xxxExtension registers tools ' +
    'and a mixin via register(ctx), and createXxxService is an optional ' +
    'factory. The ToolRegistry reads BaseModel.extensions and registers ' +
    'the extension.'

  let body = ''

  // Small helper: a rounded box with optional accent bar, optional
  // subtitle, and configurable title color/size.
  function boxNode(x, y, w, h, title, sub, options = {}) {
    let out = rect(x, y, w, h, {
      radius: 9,
      fill: options.fill || colors.panel,
      stroke: options.stroke || colors.panelStroke
    })
    if (options.bar) {
      out += rect(x, y, 3, h, { radius: 1.5, fill: options.bar })
    }
    const titleX = x + (options.bar ? 20 : 16)
    const titleY = y + (sub ? h / 2 - 2 : h / 2 + 4)
    out += text(titleX, titleY, title, {
      size: options.titleSize || 12,
      fill: options.titleFill || colors.ink
    })
    if (sub) {
      out += text(titleX, y + h / 2 + 15, sub, {
        size: 10,
        fill: colors.inkDim
      })
    }
    return out
  }

  // Small helper: a straight line with a rotated triangular tip and
  // an optional label. Used for the labelled wires across the graph.
  function labelledArrow(x1, y1, x2, y2, arrowColor, label, labelX, labelY) {
    let out = line(x1, y1, x2, y2, {
      stroke: arrowColor || colors.lineMid,
      strokeWidth: 1.4
    })
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const tipSize = 6
    const ax1 = x2 - tipSize * Math.cos(angle - 0.4)
    const ay1 = y2 - tipSize * Math.sin(angle - 0.4)
    const ax2 = x2 - tipSize * Math.cos(angle + 0.4)
    const ay2 = y2 - tipSize * Math.sin(angle + 0.4)
    out += `<path d="M${ax1} ${ay1} L${x2} ${y2} L${ax2} ${ay2} Z" fill="${arrowColor || colors.accent}"></path>`
    if (label) {
      out += text(labelX, labelY, label, {
        size: 10,
        fill: colors.inkDim,
        anchor: 'middle'
      })
    }
    return out
  }

  // ----- Outer container: "YOUR EXTENSION" band -----------------------
  body += band(24, 56, 832, 348, 'YOUR EXTENSION', {
    dot: colors.accentSoft,
    labelFill: colors.accentSoft
  })

  // Vertical divider between author-facing and framework-facing columns.
  body += line(322, 92, 322, 392, {
    stroke: colors.lineSoft,
    dash: '3 5'
  })
  body += text(48, 104, 'AUTHOR-FACING', {
    size: 10,
    letterSpacing: '0.1em',
    fill: colors.inkDim
  })
  body += text(344, 104, 'FRAMEWORK-FACING', {
    size: 10,
    letterSpacing: '0.1em',
    fill: colors.inkDim
  })

  // ----- Left node: xxxConfig (author-facing) -------------------------
  body += boxNode(48, 120, 250, 56, 'xxxConfig({…})', 'typed helper', {
    bar: colors.accentSoft,
    titleFill: colors.accentSoft
  })

  // ----- Right chain: reader → capability getters → extension → factory
  body += boxNode(344, 118, 320, 48, 'getXxxConfig(model)', 'typed reader · structural', {
    titleFill: colors.ink
  })
  body += labelledArrow(420, 166, 420, 186, colors.lineMid)
  body += boxNode(370, 188, 260, 46, 'capability getters', 'filter consumers', {
    stroke: colors.lineMid
  })
  body += boxNode(344, 250, 320, 42, 'xxxExtension(): ApiExtension', null, {
    titleFill: colors.ink
  })
  body += labelledArrow(420, 292, 420, 306, colors.lineMid)
  body += boxNode(370, 308, 260, 38, 'register(ctx) → tools + mixin', null, {
    titleSize: 11.5,
    titleFill: colors.teal
  })
  body += boxNode(344, 356, 320, 42, 'createXxxService(apiClient, …)', 'optional factory', {
    titleFill: colors.inkMuted
  })

  // ----- Bottom boxes: BaseModel.extensions and ToolRegistry ----------
  body += boxNode(48, 452, 280, 80, 'BaseModel.extensions', "{ 'xxx': …config… }", {
    bar: colors.amber,
    titleFill: colors.amber,
    titleSize: 12.5
  })
  body += boxNode(560, 452, 296, 96, 'ToolRegistry({ … })', "apiExtensions: { 'xxx': xxxExt() }", {
    bar: colors.accent,
    titleFill: colors.accentSoft,
    titleSize: 12.5
  })

  // ----- Labelled wires between the pieces ----------------------------
  body += labelledArrow(173, 176, 173, 452, colors.accentSoft, 'declares', 210, 330)
  body += labelledArrow(560, 494, 332, 494, colors.amber, 'reads', 446, 484)
  body += labelledArrow(664, 452, 478, 294, colors.accent, 'registers', 648, 432)

  const rendered = svg(width, height, 'API EXTENSIONS · WIRING', body, {
    alt: altText
  })
  return { svg: rendered, alt: altText }
}

export const wire = buildWireFigure()
export default wire
