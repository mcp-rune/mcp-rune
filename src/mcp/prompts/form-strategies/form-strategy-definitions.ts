/**
 * Type definitions for form-strategies.
 *
 * Mirrors the prompts/prompt-definitions.ts pattern: behavior files
 * (base-form-strategy.ts, hybrid-form-strategy.ts, stateful-form-strategy.ts)
 * hold only the class; shared structural types live here so strategies can
 * extend each other's contracts without importing across behavior files.
 */

import type { FieldGroup, PromptFieldDefinition, Section } from '../prompt-definitions.js'

/** Context object threaded through field-level validation callbacks. */
export interface ValidationContext {
  field?: string
  [key: string]: unknown
}

/** A single field-level validation error. */
export interface ValidationError {
  field: string
  message: string
}

/** Result returned by `HybridFormStrategy.validateFields` and stateful equivalents. */
export interface ValidationResult {
  valid: boolean
  ready_to_submit: boolean
  errors: ValidationError[]
  warnings: string[]
  computed: Record<string, unknown>
  fields: Record<string, unknown>
}

/** Machine-readable companion to the human summary. */
export interface TechnicalSummary {
  model: string
  parent_path: string | undefined
  attributes: Record<string, unknown>
}

/** Result returned by `HybridFormStrategy.generateSummary` and stateful equivalents. */
export interface SummaryResult {
  human: string
  technical: TechnicalSummary
  progress?: unknown
}

/**
 * Narrow structural shape of a prompt class as seen by `HybridFormStrategy`.
 * A subset of the global `PromptClassLike` from `prompt-definitions.ts`
 * containing only what hybrid validation needs.
 */
export interface HybridPromptClass {
  fieldDefinitions?: Record<string, PromptFieldDefinition>
  fieldGroups?: Record<string, FieldGroup>
  crossSectionValidation?: (
    fields: Record<string, unknown>,
    errors: ValidationError[],
    warnings: string[]
  ) => void
  getSectionForGroup?: (groupName: string) => { title: string } | null
}

/** Outcome of validating a single section in `StatefulFormStrategy`. */
export interface SectionValidationResult {
  section: string
  valid: boolean
  errors?: ValidationError[]
  warnings?: string[]
  error?: string
  available_sections?: string[]
  skipped?: boolean
  reason?: string
  next_section?: string | null
  section_complete?: boolean
}

/** Per-section progress entry returned by `StatefulFormStrategy.getProgress`. */
export interface SectionProgress {
  applicable: boolean
  reason?: string
  total_fields?: number
  filled_fields?: number
  complete?: boolean
  partial?: boolean
  required?: boolean
  title?: string
}

/** Aggregate progress across all sections. */
export interface ProgressResult {
  sections: Record<string, SectionProgress>
  overall: {
    total_sections: number
    completed_sections: number
    required_complete: boolean
    percentage?: number
  }
}

/** Validation result extended with section progress, for stateful flows. */
export interface StatefulValidationResult extends ValidationResult {
  progress: ProgressResult
}

/** Summary result extended with section progress, for stateful flows. */
export interface StatefulSummaryResult extends SummaryResult {
  progress: ProgressResult
}

/** Section metadata surfaced by `StatefulFormStrategy.getSections`. */
export interface SectionMetadata {
  name: string
  title: string
  required: boolean
  conditional: Record<string, unknown> | null
  fields: string[]
  groups: string[]
  description?: string
}

/**
 * Renderer for the human and technical halves of a form summary. The default
 * implementation lives in `default-form-summary-renderer.ts`. Deployers can
 * supply their own via `ToolRegistry({ summaryRenderer })` to customize the
 * markdown layout, API-payload shape, i18n, or alternate output formats
 * without subclassing the strategy.
 */
export interface FormSummaryRenderer {
  renderHuman(promptClass: HybridPromptClass, fields: Record<string, unknown>): string
  renderTechnical(
    promptClass: HybridPromptClass,
    fields: Record<string, unknown>,
    context: Record<string, unknown>
  ): TechnicalSummary
}

/**
 * Narrow structural shape of a prompt class as seen by `StatefulFormStrategy`.
 * Extends `HybridPromptClass` with section-aware fields.
 */
export interface StatefulPromptClass {
  fieldDefinitions?: Record<string, PromptFieldDefinition>
  fieldGroups?: Record<string, FieldGroup>
  sections?: Record<string, Section>
  crossSectionValidation?: (
    fields: Record<string, unknown>,
    errors: ValidationError[],
    warnings: string[]
  ) => void
  getSectionForGroup?: (groupName: string) => { title: string } | null
}
