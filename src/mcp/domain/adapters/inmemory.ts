/**
 * InMemoryDomainAdapter — in-process domain knowledge storage
 *
 * Wraps DomainKnowledge, RuleSet, and WorkflowRegistry. No behaviour change
 * from the pre-adapter API; the classes remain as the internal implementation.
 *
 * Accepts DomainModule | DomainModule[] — multiple modules are merged so
 * downstream servers can organise knowledge by domain area (catchup, deals,
 * rights, …) without a flat global array.
 */

import { RuleSet } from '../business-rules.js'
import { BusinessRule } from '../business-rules.js'
import type { DomainModule } from '../domain-definitions.js'
import { DomainKnowledge } from '../knowledge.js'
import { DomainConcept } from '../knowledge.js'
import { WorkflowRegistry } from '../workflows.js'
import { WorkflowDefinition } from '../workflows.js'
import type { DomainAdapter } from './base-adapter.js'

export class InMemoryDomainAdapter implements DomainAdapter {
  private _knowledge: DomainKnowledge
  private _rules: RuleSet
  private _workflows: WorkflowRegistry

  constructor(modules: DomainModule | DomainModule[]) {
    const list = Array.isArray(modules) ? modules : [modules]

    const concepts = list.flatMap((m) =>
      (m.concepts ?? []).map((c) => (c instanceof DomainConcept ? c : new DomainConcept(c)))
    )
    const rules = list.flatMap((m) =>
      (m.rules ?? []).map((r) => (r instanceof BusinessRule ? r : new BusinessRule(r)))
    )
    const workflows = list.flatMap((m) =>
      (m.workflows ?? []).map((w) =>
        w instanceof WorkflowDefinition ? w : new WorkflowDefinition(w)
      )
    )

    this._knowledge = new DomainKnowledge({ concepts })
    this._rules = new RuleSet(rules)
    this._workflows = new WorkflowRegistry(workflows)
  }

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async initSearch(strategy?: string): Promise<void> {
    await Promise.all([this._knowledge.initSearch(strategy), this._workflows.initSearch(strategy)])
  }

  // Concepts

  async getConcept(name: string) {
    return this._knowledge.getConcept(name)
  }

  async getAllConcepts() {
    return this._knowledge.getAllConcepts()
  }

  async searchConcepts(query: string) {
    return this._knowledge.searchConcepts(query)
  }

  async getConceptsForModel(modelName: string) {
    return this._knowledge.getConceptsForModel(modelName)
  }

  // Rules

  async getRulesForModel(model: string) {
    return this._rules.getRulesForModel(model)
  }

  async describeRules(model: string) {
    return this._rules.describeRules(model)
  }

  async evaluateRules(
    model: string,
    data: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ) {
    return this._rules.evaluate(model, data, context)
  }

  // Workflows

  async getWorkflow(name: string) {
    return this._workflows.getWorkflow(name)
  }

  async getAllWorkflows() {
    return this._workflows.getAllWorkflows()
  }

  async searchWorkflows(query: string) {
    return this._workflows.searchWorkflows(query)
  }

  async getWorkflowsByModel(model: string) {
    return this._workflows.getWorkflowsByModel(model)
  }

  async getWorkflowsByTag(tag: string) {
    return this._workflows.getWorkflowsByTag(tag)
  }
}
