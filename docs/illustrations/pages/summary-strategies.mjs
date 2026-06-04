// pages/summary-strategies.mjs
//
// Authoring source for the summary-strategies guide's illustrations.
// Ported from the pilot's summary-strategies.html. The pilot uses one
// shared three-panel template — INPUT → ALGORITHM → OUTPUT — driven by
// a list of nine strategy descriptors, plus a separate "family split"
// overview figure. Each strategy becomes a named export keyed by its
// slug, and the overview figure is exported as `families`.

import { colors, text, svg } from '../illus.mjs'

// ---- typography tables for the three-panel template -------------------
// Each line of a panel column is tagged with a single letter that picks
// both the fill colour and the font size. These map the pilot's FILL /
// SIZE tables onto colors.* tokens. K and A share accentSoft in the
// pilot's FILL table — kept the same here.
const LINE_FILL = {
  H: colors.ink,
  B: colors.inkSoft,
  M: colors.inkMuted,
  A: colors.accentSoft,
  T: colors.teal,
  W: colors.amber,
  R: colors.rose,
  D: colors.inkDim,
  K: colors.accentSoft
}
const LINE_SIZE = {
  H: 12,
  B: 11.5,
  M: 11,
  A: 11.5,
  T: 11.5,
  W: 11.5,
  R: 11.5,
  D: 10.5,
  K: 12
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// One labelled panel column (INPUT, ALGORITHM, or OUTPUT). Each `lines`
// entry is a `tag:text` string; an empty string or one starting with `S`
// is a spacer row.
function renderPanel(x, label, dotFill, labelFill, lines) {
  // Panel body: rounded rect, header strip, divider, dot, caps label.
  let painted =
    `<rect x="${x}" y="52" width="248" height="304" rx="10" ` +
    `fill="${colors.panel}" stroke="${colors.panelStroke}"></rect>` +
    `<path d="M${x} 62a10 10 0 0 1 10-10h228a10 10 0 0 1 10 10v28H${x}z" ` +
    `fill="${colors.panelHead}"></path>` +
    `<line x1="${x}" y1="90" x2="${x + 248}" y2="90" ` +
    `stroke="${colors.panelStroke}"></line>` +
    `<circle cx="${x + 18}" cy="76" r="4" fill="${dotFill}"></circle>` +
    `<text x="${x + 32}" y="80" font-size="11.5" letter-spacing="0.14em" ` +
    `fill="${labelFill}">${escapeXml(label)}</text>`

  // Stack the body lines below the header. Empty strings (and lines
  // tagged `S` for "space") advance the cursor without painting.
  let cursorY = 118
  for (const ln of lines) {
    if (ln === '' || ln[0] === 'S') {
      cursorY += 11
      continue
    }
    const tag = ln[0]
    const body = ln.slice(2)
    painted +=
      `<text x="${x + 20}" y="${cursorY}" font-size="${LINE_SIZE[tag]}" ` +
      `fill="${LINE_FILL[tag]}" xml:space="preserve">${escapeXml(body)}</text>`
    cursorY += 18.5
  }
  return painted
}

// Shared three-panel diagram: INPUT → ALGORITHM → OUTPUT. `IN`, `ALG`
// and `OUT` are line arrays as described above.
function diagram(title, requires, IN, ALG, OUT) {
  const width = 900
  const height = 384
  const altText = `${title} strategy dataflow: INPUT to ALGORITHM to OUTPUT.`

  let body = ''

  // Right-aligned "requires:" caption sits to the right of the standard
  // svg() caption. svg() adds its own captionLeft; we add captionRight
  // via the options below.
  body += renderPanel(28, 'INPUT', colors.inkDim, colors.inkMuted, IN)

  // INPUT → ALGORITHM arrow.
  body +=
    `<g transform="translate(288,204)">` +
    `<line x1="0" y1="0" x2="30" y2="0" ` +
    `stroke="${colors.accentDeep}" stroke-width="2"></line>` +
    `<path d="M28 -6 L41 0 L28 6 Z" fill="${colors.accent}"></path>` +
    `</g>`

  body += renderPanel(332, 'ALGORITHM', colors.accent, colors.accentSoft, ALG)

  // ALGORITHM → OUTPUT arrow.
  body +=
    `<g transform="translate(592,204)">` +
    `<line x1="0" y1="0" x2="30" y2="0" ` +
    `stroke="${colors.tealDeep}" stroke-width="2"></line>` +
    `<path d="M28 -6 L41 0 L28 6 Z" fill="${colors.teal}"></path>` +
    `</g>`

  body += renderPanel(624, 'OUTPUT', colors.teal, colors.teal, OUT)

  const rendered = svg(width, height, title.toUpperCase() + ' · STRATEGY DATAFLOW', body, {
    alt: altText,
    captionRight: requires
  })

  return { svg: rendered, alt: altText }
}

// ---- the nine strategy descriptors (faithful to the pilot) -----------
const strategies = [
  {
    slug: 'rule-violation',
    title: 'rule-violation',
    req: 'requires: domainRegistry',
    IN: [
      'H:Records on the page',
      'M:+ DomainRegistry rules',
      'S',
      'D:BUSINESSRULE · scope=[book]',
      'W:completed-needs-rating',
      'W:  severity: warning',
      'R:needs-author',
      'R:  severity: error'
    ],
    ALG: [
      'M:for each rule scoping',
      'M:the model:',
      'S',
      'A:iterate records',
      'A:rule.evaluate()',
      'A:tally pass / fail',
      'A:collect first 10 ids',
      'A:keep 3 example msgs'
    ],
    OUT: [
      'K:rules[name]',
      'B:passed / failed',
      'B:severity',
      'B:description',
      'B:failed_ids[]',
      'M:  (cap 10)',
      'B:example_messages[]',
      'M:  (cap 3)'
    ]
  },
  {
    slug: 'anomaly',
    title: 'anomaly',
    req: 'N ≥ 4 records',
    IN: [
      'H:Page of N records',
      'M:(N ≥ 4)',
      'S',
      'M:e.g. pages column:',
      'B:312, 285, 2854,',
      'B:401, 268, …'
    ],
    ALG: [
      'H:Numeric fields:',
      'B:  mean, stddev',
      'A:  flag |z| > 2',
      'S',
      'H:Categorical',
      'M:(≤ 20 distinct):',
      'A:  flag share < 5%'
    ],
    OUT: [
      'K:outlier_records[]',
      'B:  {id, field,',
      'B:   value, z_score}',
      'S',
      'K:rare_values[]',
      'B:  {field, value,',
      'B:   count, share}'
    ]
  },
  {
    slug: 'coverage',
    title: 'coverage',
    req: 'all records · all fields',
    IN: [
      'H:All records, all',
      'H:fields:',
      'S',
      'B:title    50/50',
      'B:rating   38/50',
      'B:notes    29/50',
      'B:genre_id 50/50'
    ],
    ALG: [
      'H:Per field:',
      'B:  count null,',
      'B:  undefined, ""',
      'S',
      'B:missing_rate =',
      'B:  missing / total',
      'A:Flag if ≥ 50%'
    ],
    OUT: [
      'K:coverage[field]',
      'B:  {present,',
      'B:   missing, rate}',
      'S',
      'K:sparse_fields[]',
      'M:  (fields with',
      'W:   ≥ 50% missing)'
    ]
  },
  {
    slug: 'distribution',
    title: 'distribution',
    req: 'scans all records',
    IN: [
      "H:First record's",
      'H:fields, then',
      'H:scan all records:',
      'S',
      'B:status (enum)',
      'B:rating (numeric)',
      'B:created_at (date)',
      'B:title (other)'
    ],
    ALG: [
      'H:Classify field:',
      'B:  ≤ 20 distinct →',
      'A:     enum-like',
      'B:  numeric →',
      'A:     min/max/avg/median',
      'B:  ISO date → range',
      'M:  else → skip'
    ],
    OUT: [
      'K:fields[name]',
      'B:  enum   : top 5',
      'B:  numeric: min/max',
      'B:    avg/median',
      'B:  date   : earliest',
      'B:    / latest',
      'M:  other  : skipped'
    ]
  },
  {
    slug: 'entity-extraction',
    title: 'entity-extraction',
    req: 'scans *_id scalars',
    IN: [
      'H:Records with *_id',
      'H:scalar fields',
      'M:(not ‘id’):',
      'S',
      'B:author_id: a-3',
      'B:author_id: a-7',
      'B:genre_id:  g-sw',
      'B:genre_id:  g-arch'
    ],
    ALG: [
      'H:For each *_id',
      'H:field (excluding',
      'M:‘id’ itself):',
      'S',
      'A:count per value',
      'A:sort descending',
      'A:take top 5'
    ],
    OUT: [
      'K:fields[name]',
      'B:  total_refs',
      'B:  unique_refs',
      'B:  top: [',
      'B:    {id, count}',
      'B:    × 5',
      'B:  ]'
    ]
  },
  {
    slug: 'temporal',
    title: 'temporal',
    req: 'first ISO-date field',
    IN: [
      'H:First ISO-date',
      'H:field on records:',
      'B:2024-01-04',
      'B:2024-02-11',
      'M:(60-day gap)',
      'B:2024-10-22',
      'B:…'
    ],
    ALG: [
      'H:Pick bucket size:',
      'B:  span ≤ 14d  day',
      'B:  span ≤ 90d  week',
      'B:  else      month',
      'S',
      'B:Bucket + walk;',
      'A:flag empty buckets'
    ],
    OUT: [
      'K:buckets[]',
      'B:  {start, count}',
      'S',
      'K:gaps[]',
      'M:  (empty buckets',
      'M:   inside the span)',
      'B:days_since_latest'
    ]
  },
  {
    slug: 'semantic-cluster',
    title: 'semantic-cluster',
    req: 'requires: embeddings',
    IN: [
      'H:Records +',
      'H:embeddings',
      'M:Float32Array(384)',
      'S',
      'B:rec1: [embedding]',
      'B:rec2: [embedding]',
      'B:…'
    ],
    ALG: [
      'H:Pick first k',
      'H:records as anchors',
      'M:(default k = 5)',
      'S',
      'H:For each record:',
      'A:cosine dist to',
      'A:  each anchor;',
      'A:assign nearest'
    ],
    OUT: [
      'K:clusters[i]',
      'B:  size',
      'B:  mean_distance',
      'B:  representative_',
      'B:    id + hint',
      'M:    (title/name)',
      'B:  member_ids[]'
    ]
  },
  {
    slug: 'concept-touch',
    title: 'concept-touch',
    req: 'requires: domainRegistry',
    IN: [
      'H:Records + edges +',
      'H:DomainRegistry',
      'S',
      'M:Concept "catalogue"',
      'B:  = [book, author,',
      'B:      genre]'
    ],
    ALG: [
      'H:For each concept',
      'H:covering the model:',
      'B:  targets =',
      'B:   concept.models',
      'B:   - { model }',
      'A:  count records',
      'A:  with ≥ 1 edge',
      'A:  into any target'
    ],
    OUT: [
      'K:concepts[name]',
      'B:  touched / total',
      'B:  target_models[]',
      'B:  touched_by_',
      'B:    target{model}',
      'B:  missing_ids[]',
      'M:   (first 10 with',
      'M:    no touch)'
    ]
  },
  {
    slug: 'relationship-coverage',
    title: 'relationship-coverage',
    req: 'multi-hop edges',
    IN: [
      'H:Records + edges',
      'H:from multi-hop',
      'H:ingest',
      'S',
      'B:belongsTo:author',
      'B:belongsTo:genre',
      'B:hasMany:reviews'
    ],
    ALG: [
      'H:Per edge_type:',
      'B:  unique src_ids',
      'B:  coverage_pct =',
      'B:    unique / total',
      'A:  mean degree',
      'A:  max degree',
      'A:  target dist.',
      'A:  first 10 gaps'
    ],
    OUT: [
      'K:edge_types[name]',
      'B:  coverage_pct',
      'B:  mean_degree',
      'B:  max_degree',
      'B:  target_models{}',
      'B:  gap_ids[]',
      'M:   (first 10 src',
      'M:    with 0 edges)'
    ]
  }
]

// ---- the family-split overview figure --------------------------------
// Two side-by-side cards: the five field-level strategies on the left,
// the four GraphRAG-aware strategies on the right.
function buildFamiliesFigure() {
  const fieldFamily = ['distribution', 'coverage', 'anomaly', 'temporal', 'entity-extraction']
  const graphFamily = [
    ['relationship-coverage', 'requires: edges'],
    ['concept-touch', 'requires: edges + domain'],
    ['rule-violation', 'requires: domain'],
    ['semantic-cluster', 'requires: embeddings']
  ]

  const altText =
    'Nine summary strategies split into two families: field-level (5) — ' +
    'distribution, coverage, anomaly, temporal, entity-extraction — which ' +
    'run on records only and always run; and GraphRAG-aware (4) — ' +
    'relationship-coverage (requires edges), concept-touch (requires ' +
    'edges and domain), rule-violation (requires domain), semantic-cluster ' +
    '(requires embeddings) — which run only when the dispatcher can load ' +
    'the required auxiliary data.'

  let body = ''

  // ----- Left card: field-level family ------------------------------
  body +=
    `<rect x="28" y="52" width="396" height="268" rx="11" ` +
    `fill="${colors.panel}" stroke="${colors.panelStroke}"></rect>` +
    `<rect x="28" y="52" width="396" height="40" rx="11" ` +
    `fill="${colors.panelHead}"></rect>` +
    `<rect x="28" y="80" width="396" height="12" ` +
    `fill="${colors.panelHead}"></rect>`
  body +=
    `<text x="48" y="78" font-size="13" fill="${colors.blue}">` +
    `Field-level <tspan fill="${colors.inkDim}">(5)</tspan></text>`
  body += text(404, 78, 'records only', {
    size: 11,
    fill: colors.inkDim,
    anchor: 'end'
  })
  // Each row: blue dot + strategy name.
  for (let i = 0; i < fieldFamily.length; i += 1) {
    const rowY = 120 + i * 32
    body +=
      `<circle cx="58" cy="${rowY - 4}" r="3" fill="${colors.blue}"></circle>` +
      `<text x="74" y="${rowY}" font-size="12.5" fill="${colors.ink}">` +
      `${escapeXml(fieldFamily[i])}</text>`
  }
  body +=
    `<line x1="48" y1="290" x2="404" y2="290" stroke="${colors.panelStroke}" ` +
    `stroke-dasharray="2 4"></line>`
  body +=
    `<text x="48" y="310" font-size="10.5" fill="${colors.teal}">` +
    `always runs <tspan fill="${colors.inkDim}">· or simple shape gate</tspan></text>`

  // ----- Right card: GraphRAG-aware family --------------------------
  body +=
    `<rect x="456" y="52" width="396" height="268" rx="11" ` +
    `fill="${colors.panel}" stroke="${colors.panelStroke}"></rect>` +
    `<rect x="456" y="52" width="396" height="40" rx="11" ` +
    `fill="${colors.panelHead}"></rect>` +
    `<rect x="456" y="80" width="396" height="12" ` +
    `fill="${colors.panelHead}"></rect>`
  body +=
    `<text x="476" y="78" font-size="13" fill="${colors.accentSoft}">` +
    `GraphRAG-aware <tspan fill="${colors.inkDim}">(4)</tspan></text>`
  body += text(832, 78, 'records + auxiliary', {
    size: 11,
    fill: colors.inkDim,
    anchor: 'end'
  })
  // Each row: accent dot + strategy name + amber "requires:" subline.
  for (let i = 0; i < graphFamily.length; i += 1) {
    const [name, requires] = graphFamily[i]
    const rowY = 118 + i * 42
    body +=
      `<circle cx="486" cy="${rowY - 4}" r="3" fill="${colors.accentSoft}"></circle>` +
      `<text x="502" y="${rowY}" font-size="12.5" fill="${colors.ink}">` +
      `${escapeXml(name)}</text>` +
      `<text x="516" y="${rowY + 17}" font-size="10.5" fill="${colors.amber}">` +
      `${escapeXml(requires)}</text>`
  }
  body +=
    `<line x1="476" y1="290" x2="832" y2="290" stroke="${colors.panelStroke}" ` +
    `stroke-dasharray="2 4"></line>`
  body += text(476, 310, 'only when the dispatcher can load the required auxiliary data', {
    size: 10.5,
    fill: colors.inkDim
  })

  const rendered = svg(880, 378, '9 SUMMARY STRATEGIES · TWO FAMILIES', body, {
    alt: altText
  })

  return { svg: rendered, alt: altText }
}

// Build one figure per strategy, exported by slug. The slug-keyed map
// below holds all nine — the spread at the bottom re-exports each as
// a top-level named export.
const strategyFigures = {}
for (const strategy of strategies) {
  strategyFigures[strategy.slug] = diagram(
    strategy.title,
    strategy.req,
    strategy.IN,
    strategy.ALG,
    strategy.OUT
  )
}

// The family-split overview.
export const families = buildFamiliesFigure()

// Per-strategy exports — each named after the slug, with `-` swapped to
// camelCase so the identifier is a valid JS export name. The build
// script reads exports by name and writes one .svg per export; the
// remark plugin resolves `<!-- illustration: summary-strategies#... -->`
// markers against these names.
export const ruleViolation = strategyFigures['rule-violation']
export const anomaly = strategyFigures['anomaly']
export const coverage = strategyFigures['coverage']
export const distribution = strategyFigures['distribution']
export const entityExtraction = strategyFigures['entity-extraction']
export const temporal = strategyFigures['temporal']
export const semanticCluster = strategyFigures['semantic-cluster']
export const conceptTouch = strategyFigures['concept-touch']
export const relationshipCoverage = strategyFigures['relationship-coverage']
