/**
 * DomainAdapter — storage interface for domain knowledge
 *
 * The adapter pattern (not a "layer") because remote backends have no local
 * config to project — items come purely from a database. Mirrors
 * src/oauth2/adapters/base-adapter.ts.
 *
 * InMemoryDomainAdapter is the shipped implementation.
 * Remote adapters (PGVector, Qdrant) are not yet shipped — they require a
 * seeding/sync mechanism to be designed first.
 */

import type { BusinessRule } from '../business-rules.js'
import type { EvaluationResult, RuleSeverity } from '../domain-definitions.js'
import type { DomainConcept } from '../knowledge.js'
import type { WorkflowDefinition } from '../workflows.js'

export interface DomainAdapter {
  init(): Promise<void>
  close(): Promise<void>
  /** Optional: initialise search indexing (substring or embedding). */
  initSearch?(strategy?: string): Promise<void>

  // Concepts
  getConcept(name: string): Promise<DomainConcept | undefined>
  getAllConcepts(): Promise<DomainConcept[]>
  searchConcepts(query: string): Promise<DomainConcept[]>
  getConceptsForModel(modelName: string): Promise<DomainConcept[]>

  // Rules — evaluate closures always live in code; remote adapters hold them in memory only
  getRulesForModel(model: string): Promise<BusinessRule[]>
  describeRules(
    model: string
  ): Promise<Array<{ name: string; description: string; severity: RuleSeverity }>>
  evaluateRules(
    model: string,
    data: Record<string, unknown>,
    context?: Record<string, unknown>
  ): Promise<EvaluationResult>

  // Workflows
  getWorkflow(name: string): Promise<WorkflowDefinition | undefined>
  getAllWorkflows(): Promise<WorkflowDefinition[]>
  searchWorkflows(query: string): Promise<WorkflowDefinition[]>
  getWorkflowsByModel(model: string): Promise<WorkflowDefinition[]>
  getWorkflowsByTag(tag: string): Promise<WorkflowDefinition[]>
}
