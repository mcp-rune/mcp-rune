/**
 * domain-definitions — shared types for the domain module
 *
 * Pure TypeScript interfaces and types only — no runtime code.
 * Mirrors the role of model-definitions.ts (models) and prompt-definitions.ts (prompts).
 *
 * Runtime classes (DomainConcept, BusinessRule, WorkflowDefinition) import from here
 * instead of inlining their own interfaces.
 */

// ─── Business rules ──────────────────────────────────────────────────────────

export type RuleSeverity = 'error' | 'warning' | 'info'

export interface RuleResult {
  passed: boolean
  message: string
  details?: unknown
  suggestion?: string
}

export interface EvaluationResultItem {
  rule: string
  description: string
  passed: boolean
  message: string
  severity: RuleSeverity
  details?: unknown
  suggestion?: string
}

export interface EvaluationResult {
  passed: boolean
  results: EvaluationResultItem[]
}

export interface BusinessRuleConfig {
  name: string
  description: string
  scope: string[]
  severity?: RuleSeverity
  tags?: string[]
  evaluate: (data: Record<string, unknown>, context?: Record<string, unknown>) => RuleResult
}

// ─── Domain concepts ─────────────────────────────────────────────────────────

export interface DomainConceptConfig {
  name: string
  title: string
  description: string
  models: string[]
  tags?: string[]
  details?: Record<string, unknown>
}

/** Field-level metadata per model class — optional enrichment for getContextForModel */
export interface ModelClass {
  description?: string
  api?: { readOnly?: boolean }
  attributes?: Record<
    string,
    {
      label?: string
      type?: string
      required?: boolean
      immutable?: boolean
      description?: string
    }
  >
  associations?: Record<string, unknown>
}

export interface ModelContext {
  model: string
  concepts: Array<{
    name: string
    title: string
    description: string
    models: string[]
    details: Record<string, unknown>
  }>
  description?: string
  readOnly?: boolean
  attributes?: Array<{
    name: string
    label?: string
    type?: string
    required: boolean
    immutable: boolean
    description?: string
  }>
  associations?: Record<string, unknown>
  rules?: Array<{ name: string; description: string; severity: RuleSeverity }>
  workflows?: Array<{ name: string; title: string; description: string; tags: string[] }>
}

// ─── Workflows ───────────────────────────────────────────────────────────────

export interface DecisionOption {
  label: string
  description: string
  nextStep?: number
}

export interface Decision {
  question: string
  options: DecisionOption[]
}

export interface ChangesetConfig {
  mutating?: boolean
  requiresPlan?: string
}

export interface ContextHint {
  lifecycle?: string
  consumedBy?: string
}

export interface WorkflowStepConfig {
  order: number
  title: string
  description: string
  tool?: string
  toolArgs?: Record<string, unknown>
  decision?: Decision
  tips?: string[]
  parallelGroup?: string
  dependsOn?: number[]
  changeset?: ChangesetConfig
  optional?: boolean
  fallbackDescription?: string
  exhaustive?: boolean
  loopGroup?: string
  contextHint?: ContextHint
}

export interface MutationPlan {
  [key: string]: unknown
}

export interface WorkflowDefinitionConfig {
  name: string
  title: string
  description: string
  tags?: string[]
  models?: string[]
  steps?: WorkflowStepConfig[]
  draftRequired?: boolean
  mutationPlans?: MutationPlan
}

// ─── Module bundling ─────────────────────────────────────────────────────────

/**
 * DomainModule — groups concepts, rules, and workflows per domain area.
 *
 * This is the shape downstream servers write per domain area (catchup, deals,
 * rights, etc.) instead of creating separate explicit files per resource type.
 * Multiple modules are merged by InMemoryDomainAdapter.
 *
 * @example
 * export const catchupModule: DomainModule = {
 *   concepts:  catchupConcepts,
 *   rules:     catchupRules,
 *   workflows: catchupWorkflows,
 * }
 */
export interface DomainModule {
  concepts?: DomainConceptConfig[]
  rules?: BusinessRuleConfig[]
  workflows?: WorkflowDefinitionConfig[]
}
