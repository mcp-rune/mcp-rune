// illus.mjs — shared SVG primitives for the docs illustration gallery.
//
// A tiny SVG DSL: every helper returns a string of SVG markup; figures
// are composed by concatenating helper calls. There is no DOM here —
// the build script imports this module from plain Node, so we never
// need jsdom or a browser to produce a figure.
//
// Renamed from the original inline pilot `illus.js`. The pilot used
// single-letter exports (T, R, L, C) because it ran inside HTML
// `<script>` blocks where byte count mattered. The module-API form is
// descriptive on purpose; see `docs/illustrations/README.md`.

// ---------- theme tokens ----------------------------------------------------

export const colors = {
  // page chrome
  frame: '#0c0c12',
  frameStroke: '#23232f',
  // panels and sub-panels
  panel: '#14141e',
  panelStroke: '#2a2a38',
  panelHead: '#1c1c28',
  band: '#101019',
  // ink (text) — progressively dimmer
  ink: '#e7e7ee',
  inkSoft: '#c7c7d1',
  inkMuted: '#9a9aa8',
  inkDim: '#6a6a78',
  inkFaint: '#5a5a68',
  // accents
  accent: '#7c5cff',
  accentSoft: '#a78bfa',
  accentDeep: '#4f3da6',
  teal: '#7ee2c1',
  tealDeep: '#2f6e57',
  amber: '#f0c674',
  blue: '#8aa6ff',
  aqua: '#aebfff',
  rose: '#ff8a9b',
  // hairlines (rules, dividers, connector strokes)
  line: '#2a2a38',
  lineSoft: '#383848',
  lineMid: '#4a4a5e'
}

export const FONT = "'Geist Mono',ui-monospace,monospace"

// ---------- internal helpers ----------------------------------------------

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------- primitives ----------------------------------------------------

// A text label.
//   options: { size, fill, letterSpacing, anchor, weight }
export function text(x, y, value, options = {}) {
  const anchor = options.anchor ? ` text-anchor="${options.anchor}"` : ''
  const letterSpacing = options.letterSpacing ? ` letter-spacing="${options.letterSpacing}"` : ''
  const weight = options.weight ? ` font-weight="${options.weight}"` : ''
  const fontSize = options.size ?? 11.5
  const fill = options.fill ?? colors.inkSoft
  return (
    `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${fill}"` +
    `${anchor}${letterSpacing}${weight} xml:space="preserve">` +
    `${escapeXml(value)}</text>`
  )
}

// A rounded rectangle — used for panels, accent bars, pills.
//   options: { radius, fill, stroke, strokeWidth, dash, fillOpacity, strokeOpacity }
export function rect(x, y, width, height, options = {}) {
  const radius = options.radius != null ? ` rx="${options.radius}"` : ''
  const stroke = options.stroke ? ` stroke="${options.stroke}"` : ''
  const strokeWidth = options.strokeWidth ? ` stroke-width="${options.strokeWidth}"` : ''
  const dash = options.dash ? ` stroke-dasharray="${options.dash}"` : ''
  const fillOpacity = options.fillOpacity != null ? ` fill-opacity="${options.fillOpacity}"` : ''
  const strokeOpacity =
    options.strokeOpacity != null ? ` stroke-opacity="${options.strokeOpacity}"` : ''
  const fill = options.fill ?? colors.panel
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}"` +
    `${radius} fill="${fill}"${fillOpacity}${stroke}${strokeOpacity}` +
    `${strokeWidth}${dash}></rect>`
  )
}

// A line segment — used for connectors and dividers.
//   options: { stroke, strokeWidth, dash }
export function line(x1, y1, x2, y2, options = {}) {
  const dash = options.dash ? ` stroke-dasharray="${options.dash}"` : ''
  const stroke = options.stroke ?? colors.line
  const strokeWidth = options.strokeWidth ?? 1
  return (
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"` +
    ` stroke="${stroke}" stroke-width="${strokeWidth}"${dash}></line>`
  )
}

// A labelled container with a small dot at top-left and a caps label —
// used to mark a layer in a layered diagram.
//   options: { fill, dot, labelFill, sub, subOffsetX }
export function band(x, y, width, height, label, options = {}) {
  const fill = options.fill ?? colors.band
  const dot = options.dot ?? colors.accent
  const labelFill = options.labelFill ?? colors.accentSoft
  let body = rect(x, y, width, height, {
    radius: 12,
    fill,
    stroke: colors.panelStroke
  })
  body += `<circle cx="${x + 20}" cy="${y + 26}" r="4" fill="${dot}"></circle>`
  body += text(x + 32, y + 30, label, {
    size: 12,
    letterSpacing: '0.12em',
    fill: labelFill
  })
  if (options.sub) {
    body += text(x + 32 + (options.subOffsetX ?? 108), y + 30, options.sub, {
      size: 11,
      fill: colors.inkDim
    })
  }
  return body
}

// A titled sub-panel that sits inside a band.
//   options: { fill, radius, accentBar, titleFill, sub, titleOffsetX }
export function panel(x, y, width, height, title, options = {}) {
  const fill = options.fill ?? colors.panel
  const radius = options.radius != null ? options.radius : 9
  let body = rect(x, y, width, height, {
    radius,
    fill,
    stroke: colors.panelStroke
  })
  if (options.accentBar) {
    body += rect(x, y, 3, height, { radius: 1.5, fill: options.accentBar })
  }
  if (title) {
    body += text(x + (options.accentBar ? 22 : 20), y + 26, title, {
      size: 12,
      fill: options.titleFill ?? colors.ink
    })
  }
  if (options.sub) {
    body += text(x + (options.titleOffsetX ?? 140), y + 26, options.sub, {
      size: 10.5,
      fill: colors.inkDim
    })
  }
  return body
}

