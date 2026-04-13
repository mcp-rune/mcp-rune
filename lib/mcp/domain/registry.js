/**
 * DomainRegistry - Aggregates all domain intelligence
 *
 * Composes model metadata + cross-entity knowledge + business rules + workflows.
 * Dependency-injected like PromptRegistry. Gracefully absent like vector storage.
 */

export class DomainRegistry {
  /**
   * @param {Object} config
   * @param {import('./knowledge.js').DomainKnowledge} config.knowledge - Cross-entity knowledge
   * @param {import('./business-rules.js').RuleSet} config.rules - Business rules
   * @param {import('./workflows.js').WorkflowRegistry} config.workflows - Workflow definitions
   */
  constructor({ knowledge, rules, workflows }) {
    this.knowledge = knowledge
    this.rules = rules
    this.workflows = workflows
  }

  /**
   * Initialize search across all sub-registries.
   * Fire-and-forget at startup — SubstringSearch resolves instantly,
   * EmbeddingSearch computes embeddings async.
   * @param {string} [strategy] - Search strategy ('substring' | 'embedding')
   * @returns {Promise<void>}
   */
  async initSearch(strategy) {
    await Promise.all([this.knowledge.initSearch(strategy), this.workflows.initSearch(strategy)])
  }

  // ============================================================================
  // Context enrichment
  // ============================================================================

  /**
   * Get composed context for a model (field metadata + cross-entity concepts)
   * @param {string} model - Model name
   * @returns {Object} Composed context
   */
  getContextForModel(model) {
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

  /**
   * Get a specific concept
   * @param {string} name - Concept name
   * @returns {import('./knowledge.js').DomainConcept|undefined}
   */
  getConcept(name) {
    return this.knowledge.getConcept(name)
  }

  /**
   * Search concepts
   * @param {string} query
   * @returns {Promise<import('./knowledge.js').DomainConcept[]>}
   */
  async searchConcepts(query) {
    return await this.knowledge.searchConcepts(query)
  }

  // ============================================================================
  // Business rules
  // ============================================================================

  /**
   * Evaluate business rules for a model
   * @param {string} model - Model name
   * @param {Object} data - Entity data
   * @param {Object} [context] - Additional context
   * @returns {Object} { passed, results }
   */
  checkRules(model, data, context) {
    return this.rules.evaluate(model, data, context)
  }

  /**
   * Get rule descriptions for a model
   * @param {string} model - Model name
   * @returns {Object[]}
   */
  describeRules(model) {
    return this.rules.describeRules(model)
  }

  // ============================================================================
  // Workflows
  // ============================================================================

  /**
   * Search workflows by goal
   * @param {string} goal
   * @returns {Promise<import('./workflows.js').WorkflowDefinition[]>}
   */
  async suggestWorkflow(goal) {
    return await this.workflows.searchWorkflows(goal)
  }

  /**
   * Get a specific workflow
   * @param {string} name
   * @returns {import('./workflows.js').WorkflowDefinition|undefined}
   */
  getWorkflow(name) {
    return this.workflows.getWorkflow(name)
  }

  /**
   * Get workflows by tag
   * @param {string} tag
   * @returns {import('./workflows.js').WorkflowDefinition[]}
   */
  getWorkflowsByTag(tag) {
    return this.workflows.getWorkflowsByTag(tag)
  }
}
