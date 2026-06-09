// mcp-rune/domain — workflows, knowledge, business rules, domain adapter
export type { DomainAdapter } from './mcp/domain/adapters/base-adapter.js'
export { InMemoryDomainAdapter } from './mcp/domain/adapters/inmemory.js'
export { BusinessRule, RuleSet } from './mcp/domain/business-rules.js'
export type {
  BusinessRuleConfig,
  ChangesetConfig,
  ContextHint,
  Decision,
  DecisionOption,
  DomainConceptConfig,
  DomainModule,
  EvaluationResult,
  EvaluationResultItem,
  ModelClass,
  ModelContext,
  MutationPlan,
  RuleResult,
  RuleSeverity,
  WorkflowDefinitionConfig,
  WorkflowStepConfig
} from './mcp/domain/domain-definitions.js'
export { DomainConcept, DomainKnowledge } from './mcp/domain/knowledge.js'
export { DomainRegistry } from './mcp/domain/registry.js'
export { SemanticSearch } from './mcp/domain/semantic-search.js'
export { WorkflowDefinition, WorkflowRegistry, WorkflowStep } from './mcp/domain/workflows.js'
