/**
 * Built-in `concept-touch` strategy.
 *
 * For each `DomainConcept` whose `models` list covers the model being
 * summarized: how many records have ≥1 edge to each of the concept's *other*
 * models? Reports per-concept touched/total counts + missing-record IDs so
 * the LLM can see which slices of the relationship graph are sparsely
 * populated in this analysis session.
 *
 * Complementary to `relationship-coverage` (which is edge-type-centric and
 * domain-blind) and `entity-extraction` (which is field-centric).
 *
 * `appliesTo` skips when no concept covers the model, when the dispatcher
 * didn't supply edges, or when the page is empty.
 */

import type { SummaryEdge, SummaryInput, SummaryOutput, SummaryStrategy } from './types.js'

const MISSING_LIMIT = 10

interface ConceptSlice {
  touched: number
  total: number
  target_models: ReadonlyArray<string>
  touched_by_target: Record<string, number>
  missing_ids: string[]
}

export const conceptTouchStrategy: SummaryStrategy = {
  name: 'concept-touch',
  description:
    "For each DomainConcept covering this model, reports the % of records that have ≥1 edge into any of the concept's other models. Requires multi-hop ingest (hop_depth ≥ 1) and at least one concept registered for the model.",
  requires: ['edges', 'domainRegistry'],
  appliesTo(input: SummaryInput): boolean {
    if (input.records.length === 0) return false
    if (!input.edges) return false
    const concepts = input.domainRegistry?.knowledge?.getConceptsForModel?.(input.model) ?? []
    return concepts.length > 0
  },
  generate(input: SummaryInput): SummaryOutput {
    const { model, page, totalPages, records } = input
    const edges: ReadonlyArray<SummaryEdge> = input.edges ?? []
    const concepts = input.domainRegistry?.knowledge?.getConceptsForModel?.(input.model) ?? []
    const total = records.length
    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`

    const recordIds = new Set<string>()
    for (const r of records) {
      if (r.id != null) recordIds.add(String(r.id))
    }

    // Index edges by source for fast lookup
    const edgesBySource = new Map<string, SummaryEdge[]>()
    for (const e of edges) {
      const list = edgesBySource.get(e.src_id)
      if (list) list.push(e)
      else edgesBySource.set(e.src_id, [e])
    }

    const slices: Record<string, ConceptSlice> = {}
    const lines: string[] = []

    for (const concept of concepts) {
      const targets = concept.models.filter((m) => m !== model)
      if (targets.length === 0) continue
      const targetSet = new Set(targets)
      let touched = 0
      const touchedByTarget: Record<string, number> = {}
      const missing: string[] = []

      for (const id of recordIds) {
        const myEdges = edgesBySource.get(id) ?? []
        const hitTargets = new Set<string>()
        for (const e of myEdges) {
          if (targetSet.has(e.dst_model)) hitTargets.add(e.dst_model)
        }
        if (hitTargets.size > 0) {
          touched++
          for (const t of hitTargets) {
            touchedByTarget[t] = (touchedByTarget[t] ?? 0) + 1
          }
        } else if (missing.length < MISSING_LIMIT) {
          missing.push(id)
        }
      }

      slices[concept.name] = {
        touched,
        total,
        target_models: targets,
        touched_by_target: touchedByTarget,
        missing_ids: missing
      }

      const pct = total > 0 ? Math.round((touched / total) * 100) : 0
      const perTarget = Object.entries(touchedByTarget)
        .map(([t, n]) => `${t}=${n}`)
        .join(', ')
      lines.push(
        `${concept.name} → [${targets.join(', ')}]: ${touched}/${total} (${pct}%)` +
          (perTarget ? `; per-target ${perTarget}` : '')
      )
    }

    const finding =
      `Page ${pageLabel} of ${model} records (${total} records). ` +
      (lines.length > 0
        ? `Concept touch: ${lines.join('. ')}.`
        : 'No concepts cover this model in the registry.')

    return {
      finding,
      metadata: {
        page,
        model,
        record_count: total,
        concepts: slices
      }
    }
  }
}