// Horizontal arrow — line with a filled tip glyph at (x2, y).
//   options: { color, lineColor }
export function arrowRight(x1, y, x2, options = {}) {
  const color = options.color ?? colors.accent
  const lineColor = options.lineColor ?? colors.lineMid
  return (
    line(x1, y, x2, y, { stroke: lineColor, strokeWidth: 1.5 }) +
    `<path d="M${x2 - 6} ${y - 5} L${x2 + 2} ${y} L${x2 - 6} ${y + 5} Z" ` +
    `fill="${color}"></path>`
  )
}

// Vertical arrow — line with a filled tip glyph at (x, y2).
//   options: { color, lineColor }
export function arrowDown(x, y1, y2, options = {}) {
  const color = options.color ?? colors.accent
  const lineColor = options.lineColor ?? colors.lineMid
  return (
    line(x, y1, x, y2, { stroke: lineColor, strokeWidth: 1.5 }) +
    `<path d="M${x - 5} ${y2 - 6} L${x} ${y2 + 2} L${x + 5} ${y2 - 6} Z" ` +
    `fill="${color}"></path>`
  )
}

// Vertical connector — line between two stacked elements with a centred
// pill label and tip glyphs at both ends.
//   options: { color, tip }
export function verticalConnector(x, y1, y2, label, options = {}) {
  const color = options.color ?? colors.accentSoft
  const tip = options.tip ?? colors.accent
  const midY = (y1 + y2) / 2
  const pillWidth = label.length * 6.2 + 24
  let body = line(x, y1, x, y2, { stroke: colors.lineMid, strokeWidth: 1.5 })
  body += `<path d="M${x - 4} ${y1 + 6} L${x} ${y1} L${x + 4} ${y1 + 6} Z" fill="${tip}"></path>`
  body += `<path d="M${x - 4} ${y2 - 6} L${x} ${y2} L${x + 4} ${y2 - 6} Z" fill="${tip}"></path>`
  body += rect(x - pillWidth / 2, midY - 11, pillWidth, 22, {
    radius: 11,
    fill: colors.frame,
    stroke: colors.lineSoft
  })
  body += text(x, midY + 4, label, {
    size: 10.5,
    fill: color,
    anchor: 'middle'
  })
  return body
}

// Frame an assembled body in the outer <svg> root. Adds the viewBox,
// the corner caption, and the aria-label. **Call this last.**
//   options: { alt, captionRight }
export function svg(width, height, caption, body, options = {}) {
  const captionLeft = caption
    ? text(28, 32, caption, {
        size: 11,
        letterSpacing: '0.08em',
        fill: colors.inkDim
      })
    : ''
  const captionRight = options.captionRight
    ? text(width - 28, 32, options.captionRight, {
        size: 11,
        fill: colors.inkDim,
        anchor: 'end'
      })
    : ''
  const altAttribute = escapeXml(options.alt || caption || 'diagram').replace(/"/g, '&quot;')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" font-family="${FONT}" ` +
    `role="img" aria-label="${altAttribute}">` +
    rect(0.5, 0.5, width - 1, height - 1, {
      radius: 14,
      fill: colors.frame,
      stroke: colors.frameStroke
    }) +
    captionLeft +
    captionRight +
    body +
    `</svg>`
  )
}

// Convert an ASCII directory-tree string into a coloured <div class="tree">.
// Used by tree-archetype figures — the colouring picks up directory names,
// file names, comment columns, and box-drawing guides.
export function colorizeTree(raw) {
  const lines = String(raw).replace(/\s+$/, '').split('\n')
  let out = ''
  for (const ln of lines) {
    if (ln === '') {
      out += '\n'
      continue
    }
    const matched = ln.match(/^([\s│├└─]*)(.*)$/)
    const guide = matched[1]
    const rest = matched[2]
    let html = `<span class="g">${escapeXml(guide)}</span>`
    if (rest) {
      // A continuation line (│ or spaces, no ├/└ connector) is wrapped
      // description text from the row above.
      const isContinuation = /│/.test(guide) && !/[├└]/.test(guide)
      if (isContinuation) {
        html += `<span class="cm">${escapeXml(rest)}</span>`
        out += html + '\n'
        continue
      }
      let name = rest
      let description = ''
      const hashIndex = rest.indexOf('#')
      if (hashIndex >= 0) {
        name = rest.slice(0, hashIndex)
        description = rest.slice(hashIndex)
      } else {
        // Split an aligned trailing description (separated by 2+ spaces).
        const split = rest.match(/^(.*?\S)(\s{2,})(\S.*)$/)
        if (split) {
          name = split[1] + split[2]
          description = split[3]
        }
      }
      const trimmed = name.replace(/\s+$/, '')
      const isDirectory = /\/$/.test(trimmed)
      html += isDirectory
        ? `<span class="dir">${escapeXml(name)}</span>`
        : `<span class="file">${escapeXml(name)}</span>`
      if (description) {
        html += `<span class="cm">${escapeXml(description)}</span>`
      }
    }
    out += html + '\n'
  }
  return `<div class="tree">${out}</div>`
}
