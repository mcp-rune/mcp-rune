/**
 * Pure CTE builders for graph-aware sample stratifiers.
 *
 * Each builder takes a paramRef accumulator (mutable index + params array)
 * and returns a CTE clause + partition expression. The caller (the pgvector
 * sample-query routine) composes them into a multi-CTE PARTITION BY that
 * sits alongside the existing temporal-bucket and discrete-field stratifiers.
 *
 * No I/O. No SQL execution. Pure string + param assembly.
 */

export interface ParamRef {
  /** 1-based next placeholder index. Builders mutate this. */
  next: number
  /** Param values, in placeholder order. Builders push onto this. */
  params: unknown[]
}

export type GraphStratifier =
  | { kind: 'concept'; concept: string; targetModels: ReadonlyArray<string> }
  | { kind: 'edge'; edge_type: string; bucket?: 'present' | 'count' }
  | { kind: 'cluster'; k: number }

export interface StratifierFragment {
  /** A CTE clause body (the part after `<name> AS (...)`), or null when no CTE is needed. */
  cte: { name: string; body: string } | null
  /** Expression usable inside `PARTITION BY` / `COUNT(DISTINCT ROW(...))`. */
  partitionExpr: string
  /** LEFT JOIN clause to apply against `filtered` so the partition expr resolves. */
  join: string | null
}

const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

function safeEdgeType(value: string): string {
  // edge types include `:` (e.g., `belongsTo:author`) — already param-quoted,
  // but we also surface them as identifiers in CTE names. Sanitize for that.
  return value.replace(/[^a-zA-Z0-9_]+/g, '_')
}

function safeConceptName(value: string): string {
  if (!FIELD_NAME_RE.test(value)) {
    throw new Error(`Invalid concept name: ${value}`)
  }
  return value.replace(/-/g, '_')
}

/**
 * Concept stratifier — binary flag: 1 if the record has ≥1 edge whose
 * destination model is in the concept's target-model list, else 0.
 */
export function buildConceptStratifier(
  spec: { concept: string; targetModels: ReadonlyArray<string> },
  ref: ParamRef
): StratifierFragment {
  const cteName = `concept_${safeConceptName(spec.concept)}`
  const analysisIdParam = `$1`
  const targetsParam = `$${ref.next}`
  ref.params.push([...spec.targetModels])
  ref.next++

  const body = `
    SELECT f.id AS rid,
      CASE WHEN EXISTS (
        SELECT 1 FROM ingested_edges e
        WHERE e.analysis_id = ${analysisIdParam}
          AND e.src_id = (f.data->>'id')
          AND e.dst_model = ANY(${targetsParam}::text[])
          AND (e.expires_at IS NULL OR e.expires_at > NOW())
      ) THEN 1 ELSE 0 END AS concept_flag
    FROM filtered f
  `.trim()

  return {
    cte: { name: cteName, body },
    partitionExpr: `${cteName}.concept_flag`,
    join: `LEFT JOIN ${cteName} ON ${cteName}.rid = filtered.id`
  }
}

/**
 * Edge stratifier — partition by edge presence (binary flag) or degree bucket
 * (`'0' | '1' | '2-5' | '6+'`).
 */
export function buildEdgeStratifier(
  spec: { edge_type: string; bucket?: 'present' | 'count' },
  ref: ParamRef
): StratifierFragment {
  const cteName = `edge_${safeEdgeType(spec.edge_type)}`
  const analysisIdParam = `$1`
  const edgeTypeParam = `$${ref.next}`
  ref.params.push(spec.edge_type)
  ref.next++

  const body = `
    SELECT f.id AS rid,
      (SELECT COUNT(*) FROM ingested_edges e
       WHERE e.analysis_id = ${analysisIdParam}
         AND e.src_id = (f.data->>'id')
         AND e.edge_type = ${edgeTypeParam}
         AND (e.expires_at IS NULL OR e.expires_at > NOW())) AS edge_n
    FROM filtered f
  `.trim()

  const bucket = spec.bucket ?? 'present'
  const partitionExpr =
    bucket === 'count'
      ? `CASE WHEN ${cteName}.edge_n = 0 THEN '0'
              WHEN ${cteName}.edge_n = 1 THEN '1'
              WHEN ${cteName}.edge_n <= 5 THEN '2-5'
              ELSE '6+' END`
      : `CASE WHEN ${cteName}.edge_n > 0 THEN 1 ELSE 0 END`

  return {
    cte: { name: cteName, body },
    partitionExpr,
    join: `LEFT JOIN ${cteName} ON ${cteName}.rid = filtered.id`
  }
}

/**
 * Cluster stratifier — pick `k` random anchor records from the filtered slice,
 * assign each record to its nearest anchor by embedding cosine distance.
 *
 * Documented as approximate: cluster IDs are not stable across queries because
 * the anchors are randomly selected from the post-filter set. The goal is to
 * spread the sample across semantically different records, not to produce
 * production-quality clusters.
 */
export function buildClusterStratifier(
  spec: { k: number },
  ref: ParamRef
): { fragments: StratifierFragment; anchorsCte: { name: string; body: string } } {
  if (!Number.isInteger(spec.k) || spec.k < 2 || spec.k > 20) {
    throw new Error(`Invalid cluster k: ${spec.k}. Must be an integer in [2, 20].`)
  }

  const kParam = `$${ref.next}`
  ref.params.push(spec.k)
  ref.next++

  const anchorsCte = {
    name: 'cluster_anchors',
    body: `
      SELECT id, embedding, ROW_NUMBER() OVER (ORDER BY RANDOM()) AS anchor_id
      FROM filtered
      WHERE embedding IS NOT NULL
      LIMIT ${kParam}
    `.trim()
  }

  const assignCte = {
    name: 'cluster_assign',
    body: `
      SELECT f.id AS rid,
        (SELECT a.anchor_id FROM cluster_anchors a
         ORDER BY f.embedding <=> a.embedding LIMIT 1) AS cluster_id
      FROM filtered f
      WHERE f.embedding IS NOT NULL
    `.trim()
  }

  // The "primary" fragment uses cluster_assign; we surface anchorsCte
  // separately so the caller can prepend it (it must come before cluster_assign).
  return {
    anchorsCte,
    fragments: {
      cte: assignCte,
      partitionExpr: `cluster_assign.cluster_id`,
      join: `LEFT JOIN cluster_assign ON cluster_assign.rid = filtered.id`
    }
  }
}
