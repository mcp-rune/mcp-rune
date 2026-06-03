/**
 * Zod schemas and resolution helpers for the analysis_query sample-mode
 * `stratifiers` parameter.
 *
 * Validates each kind's shape and resolves concept names against the
 * DomainRegistry so the SQL layer never sees an unknown concept (clean
 * MCP error vs. SQL surprise).
 */

import { z } from 'zod'

import type { GraphStratifierSpec } from '#src/services/vector-storage.js'

export const ConceptStratifierSchema = z.object({
  kind: z.literal('concept'),
  concept: z.string().describe('Name of a DomainConcept that touches this model.')
})

export const EdgeStratifierSchema = z.object({
  kind: z.literal('edge'),
  edge_type: z
    .string()
    .describe(
      'Edge type as stored in ingested_edges (e.g. "belongsTo:author", "hasMany:reviews", "fk:owner_id").'
    ),
  bucket: z
    .enum(['present', 'count'])
    .optional()
    .describe(
      'Partition mode. "present" (default) → binary flag; "count" → degree buckets ("0","1","2-5","6+").'
    )
})

export const ClusterStratifierSchema = z.object({
  kind: z.literal('cluster'),
  k: z
    .number()
    .int()
    .min(2)
    .max(20)
    .describe('Number of clusters (2–20). Anchor-nearest assignment.')
})

export const StratifierSchema = z.discriminatedUnion('kind', [
  ConceptStratifierSchema,
  EdgeStratifierSchema,
  ClusterStratifierSchema
])

export const StratifiersArraySchema = z
  .array(StratifierSchema)
  .max(3)
  .describe(
    'Up to 3 composable graph stratifiers. Composes with where / proximity / stratify_by. ' +
      '`concept` requires a DomainConcept registered on this server. `cluster` requires record embeddings; ' +
      'analysis_query auto-back-fills them on demand.'
  )

export interface ConceptResolver {
  knowledge?: { getConceptsForModel?: (model: string) => Array<{ name: string; models: string[] }> }
  getConceptByName?: (name: string) => { name: string; models: string[] } | undefined
}

export interface UnresolvedConceptError {
  ok: false
  message: string
}

export interface ResolvedConcept {
  ok: true
  concept: string
  targetModels: ReadonlyArray<string>
}

/**
 * Resolve a concept name against the DomainRegistry. Returns the concept's
 * non-source target models — the models the sampler counts edges into.
 */
export function resolveConceptForStratifier(
  registry: ConceptResolver | undefined,
  conceptName: string,
  sourceModel: string
): ResolvedConcept | UnresolvedConceptError {
  if (!registry) {
    return {
      ok: false,
      message: `Concept stratifier "${conceptName}" requires a DomainRegistry, but none is configured.`
    }
  }

  const candidates = registry.knowledge?.getConceptsForModel?.(sourceModel) ?? []
  const match = candidates.find((c) => c.name === conceptName)
  if (!match) {
    const names = candidates.map((c) => c.name).join(', ') || '(none)'
    return {
      ok: false,
      message: `Concept "${conceptName}" not found for model "${sourceModel}". Available: ${names}.`
    }
  }

  const targets = match.models.filter((m) => m !== sourceModel)
  if (targets.length === 0) {
    return {
      ok: false,
      message: `Concept "${conceptName}" lists only "${sourceModel}" — no target models to stratify against.`
    }
  }

  return { ok: true, concept: conceptName, targetModels: targets }
}

/**
 * Convert a validated stratifier input (the user-facing shape) into the
 * internal GraphStratifierSpec the vector-storage layer consumes. Concepts
 * are resolved via the registry; failures throw with the resolver's message
 * so the tool layer can return a clean MCP error.
 */
export function toGraphStratifierSpec(
  input: z.infer<typeof StratifierSchema>,
  resolver: ConceptResolver | undefined,
  sourceModel: string
): GraphStratifierSpec {
  switch (input.kind) {
    case 'concept': {
      const resolved = resolveConceptForStratifier(resolver, input.concept, sourceModel)
      if (!resolved.ok) throw new Error(resolved.message)
      return {
        kind: 'concept',
        concept: resolved.concept,
        targetModels: resolved.targetModels
      }
    }
    case 'edge':
      return { kind: 'edge', edge_type: input.edge_type, bucket: input.bucket }
    case 'cluster':
      return { kind: 'cluster', k: input.k }
  }
}
