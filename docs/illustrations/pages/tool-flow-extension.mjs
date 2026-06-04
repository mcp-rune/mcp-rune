// pages/tool-flow-extension.mjs
//
// Authoring source for the tool-flow-extension guide's illustration.
// Ported from the pilot's tool-flow-extension.html. The figure shows
// the two phases of a tool-flow extension: how it wires itself at
// boot, and what happens on each tool call.

import { colors, text, rect, line, arrowDown, svg } from '../illus.mjs'

// Build the "boot vs. per-call" two-column diagram. Left column shows
// the boot-time registration sequence; right column shows the per-call
// interception flow that runs for every tool invocation.
function buildFlowFigure() {
  const width = 880
  const height = 410

  const altText =
    'Boot: createServer with toolFlowExtensions registers the extension, ' +
    'which in register(ctx) registers its tool, sets form submit mode to ' +
    'collect, and provides a context store, then the tool registry is ' +
    'sealed. Per tool call: the LLM invokes new_model_app, the form data ' +
    "is collected (because submitMode is collect), the extension's own " +
    'tool (e.g. review_approval) runs, its handler reads KEY from context ' +
    'and decides to submit or reject, then resumes the CRUD write via DataLayer.'

  let body = ''

  // Small helper: a column header — caps label with a dimmed underline.
  function columnHead(x, label, accentColor) {
    let out = text(x, 44, label, {
      size: 11,
      letterSpacing: '0.1em',
      fill: accentColor
    })
    out += line(x, 52, x + 90, 52, {
      stroke: accentColor,
      strokeOpacity: 0.4
    })
    return out
  }

  // Small helper: a rounded box with an accent bar on the left and
  // one text line per row. Each row is `[label, fill, size]`.
  function boxNode(x, y, w, h, lines, accentColor) {
    let out = rect(x, y, w, h, {
      radius: 9,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    out += rect(x, y, 3, h, { radius: 1.5, fill: accentColor })
    let lineY = y + 24
    for (const row of lines) {
      out += text(x + 18, lineY, row[0], {
        size: row[2] || 11.5,
        fill: row[1] || colors.inkSoft
      })
      lineY += 18
    }
    return out
  }

  // ----- LEFT column: boot -------------------------------------------
  body += columnHead(40, 'BOOT', colors.accentSoft)

  // createServer call with the toolFlowExtensions option.
  body += boxNode(
    40,
    64,
    360,
    52,
    [
      ['createServer({', colors.ink],
      ['  toolFlowExtensions: [ myExt ]', colors.accentSoft],
      ['})', colors.ink]
    ],
    colors.accent
  )
  body += arrowDown(220, 116, 140)

  // register(ctx) registers the tool, sets submit mode, provides context.
  body += boxNode(
    40,
    140,
    360,
    86,
    [
      ['register(ctx)', colors.ink, 12.5],
      ['ctx.registerTool(...)', colors.inkMuted],
      ["ctx.setFormSubmitMode('collect')", colors.accentSoft],
      ['ctx.provideContext(KEY, store)', colors.inkMuted]
    ],
    colors.accent
  )
  body += arrowDown(220, 226, 250)

  // Tool registry sealed — terminal state on the boot side.
  body += boxNode(40, 250, 360, 40, [['tool registry sealed', colors.inkDim, 12]], colors.lineMid)

  // ----- RIGHT column: per tool call ---------------------------------
  body += columnHead(480, 'PER TOOL CALL', colors.teal)

  // LLM invokes the model app tool.
  body += boxNode(
    480,
    64,
    360,
    40,
    [['LLM invokes new_model_app(...)', colors.ink, 12.5]],
    colors.blue
  )
  body += arrowDown(660, 104, 128)

  // Form data is collected (because submitMode = 'collect').
  body += boxNode(
    480,
    128,
    360,
    62,
    [
      ['collect form data', colors.ink, 12.5],
      ["because submitMode = 'collect'", colors.inkMuted]
    ],
    colors.teal
  )
  body += arrowDown(660, 190, 214)

  // The extension's own review tool runs.
  body += boxNode(
    480,
    214,
    360,
    44,
    [
      ["Extension's own tool", colors.ink, 12.5],
      ['e.g. review_approval', colors.amber]
    ],
    colors.amber
  )
  body += arrowDown(660, 258, 282)

  // Handler reads KEY from context and decides.
  body += boxNode(
    480,
    282,
    360,
    44,
    [
      ['Handler reads KEY from context,', colors.inkSoft],
      ['decides to submit or reject', colors.inkSoft]
    ],
    colors.accent
  )
  body += arrowDown(660, 326, 350, { color: colors.teal })

  // Resume the CRUD write via DataLayer.
  body += boxNode(
    480,
    350,
    360,
    40,
    [['Resume CRUD via DataLayer', colors.teal, 12.5]],
    colors.teal
  )

  const rendered = svg(width, height, 'TOOL FLOW EXTENSION · BOOT & PER-CALL', body, {
    alt: altText
  })
  return { svg: rendered, alt: altText }
}

export const flow = buildFlowFigure()
export default flow
