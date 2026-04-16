/**
 * DomainRegistry - Aggregates all domain intelligence
 *
 * Composes model metadata + cross-entity knowledge + business rules + workflows.
 * Dependency-injected like PromptRegistry. Gracefully absent like vector storage.
 */

import type { EvaluationResult, RuleSet } from './business-rules.js'
import type { DomainConcept, ModelContext } from './knowledge.js'
import type { DomainKnowledge } from './knowledge.js'
import type { WorkflowDefinition, WorkflowRegistry } from './workflows.js'

export interface DomainRegistryConfig {
  knowledge: DomainKnowledge
  rules: RuleSet
  workflows: WorkflowRegistry
}

export class DomainRegistry {
  knowledge: DomainKnowledge
  rules: RuleSet
  workflows: WorkflowRegistry

  constructor({ knowledge, rules, workflows }: DomainRegistryConfig) {
    this.knowledge = knowledge
    this.rules = rules
    this.workflows = workflows
  }

  /**
   * Initialize search across all sub-registries.
   * Fire-and-forget at startup -- SubstringSearch resolves instantly,
   * EmbeddingSearch computes embeddings async.
   */
  async initSearch(strategy?: string): Promise<void> {
    await Promise.all([this.knowledge.initSearch(strategy), this.workflows.initSearch(strategy)])
  }

  // ============================================================================
  // Context enrichment
  // ============================================================================

  /** Get composed context for a model (field metadata + cross-entity concepts) */
  getContextForModel(model: string): ModelContext {
    const context = this.knowledge.getContextForModel(model)

    // Add applicable business rules
    context.rules = this.rules.describeRules(model)

    // Add related workflows
    context.workflows = this.workflows.getWorkflowsByModel(model).map((w) => ({
      name: w.name,
      title: w.title,
      description: w.description,
      tags: w.tags
    }))

    return context
  }

  /** Get a specific concept */
  getConcept(name: string): DomainConcept | undefined {
    return this.knowledge.getConcept(name)
  }

  /** Search concepts */
  async searchConcepts(query: string): Promise<DomainConcept[]> {
    return await this.knowledge.searchConcepts(query)
  }

  // ============================================================================
  // Business rules
  // ============================================================================

  /** Evaluate business rules for a model */
  checkRules(
    model: string,
    data: Record<string, unknown>,
    context?: Record<string, unknown>
  ): EvaluationResult {
    return this.rules.evaluate(model, data, context)
  }

  /** Get rule descriptions for a model */
  describeRules(model: string): Array<{ name: string; description: string; severity: string }> {
    return this.rules.describeRules(model)
  }

  // ============================================================================
  // Workflows
  // ============================================================================

  /** Search workflows by goal */
  async suggestWorkflow(goal: string): Promise<WorkflowDefinition[]> {
    return await this.workflows.searchWorkflows(goal)
  }

  /** Get a specific workflow */
  getWorkflow(name: string): WorkflowDefinition | undefined {
    return this.workflows.getWorkflow(name)
  }

  /** Get workflows by tag */
  getWorkflowsByTag(tag: string): WorkflowDefinition[] {
    return this.workflows.getWorkflowsByTag(tag)
  }
}
