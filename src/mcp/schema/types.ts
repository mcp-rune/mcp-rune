/**
 * Shared issue / report types used by every per-kind validator
 * (model, form, prompt). Validators return arrays of `Issue`; the
 * orchestrator (`validateRegistries`) aggregates them into a
 * `ValidationReport`.
 *
 * Also exports the minimal structural shape (`ModelClassLike`) shared
 * by every validator that needs to look at a model — keeping this
 * decoupled from the concrete `BaseModel` type lets the validators
 * work on raw JS classes without a full TS bridge.
 */

import type { AttributeDefinition } from '#src/mcp/models/model-definitions.js'

export type IssueLevel = 'error' | 'warning'
export type IssueScope = 'model' | 'attribute' | 'association' | 'form' | 'prompt'

export interface Issue {
  level: IssueLevel
  scope: IssueScope
  model: string
  attribute?: string
  message: string
  hint?: string
}

export interface ValidationReport {
  errors: Issue[]
  warnings: Issue[]
}

export interface ModelClassLike {
  modelName?: string
  api?: { endpoint?: string }
  attributes?: Record<string, AttributeDefinition>
  associations?: {
    belongsTo?: Record<string, { target_model?: string }>
    hasMany?: Record<string, { target_model?: string }>
  }
}
