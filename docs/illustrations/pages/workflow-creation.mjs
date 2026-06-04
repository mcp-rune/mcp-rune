// pages/workflow-creation.mjs
//
// Authoring source for the workflow-creation guide's illustration.
// Ported from the pilot's workflow-creation.html. The figure shows
// the roadmap → typed step sequence → advance loop.

import { colors, text, rect, line, arrowDown, svg } from '../illus.mjs'

// Build the "typed step sequence" diagram. An entry pill at the top
// (suggest_workflow), a roadmap container with five typed step rows,
// and an exit pill at the bottom (get_workflow_step).
function buildWorkflowFigure() {
  const width = 820

  // Container geometry — the roadmap sits inside this band.
  const containerX = 60
  const containerWidth = width - 120
  const containerY = 108
  const containerHeight = 288

  // Per-step-type accent colour. The 'loop' colour has no token in the
  // shared palette so it stays a literal — see report at the bottom.
  const typeColor = {
    tool: colors.blue,
    analysis: colors.teal,
    parallel: colors.amber,
    decision: colors.accentSoft,
    loop: '#ff8a9b'
  }

  const altText =
    'suggest_workflow returns a roadmap plus step 1. The roadmap ' +
    'contains typed steps: Step 1 tool (call MCP tool, capture result), ' +
    'Step 2 analysis (LLM digests result, no tool call), Step 3 parallel ' +
    '(sub-step A and B), Step 4 decision (branch X or Y, user picks), ' +
    'Step 5 loop (repeat until exit condition). get_workflow_step ' +
    'advances one step at a time.'

  let body = ''

  // ----- Entry pill: suggest_workflow → roadmap + step 1 --------------
  body += rect(width / 2 - 180, 46, 360, 32, {
    radius: 8,
    fill: colors.panelHead,
    stroke: colors.panelStroke
  })
  body += text(width / 2, 67, 'suggest_workflow(name)  →  roadmap + step 1', {
    size: 12,
    fill: colors.accentSoft,
    anchor: 'middle'
  })
  body += arrowDown(width / 2, 78, 102)

  // ----- Roadmap container --------------------------------------------
  body += rect(containerX, containerY, containerWidth, containerHeight, {
    radius: 12,
    fill: colors.band,
    stroke: colors.panelStroke
  })

  // A single step row. If `subSteps` is provided, the right-hand side
  // forks into two labelled branches with their own arrows; otherwise
  // it shows a `→ description` line.
  function stepRow(y, stepNumber, type, description, subSteps) {
    let out = ''
    out += text(containerX + 40, y + 24, 'Step ' + stepNumber, {
      size: 12.5,
      fill: colors.ink
    })

    // Coloured type pill: "tool", "analysis", etc.
    const accentColor = typeColor[type]
    const pillWidth = type.length * 7.6 + 20
    out += rect(containerX + 108, y + 10, pillWidth, 20, {
      radius: 6,
      fill: accentColor,
      fillOpacity: 0.13,
      stroke: accentColor,
      strokeOpacity: 0.4
    })
    out += text(containerX + 118, y + 24, type, {
      size: 11,
      fill: accentColor
    })

    // Either a single description or a fork into two sub-steps.
    const descriptionX = containerX + 108 + type.length * 7.6 + 40
    if (subSteps) {
      out += line(descriptionX - 14, y + 20, descriptionX, y + 20, {
        stroke: colors.lineMid,
        strokeWidth: 1.3
      })
      out += line(descriptionX, y + 12, descriptionX, y + 44, {
        stroke: colors.lineMid,
        strokeWidth: 1.3
      })
      // Top branch arrow.
      out += line(descriptionX, y + 12, descriptionX + 10, y + 12, {
        stroke: colors.lineMid,
        strokeWidth: 1.3
      })
      out += `<path d="M${descriptionX + 10} ${y + 8} l8 4 -8 4 z" fill="${accentColor}"></path>`
      // Bottom branch arrow.
      out += line(descriptionX, y + 44, descriptionX + 10, y + 44, {
        stroke: colors.lineMid,
        strokeWidth: 1.3
      })
      out += `<path d="M${descriptionX + 10} ${y + 40} l8 4 -8 4 z" fill="${accentColor}"></path>`
      out += text(descriptionX + 24, y + 16, subSteps[0], {
        size: 11,
        fill: colors.inkSoft
      })
      out += text(descriptionX + 24, y + 48, subSteps[1], {
        size: 11,
        fill: colors.inkSoft
      })
    } else {
      out += text(descriptionX, y + 24, '→ ' + description, {
        size: 11.5,
        fill: colors.inkMuted
      })
    }
    return out
  }

  // The five step rows.
  body += stepRow(124, '1', 'tool', 'call MCP tool, capture result')
  body += stepRow(166, '2', 'analysis', 'LLM digests result, no tool call')
  body += stepRow(208, '3', 'parallel', null, ['sub-step A', 'sub-step B'])
  body += stepRow(268, '4', 'decision', null, ['branch X  (user picks)', 'branch Y'])
  body += stepRow(330, '5', 'loop', 'repeat until exit condition')

  // ----- Advance pill: get_workflow_step ------------------------------
  body += arrowDown(width / 2, containerY + containerHeight, containerY + containerHeight + 24)
  body += text(width / 2, containerY + containerHeight + 44, 'get_workflow_step(step n+1)', {
    size: 12,
    fill: colors.accentSoft,
    anchor: 'middle'
  })
  body += text(width / 2, containerY + containerHeight + 62, 'advances one step at a time', {
    size: 10.5,
    fill: colors.inkDim,
    anchor: 'middle'
  })

  const height = containerY + containerHeight + 82
  const rendered = svg(width, height, 'WORKFLOW · TYPED STEP SEQUENCE', body, {
    alt: altText
  })
  return { svg: rendered, alt: altText }
}

export const wf = buildWorkflowFigure()
export default wf
