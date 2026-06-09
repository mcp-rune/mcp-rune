/**
 * DomainRegistry — facade over a DomainAdapter
 *
 * Accepts a DomainAdapter (storage backend) and exposes the domain intelligence
 * API consumed by domain tools. All methods are async to support remote adapters.
 */

import type { DomainAdapter } from './adapters/base-adapter.js'
import type {
  EvaluationResult,
  ModelClass,
  ModelContext,
  RuleSeverity
} from './domain-definitions.js'
import type { DomainConcept } from './knowledge.js'
import type { WorkflowDefinition } from './workflows.js'

export interface DomainRegistryConfig {
  adapter: DomainAdapter
  /** Optional field-level model metadata, forwarded to getContextForModel. */
  models?: Record<string, ModelClass>
}

export class DomainRegistry {
  readonly adapter: DomainAdapter
  private _models: Record<string, ModelClass>

  constructor({ adapter, models = {} }: DomainRegistryConfig) {
    this.adapter = adapter
    this._models = models
  }

  /**
   * Initialise search indexing across all domain items.
   * Fire-and-forget at startup — SubstringSearch resolves instantly,
   * EmbeddingSearch computes embeddings async.
   */
  async initSearch(strategy?: string): Promise<void> {
    await this.adapter.initSearch?.(strategy)
  }

  // ─── Context enrichment ───────────────────────────────────────────────────

  /** Get composed context for a model: field metadata + concepts + rules + workflows */
  async getContextForModel(modelName: string): Promise<ModelContext> {
    const [concepts, rules, workflows] = await Promise.all([
      this.adapter.getConceptsForModel(modelName),
      this.adapter.describeRules(modelName),
      this.adapter.getWorkflowsByModel(modelName)
    ])

    const context: ModelContext = {
      model: modelName,
      concepts: concepts.map((c) => ({
        name: c.name,
        title: c.title,
        description: c.description,
        models: c.models,
        details: c.details
      })),
      rules,
      workflows: workflows.map((w) => ({
        name: w.name,
        title: w.title,
        description: w.description,
        tags: w.tags
      }))
    }

    // Pull optional field-level metadata from model registry
    const ModelClassDef = this._models[modelName]
    if (ModelClassDef) {
      context.description = ModelClassDef.description
      context.readOnly = ModelClassDef.api?.readOnly || false
      context.attributes = Object.entries(ModelClassDef.attributes || {}).map(([name, cfg]) => ({
        name,
        label: cfg.label,
        type: cfg.type,
        required: cfg.required || false,
        immutable: cfg.immutable || false,
        description: cfg.description
      }))
      context.associations = ModelClassDef.associations || {}
    }

    return context
  }

  /** Get a specific concept by name */
  async getConcept(name: string): Promise<DomainConcept | undefined> {
    return this.adapter.getConcept(name)
  }

  /** Get all concepts */
  async getAllConcepts(): Promise<DomainConcept[]> {
    return this.adapter.getAllConcepts()
  }

  /** Get all concepts that involve a specific model */
  async getConceptsForModel(modelName: string): Promise<DomainConcept[]> {
    return this.adapter.getConceptsForModel(modelName)
  }

  /** Search concepts by query string */
  async searchConcepts(query: string): Promise<DomainConcept[]> {
    return this.adapter.searchConcepts(query)
  }

  // ─── Business rules ───────────────────────────────────────────────────────

  /** Evaluate business rules for a model */
  async checkRules(
    model: string,
    data: Record<string, unknown>,
    context?: Record<string, unknown>
  ): Promise<EvaluationResult> {
    return this.adapter.evaluateRules(model, data, context)
  }

  /** Get rule descriptions for a model */
  async describeRules(
    model: string
  ): Promise<Array<{ name: string; description: string; severity: RuleSeverity }>> {
    return this.adapter.describeRules(model)
  }

  // ─── Workflows ────────────────────────────────────────────────────────────

  /** Search workflows by goal */
  async suggestWorkflow(goal: string): Promise<WorkflowDefinition[]> {
    return this.adapter.searchWorkflows(goal)
  }

  /** Get a specific workflow by exact name */
  async getWorkflow(name: string): Promise<WorkflowDefinition | undefined> {
    return this.adapter.getWorkflow(name)
  }

  /** Get all workflows */
  async getAllWorkflows(): Promise<WorkflowDefinition[]> {
    return this.adapter.getAllWorkflows()
  }

  /** Get workflows by tag */
  async getWorkflowsByTag(tag: string): Promise<WorkflowDefinition[]> {
    return this.adapter.getWorkflowsByTag(tag)
  }
}
