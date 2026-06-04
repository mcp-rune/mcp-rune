// pages/stateful-strategies.mjs
//
// Authoring source for the stateful-strategies guide's illustration.
// Ported from the pilot's stateful-strategies.html (which inlined a
// hand-written SVG rather than calling Illus helpers — so the port
// reconstructs the same picture using the shared DSL).

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the "section progression" diagram: get_prompt_guide advancing
// through three sections with validate/loop branches, getProgress() as
// a status side-channel, and a final generateSummary mutation.
function buildProgressionFigure() {
  // Canvas — matches the pilot's 720×520 viewBox.
  const width = 720
  const height = 520

  const altText =
    'Stateful prompt section progression: get_prompt_guide advances ' +
    'through Section 1 basics, Section 2 classification, and Section 3 ' +
    'timing. Each section is validated — errors loop back, ok advances. ' +
    'getProgress() reports completed [basics, classification] and ' +
    'pending [timing] at any time. Finally generateSummary applies a ' +
    'create_model or update_model mutation.'

  let body = ''

  // ----- Small helpers --------------------------------------------------
  // Down-arrow with a tall solid line + filled triangular tip. The
  // stock arrowDown() in illus.mjs uses different proportions (thinner
  // line and a tip with a tail), so we render inline to keep the
  // pilot's heavier accent stroke.
  function accentDownArrow(x, y1, y2) {
    let result = `<path d="M${x} ${y1} V${y2}" fill="none" `
    result += `stroke="${colors.accent}" stroke-width="1.75"></path>`
    const tipTop = y2 - 4
    result += `<path d="M${x - 6} ${tipTop} L${x} ${tipTop + 12} `
    result += `L${x + 6} ${tipTop} Z" fill="${colors.accent}"></path>`
    return result
  }

  // Pilot's section label pill: a faint accent-tinted background with a
  // matching stroke, label centred via x-offset.
  function sectionPill(x, y, w, label) {
    let result = rect(x, y, w, 20, {
      radius: 10,
      fill: colors.accent,
      fillOpacity: 0.12,
      stroke: colors.accent,
      strokeOpacity: 0.3
    })
    result += text(x + 12, y + 14, label, {
      size: 11,
      fill: colors.accentSoft
    })
    return result
  }

  // ----- Header: get_prompt_guide trigger ------------------------------
  body += rect(40, 48, 184, 32, {
    radius: 8,
    fill: colors.panelHead,
    stroke: colors.panelStroke
  })
  body += text(58, 68, 'get_prompt_guide', {
    size: 12,
    fill: colors.accentSoft
  })
  body += accentDownArrow(132, 80, 108)

  // ----- Section 1: basics ---------------------------------------------
  body += rect(40, 110, 300, 86, {
    radius: 10,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += text(58, 136, 'Section 1', { size: 12.5, fill: colors.ink })
  body += sectionPill(138, 124, 60, 'basics')
  body += line(58, 150, 322, 150, { stroke: colors.panelStroke, dash: '2 4' })
  body += text(58, 170, 'title', { size: 11.5, fill: colors.inkMuted })
  body += text(58, 188, 'description', { size: 11.5, fill: colors.inkMuted })
  // Validation side-panel commentary.
  body += text(360, 130, "validateSection('basics')", {
    size: 11,
    fill: colors.inkMuted
  })
  body += text(360, 154, 'ok → advance', { size: 11, fill: colors.teal })
  body += text(360, 174, 'errors → loop back', { size: 11, fill: colors.rose })

  // Down-arrow + "advance" label connecting Section 1 → Section 2.
  body += accentDownArrow(132, 196, 234)
  body += text(144, 216, 'advance', { size: 10, fill: colors.inkMuted })

  // ----- Section 2: classification -------------------------------------
  body += rect(40, 236, 300, 86, {
    radius: 10,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += text(58, 262, 'Section 2', { size: 12.5, fill: colors.ink })
  body += sectionPill(138, 250, 108, 'classification')
  body += line(58, 276, 322, 276, { stroke: colors.panelStroke, dash: '2 4' })
  body += text(58, 296, 'theme_id', { size: 11.5, fill: colors.inkMuted })
  body += text(58, 314, 'category_id', { size: 11.5, fill: colors.inkMuted })
  body += text(360, 256, "validateSection('classification')", {
    size: 11,
    fill: colors.inkMuted
  })
  body += text(360, 280, 'ok → advance', { size: 11, fill: colors.teal })
  body += text(360, 300, 'errors → loop back', { size: 11, fill: colors.rose })

  body += accentDownArrow(132, 322, 360)
  body += text(144, 342, 'advance', { size: 10, fill: colors.inkMuted })

  // ----- Section 3: timing ---------------------------------------------
  body += rect(40, 362, 300, 86, {
    radius: 10,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += text(58, 388, 'Section 3', { size: 12.5, fill: colors.ink })
  body += sectionPill(138, 376, 60, 'timing')
  body += line(58, 402, 322, 402, { stroke: colors.panelStroke, dash: '2 4' })
  body += text(58, 422, 'occurred_at', { size: 11.5, fill: colors.inkMuted })
  body += text(58, 440, 'duration_minutes', { size: 11.5, fill: colors.inkMuted })
  body += text(360, 382, "validateSection('timing')", {
    size: 11,
    fill: colors.inkMuted
  })
  body += text(360, 406, 'ok → advance', { size: 11, fill: colors.teal })

  // Down-arrow into generateSummary.
  body += accentDownArrow(132, 448, 482)

  // ----- generateSummary → apply mutation ------------------------------
  body += rect(40, 476, 170, 34, {
    radius: 8,
    fill: colors.panelHead,
    stroke: colors.panelStroke
  })
  body += text(56, 497, 'generateSummary', {
    size: 12,
    fill: colors.accentSoft
  })
  // Teal arrow into the mutation pill on the right.
  body += `<path d="M210 493 H242" fill="none" stroke="${colors.teal}" stroke-width="1.75"></path>`
  body += `<path d="M238 487 L250 493 L238 499 Z" fill="${colors.teal}"></path>`
  body += rect(252, 474, 240, 38, {
    radius: 8,
    fill: colors.teal,
    fillOpacity: 0.08,
    stroke: colors.teal,
    strokeOpacity: 0.3
  })
  body += text(268, 491, 'apply mutation', { size: 12, fill: colors.ink })
  body += text(268, 505, 'create_model / update_model', {
    size: 10.5,
    fill: colors.teal
  })

  // ----- getProgress() status side-channel -----------------------------
  // Floating panel on the right with a dashed dim connector from
  // Section 3 indicating "callable any time".
  body += rect(540, 332, 164, 152, {
    radius: 10,
    fill: colors.panel,
    stroke: colors.panelStroke
  })
  body += `<path d="M455 420 H534" fill="none" stroke="${colors.lineSoft}" stroke-width="1.25" stroke-dasharray="3 4"></path>`
  body += `<path d="M530 416 L542 420 L530 424 Z" fill="${colors.inkFaint}"></path>`
  body += text(558, 358, 'getProgress()', {
    size: 12,
    fill: colors.accentSoft
  })
  body += text(558, 376, '◀ call status anytime', {
    size: 10,
    fill: colors.inkMuted
  })
  body += line(558, 386, 688, 386, {
    stroke: colors.panelStroke,
    dash: '2 4'
  })
  body += text(558, 406, 'completed:', { size: 11, fill: colors.inkMuted })
  body += text(568, 424, "['basics',", { size: 11, fill: colors.teal })
  body += text(568, 440, " 'classification']", {
    size: 11,
    fill: colors.teal
  })
  // Pending row uses an inline <tspan> in the pilot to colour the value.
  body += `<text x="558" y="462" font-size="11" fill="${colors.inkMuted}" xml:space="preserve">`
  body += `pending: <tspan fill="${colors.amber}">['timing']</tspan></text>`

  const rendered = svg(width, height, 'STATEFUL PROMPT · SECTION PROGRESSION', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

export const progression = buildProgressionFigure()
export default progression
