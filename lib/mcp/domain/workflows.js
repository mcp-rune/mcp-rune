/**
 * WorkflowDefinition + WorkflowRegistry - Multi-step process orchestration
 *
 * Structured workflows spanning multiple entities. Each workflow
 * has ordered steps with tool calls, decision points, and tips.
 * Tagged for filtering (e.g., 'demo', 'onboarding').
 */

import { SubstringSearch, createDomainSearch } from './search-strategy.js'

export class WorkflowStep {
  /**
   * @param {Object} config
   * @param {number} config.order - Step number (1-based)
   * @param {string} config.title - Step title
   * @param {string} config.description - What this step does
   * @param {string} [config.tool] - MCP tool to call (e.g., 'find_model', 'create_model')
   * @param {Object} [config.toolArgs] - Example arguments for the tool
   * @param {Object} [config.decision] - Decision point: { question, options: [{label, description, nextStep?}] }
   * @param {string[]} [config.tips] - Tips for this step
   * @param {string} [config.parallelGroup] - Steps with the same parallelGroup run concurrently (must be adjacent in steps array)
   * @param {number[]} [config.dependsOn] - Step order numbers that must complete before this step starts
   * @param {Object} [config.changeset] - Changeset integration (MCP client mutation review)
   * @param {boolean} [config.changeset.mutating] - Marks this step as performing mutations
   * @param {string} [config.changeset.requiresPlan] - Plan name that must be previewed before this step
   * @param {boolean} [config.optional] - Step can be skipped if its tool is not available
   * @param {string} [config.fallbackDescription] - What to do instead when the step is skipped
   * @param {boolean} [config.exhaustive] - Step needs ALL paginated records (renders pagination guidance)
   * @param {string} [config.loopGroup] - Steps with the same loopGroup iterate together per page (must be adjacent)
   * @param {Object} [config.contextHint] - Hint for client context management (transient context protocol)
   * @param {string} [config.contextHint.lifecycle] - 'transient' marks this step's output as collapsible after consumption
   * @param {string} [config.contextHint.consumedBy] - Tool name that consumes this step's output (triggers collapse)
   */
  constructor({
    order,
    title,
    description,
    tool,
    toolArgs,
    decision,
    tips = [],
    parallelGroup,
    dependsOn,
    changeset,
    optional,
    fallbackDescription,
    exhaustive,
    loopGroup,
    contextHint
  }) {
    this.order = order
    this.title = title
    this.description = description
    this.tool = tool
    this.toolArgs = toolArgs
    this.decision = decision
    this.tips = tips
    this.parallelGroup = parallelGroup
    this.dependsOn = dependsOn
    this.changeset = changeset || null
    this.optional = optional || false
    this.fallbackDescription = fallbackDescription || null
    this.exhaustive = exhaustive || false
    this.loopGroup = loopGroup || null
    this.contextHint = contextHint || null
  }
}

export class WorkflowDefinition {
  /**
   * @param {Object} config
   * @param {string} config.name - Unique workflow identifier
   * @param {string} config.title - Human-readable title
   * @param {string} config.description - What this workflow accomplishes
   * @param {string[]} [config.tags] - Tags for filtering (e.g., 'demo', 'onboarding')
   * @param {string[]} [config.models] - Models involved in this workflow
   * @param {WorkflowStep[]} config.steps - Ordered steps
   */
  constructor({
    name,
    title,
    description,
    tags = [],
    models = [],
    steps = [],
    draftRequired,
    mutationPlans
  }) {
    this.name = name
    this.title = title
    this.description = description
    this.tags = tags
    this.models = models
    this.steps = steps.map((s) => (s instanceof WorkflowStep ? s : new WorkflowStep(s)))
    this.draftRequired = draftRequired
    this.mutationPlans = mutationPlans
  }
}

export class WorkflowRegistry {
  /**
   * @param {WorkflowDefinition[]} workflows
   */
  constructor(workflows = []) {
    this.workflows = new Map(workflows.map((w) => [w.name, w]))
    this._search = new SubstringSearch(this.getAllWorkflows())
  }

  /**
   * Initialize search over workflows
   * @param {string} [strategy='substring'] - Search strategy ('substring' | 'embedding')
   * @returns {Promise<void>}
   */
  async initSearch(strategy) {
    if (strategy) {
      this._search = createDomainSearch(strategy)
    }
    await this._search.initialize(
      this.getAllWorkflows(),
      (w) => `${w.name} ${w.title}: ${w.description} ${w.tags.join(' ')}`
    )
  }

  /**
   * Get a workflow by exact name
   * @param {string} name
   * @returns {WorkflowDefinition|undefined}
   */
  getWorkflow(name) {
    return this.workflows.get(name)
  }

  /**
   * Get all workflows
   * @returns {WorkflowDefinition[]}
   */
  getAllWorkflows() {
    return Array.from(this.workflows.values())
  }

  /**
   * Search workflows by goal/description
   *
   * Uses semantic search when initialized, falls back to substring matching.
   *
   * @param {string} query
   * @returns {Promise<WorkflowDefinition[]>}
   */
  async searchWorkflows(query) {
    return this._search.search(query)
  }

  /**
   * Get workflows by tag
   * @param {string} tag
   * @returns {WorkflowDefinition[]}
   */
  getWorkflowsByTag(tag) {
    return this.getAllWorkflows().filter((w) => w.tags.includes(tag))
  }

  /**
   * Get workflows involving a specific model
   * @param {string} model
   * @returns {WorkflowDefinition[]}
   */
  getWorkflowsByModel(model) {
    return this.getAllWorkflows().filter((w) => w.models.includes(model))
  }
}
