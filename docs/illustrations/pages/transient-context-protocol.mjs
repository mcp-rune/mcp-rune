// pages/transient-context-protocol.mjs
//
// Authoring source for the transient-context-protocol guide's illustration.
// Ported from the pilot's transient-context-protocol.html.

import { colors, text, rect, arrowDown, svg } from '../illus.mjs'

// Build the lifecycle diagram: producer registers transient/consumer pairs,
// a transient search result is consumed, then collapsed into its summary.
function buildLifeFigure() {
  // Canvas: 760 wide, height computed as we stack the step panels.
  const width = 760
  const panelX = 80
  const panelWidth = width - 160

  const altText =
    'Lifecycle: get_workflow_step sets _meta.contextHints registering ' +
    'transient/consumer pairs; search_records returns a result marked ' +
    '_meta.context.lifecycle transient with a summary; the LLM analyzes ' +
    'the data; store_analysis_memory sets _meta.context.consumed true; ' +
    'the client then collapses the search_records result and replaces it ' +
    'with the summary.'

  // Each step is a left-accent panel; some have a meta line and a deeper
  // height, others are "plain" notes (no meta).
  const steps = [
    {
      tool: 'get_workflow_step',
      meta: '_meta.contextHints',
      note: 'registers transient / consumer pairs',
      color: colors.accentSoft
    },
    {
      tool: 'search_records',
      meta: "_meta.context.lifecycle: 'transient'",
      note: '+ summary attached',
      color: colors.blue
    },
    {
      tool: 'LLM analyzes the data',
      meta: '',
      note: 'reads the transient payload',
      color: colors.inkMuted,
      plain: true
    },
    {
      tool: 'store_analysis_memory',
      meta: '_meta.context.consumed: true',
      note: 'the consumer fires',
      color: colors.teal
    },
    {
      tool: 'Client collapses search_records result',
      meta: '',
      note: '→ replaced with summary',
      color: colors.amber,
      plain: true
    }
  ]

  let body = ''
  let y = 58

  // ----- Stacked step panels with down-arrows between them -----------
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]
    const h = step.meta ? 62 : 48
    // Panel + left accent bar.
    body += rect(panelX, y, panelWidth, h, {
      radius: 10,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    body += rect(panelX, y, 3, h, { radius: 1.5, fill: step.color })
    // Tool name on the left.
    body += text(panelX + 20, y + (step.meta ? 26 : 30), step.tool, {
      size: 12.5,
      fill: step.plain ? colors.inkSoft : colors.ink
    })
    // Meta token in the panel colour, when present.
    if (step.meta) {
      body += text(panelX + 20, y + 46, step.meta, {
        size: 11,
        fill: step.color
      })
    }
    // Right-anchored note in dim ink.
    body += text(panelX + panelWidth - 20, y + (step.meta ? 46 : 30), step.note, {
      size: 10.5,
      fill: colors.inkDim,
      anchor: 'end'
    })
    // Connector arrow to the next step.
    if (i < steps.length - 1) {
      body += arrowDown(panelX + panelWidth / 2, y + h, y + h + 24)
    }
    y += h + 24
  }

  const rendered = svg(width, y - 2, 'TRANSIENT CONTEXT · LIFECYCLE', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const life = buildLifeFigure()
export default life
