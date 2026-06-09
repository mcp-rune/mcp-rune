/**
 * WorkflowDefinition + WorkflowRegistry - Multi-step process orchestration
 *
 * Structured workflows spanning multiple entities. Each workflow
 * has ordered steps with tool calls, decision points, and tips.
 * Tagged for filtering (e.g., 'demo', 'onboarding').
 */

import type {
  ChangesetConfig,
  ContextHint,
  Decision,
  DecisionOption,
  MutationPlan,
  WorkflowDefinitionConfig,
  WorkflowStepConfig
} from './domain-definitions.js'
import type { DomainItem, DomainSearchStrategy } from './search-strategy.js'
import { createDomainSearch, SubstringSearch } from './search-strategy.js'

export type {
  ChangesetConfig,
  ContextHint,
  Decision,
  DecisionOption,
  MutationPlan,
  WorkflowDefinitionConfig,
  WorkflowStepConfig
}

export class WorkflowStep {
  order: number
  title: string
  description: string
  tool?: string
  toolArgs?: Record<string, unknown>
  decision?: Decision
  tips: string[]
  parallelGroup?: string
  dependsOn?: number[]
  changeset: ChangesetConfig | null
  optional: boolean
  fallbackDescription: string | null
  exhaustive: boolean
  loopGroup: string | null
  contextHint: ContextHint | null

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
  }: WorkflowStepConfig) {
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
  name: string
  title: string
  description: string
  tags: string[]
  models: string[]
  steps: WorkflowStep[]
  draftRequired?: boolean
  mutationPlans?: MutationPlan

  constructor({
    name,
    title,
    description,
    tags = [],
    models = [],
    steps = [],
    draftRequired,
    mutationPlans
  }: WorkflowDefinitionConfig) {
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
  workflows: Map<string, WorkflowDefinition>
  private _search: DomainSearchStrategy

  constructor(workflows: WorkflowDefinition[] = []) {
    this.workflows = new Map(workflows.map((w) => [w.name, w]))
    this._search = new SubstringSearch(this.getAllWorkflows() as unknown as DomainItem[])
  }

  /** Initialize search over workflows */
  async initSearch(strategy?: string): Promise<void> {
    if (strategy) {
      this._search = createDomainSearch(strategy)
    }
    await this._search.initialize(
      this.getAllWorkflows() as unknown as DomainItem[],
      (w) => `${w.name} ${w.title}: ${w.description} ${(w.tags ?? []).join(' ')}`
    )
  }

  /** Get a workflow by exact name */
  getWorkflow(name: string): WorkflowDefinition | undefined {
    return this.workflows.get(name)
  }

  /** Get all workflows */
  getAllWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values())
  }

  /**
   * Search workflows by goal/description
   *
   * Uses semantic search when initialized, falls back to substring matching.
   */
  async searchWorkflows(query: string): Promise<WorkflowDefinition[]> {
    return this._search.search(query) as unknown as Promise<WorkflowDefinition[]>
  }

  /** Get workflows by tag */
  getWorkflowsByTag(tag: string): WorkflowDefinition[] {
    return this.getAllWorkflows().filter((w) => w.tags.includes(tag))
  }

  /** Get workflows involving a specific model */
  getWorkflowsByModel(model: string): WorkflowDefinition[] {
    return this.getAllWorkflows().filter((w) => w.models.includes(model))
  }
}
