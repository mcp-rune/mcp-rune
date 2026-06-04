// pages/analysis-memories.mjs
//
// Authoring source for the analysis-memories guide's illustration.
// Ported from the pilot's analysis-memories.html. One large figure:
// the session lifecycle, with the LLM driving a loop across two
// backing tables.

import { colors, text, rect, line, svg } from '../illus.mjs'

// Build the "session lifecycle" diagram: bootstrap → read ⇄ write →
// act → teardown, with embed/JSONB tagging on each step.
function buildLifeFigure() {
  // Canvas width matches the pilot; height is computed as we stack
  // stage panels, then a footnote row is added below the last stage.
  const width = 880

  const altText =
    'Analysis-memories session lifecycle driven by the LLM across two ' +
    'tables (ingested_records JSONB and analysis_memories vector). ' +
    '① BOOTSTRAP: analysis_ingest auto-paginates GET requests into ' +
    'ingested_records and embeds per-page summaries into ' +
    'analysis_memories. ② READ: analysis_query runs SQL over ' +
    'ingested_records, or semantic mode embeds the query and does ' +
    'cosine search over analysis_memories. ③ WRITE: analysis_store ' +
    'embeds findings into analysis_memories with no API call. Steps ' +
    '② and ③ loop. ③.5 ACT: analysis_act selects IDs from ' +
    'ingested_records and batches PATCH/DELETE upstream. ④ TEARDOWN: ' +
    'analysis_clear deletes both tables. Embedding occurs only at ' +
    'ingest, store, and semantic query.'

  // Colour shortcuts used by the per-table tagging — matches the
  // pilot's ING/MEM/EMB locals.
  const INGEST = colors.amber
  const MEMORY = colors.teal
  const EMBED = colors.accentSoft

  let body = ''

  // ----- pill() helper -------------------------------------------------
  // A faint coloured pill around a label. Returns { svg, width } so the
  // caller can advance the cursor.
  function makePill(x, y, label, color, fillOpacity) {
    const pillW = label.length * 6.3 + 18
    let result = rect(x, y - 13, pillW, 20, {
      radius: 6,
      fill: color,
      fillOpacity: fillOpacity == null ? 0.12 : fillOpacity,
      stroke: color,
      strokeOpacity: 0.4
    })
    result += text(x + pillW / 2, y + 1, label, {
      size: 10,
      fill: color,
      anchor: 'middle'
    })
    return { svg: result, width: pillW }
  }

  // ----- flow() helper -------------------------------------------------
  // Lays out a horizontal "sentence" of tokens at (x, y), advancing the
  // cursor for each. Tokens:
  //   { arrow: true, color?, label?, embed? }  → short arrow + tip
  //   { pill: true, text, color, fillOpacity? } → coloured pill
  //   { text, size?, color? }                  → plain label
  function renderFlow(startX, y, tokens) {
    let cursorX = startX
    for (const token of tokens) {
      if (token.arrow) {
        const arrowColor = token.color || colors.lineMid
        body += line(cursorX, y - 3, cursorX + 18, y - 3, {
          stroke: arrowColor,
          strokeWidth: 1.4,
          dash: token.embed ? '3 3' : ''
        })
        body += `<path d="M${cursorX + 18} ${y - 7} l8 4 -8 4 z" fill="${arrowColor}"></path>`
        cursorX += 30
        if (token.label) {
          body += text(cursorX - 15, y - 12, token.label, {
            size: 8.5,
            fill: colors.inkDim,
            anchor: 'middle'
          })
        }
      } else if (token.pill) {
        const pill = makePill(cursorX, y, token.text, token.color, token.fillOpacity)
        body += pill.svg
        cursorX += pill.width + 10
      } else {
        const fontSize = token.size || 11
        body += text(cursorX, y + 1, token.text, {
          size: fontSize,
          fill: token.color || colors.inkSoft
        })
        // Heuristic char-width advance lifted from the pilot.
        const charWidth = token.size ? token.size * 0.56 : 6.2
        cursorX += token.text.length * charWidth + 10
      }
    }
    return cursorX
  }

  // ----- stage() helper ------------------------------------------------
  // A numbered stage panel with a circled marker, caps title, sub-line,
  // signature row, and a body callback that draws the per-stage flow
  // lines below.
  function renderStage(stageY, h, marker, name, accent, sub, signature, drawBody) {
    body += rect(28, stageY, 824, h, {
      radius: 11,
      fill: colors.panel,
      stroke: colors.panelStroke
    })
    body += rect(28, stageY, 3, h, { radius: 1.5, fill: accent })
    body += `<circle cx="58" cy="${stageY + 26}" r="14" fill="${accent}" fill-opacity="0.14" stroke="${accent}" stroke-opacity="0.45"></circle>`
    body += text(58, stageY + 30, marker, {
      size: 13,
      fill: accent,
      anchor: 'middle'
    })
    body += text(82, stageY + 24, name, {
      size: 12.5,
      fill: accent,
      letterSpacing: '0.06em'
    })
    body += text(82 + name.length * 7.6 + 18, stageY + 24, sub, {
      size: 10.5,
      fill: colors.inkDim
    })
    body += text(82, stageY + 45, signature, { size: 12, fill: colors.ink })
    drawBody(stageY)
  }

  // ----- Top caption + legend pills -----------------------------------
  body += text(28, 34, 'SESSION LIFECYCLE', {
    size: 11,
    letterSpacing: '0.08em',
    fill: colors.inkDim
  })
  body += text(232, 34, 'the LLM is the loop driver', {
    size: 10.5,
    fill: colors.inkDim
  })
  let legendX = 560
  const legendIng = makePill(legendX, 32, 'ingested_records', INGEST)
  body += legendIng.svg
  body += text(legendX + legendIng.width + 6, 33, 'JSONB', {
    size: 9,
    fill: colors.inkDim
  })
  legendX += legendIng.width + 58
  const legendMem = makePill(legendX, 32, 'analysis_memories', MEMORY)
  body += legendMem.svg
  body += text(legendX + legendMem.width + 6, 33, 'vector', {
    size: 9,
    fill: colors.inkDim
  })

  // ----- ① BOOTSTRAP ---------------------------------------------------
  let y = 52
  renderStage(
    y,
    128,
    '①',
    'BOOTSTRAP',
    colors.blue,
    'runs once per analysis_id',
    'analysis_ingest(model, filters)',
    (yy) => {
      renderFlow(96, yy + 74, [
        { text: 'GET /api/<model>?page=N', color: colors.inkMuted },
        { arrow: true, label: '≤50 pages' },
        { pill: true, text: 'ingested_records', color: INGEST },
        { text: 'raw JSONB · 1h TTL', color: colors.inkDim, size: 9.5 }
      ])
      renderFlow(96, yy + 104, [
        { text: 'per-page summary', color: colors.inkMuted },
        { arrow: true, color: EMBED, embed: true, label: 'EMBED' },
        { pill: true, text: 'analysis_memories', color: MEMORY },
        { text: 'page_summary:<strategy>', color: colors.inkDim, size: 9.5 }
      ])
    }
  )
  y += 128 + 22

  // ----- ② READ --------------------------------------------------------
  renderStage(
    y,
    124,
    '②',
    'READ',
    colors.accentSoft,
    'LLM queries to understand the data',
    'analysis_query(analysis_id, mode, …)',
    (yy) => {
      renderFlow(96, yy + 74, [
        {
          text: 'describe / aggregate / filter / sample',
          color: colors.inkMuted
        },
        { arrow: true, label: 'SQL' },
        { pill: true, text: 'ingested_records', color: INGEST }
      ])
      body += text(
        120,
        yy + 90,
        'GROUP BY · JSONB @> · range casts · ROW_NUMBER() · date_bin() buckets',
        { size: 9.5, fill: colors.inkDim }
      )
      renderFlow(96, yy + 112, [
        { text: 'semantic', color: colors.inkSoft },
        { arrow: true, color: EMBED, embed: true, label: 'EMBED(q)' },
        { text: 'cosine', color: colors.inkMuted },
        { arrow: true },
        { pill: true, text: 'analysis_memories', color: MEMORY }
      ])
    }
  )
  y += 124 + 8

  // ----- Loop badge between READ and WRITE -----------------------------
  body += rect(width / 2 - 92, y, 184, 22, {
    radius: 11,
    fill: colors.frame,
    stroke: colors.lineSoft
  })
  body += text(width / 2, y + 15, '② ⇄ ③  repeat as a loop', {
    size: 10.5,
    fill: colors.accentSoft,
    anchor: 'middle'
  })
  y += 30

  // ----- ③ WRITE -------------------------------------------------------
  renderStage(
    y,
    100,
    '③',
    'WRITE',
    MEMORY,
    'commits insights from step ②',
    'analysis_store(findings[])  ·  no API call',
    (yy) => {
      renderFlow(96, yy + 78, [
        { text: 'finding text', color: colors.inkMuted },
        { arrow: true, color: EMBED, embed: true, label: 'EMBED' },
        { pill: true, text: 'analysis_memories', color: MEMORY },
        {
          text: 'category by LLM · 1h TTL or persistent',
          color: colors.inkDim,
          size: 9.5
        }
      ])
    }
  )
  y += 100 + 22

  // ----- ③·⁵ ACT -------------------------------------------------------
  renderStage(
    y,
    116,
    '③·⁵',
    'ACT',
    colors.amber,
    'optional · mutate a subset',
    'analysis_act(analysis_id, model, where?, action, …)',
    (yy) => {
      renderFlow(96, yy + 74, [
        { text: 'SELECT ids FROM', color: colors.inkMuted },
        { pill: true, text: 'ingested_records', color: INGEST },
        { text: 'WHERE <predicate>', color: colors.inkMuted },
        { arrow: true },
        { text: 'resolved IDs', color: colors.inkSoft },
        { text: '(server-side only)', color: colors.inkDim, size: 9.5 }
      ])
      renderFlow(96, yy + 102, [
        { text: 'batches of 50 · concurrency 5', color: colors.inkMuted },
        { arrow: true, label: 'upstream' },
        { text: 'PATCH/DELETE /api/<endpoint>', color: colors.inkSoft },
        { arrow: true },
        { text: '{ total, succeeded, failed }', color: colors.teal, size: 10 }
      ])
    }
  )
  y += 116 + 22

  // ----- ④ TEARDOWN ----------------------------------------------------
  renderStage(
    y,
    82,
    '④',
    'TEARDOWN',
    colors.rose,
    'final synthesis done',
    'analysis_clear(analysis_id)',
    (yy) => {
      renderFlow(96, yy + 74, [
        { text: 'DELETE FROM', color: colors.rose },
        { pill: true, text: 'ingested_records', color: INGEST },
        { text: '·  DELETE FROM', color: colors.rose },
        { pill: true, text: 'analysis_memories', color: MEMORY }
      ])
    }
  )
  y += 82

  // ----- EMBED footnote ------------------------------------------------
  body += text(
    28,
    y + 30,
    'EMBED = MiniLM-L6-v2 · local · 384-dim. Crosses the line at ①, ③, and ②-semantic only — raw API rows never touch the embedder.',
    { size: 10, fill: colors.inkDim }
  )

  const rendered = svg(width, y + 48, '', body, { alt: altText })

  return { svg: rendered, alt: altText }
}

export const life = buildLifeFigure()
export default life
