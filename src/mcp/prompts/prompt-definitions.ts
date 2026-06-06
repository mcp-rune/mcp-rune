/**
 * Prompt definitions — the type vocabulary describing what a prompt IS.
 *
 * Mirrors the role of `src/mcp/models/attribute-definition.ts` for models:
 * holds the interfaces consumed by `BasePrompt`, strategies, generators,
 * `PromptContentBuilder`, and the registry. Definition lives here; the
 * `BasePrompt` class and `PromptContentBuilder` are consumers.
 */

import type { CompletionConfig } from '#src/mcp/models/attribute-definition.js'

import type { ExtractionExample } from './generators/helpers.js'

export type StrategyType = 'stateless' | 'hybrid' | 'stateful'

export interface Section {
  title: string
  description: string
  required: boolean
  groups: string[]
  askPrompt?: string
  content?: {
    preamble?: string
    intro?: string
    notes?: string[]
  }
}

export interface FieldGroup {
  fields: string[]
  required?: boolean
  context?: string
  description?: string
  conditional?: Record<string, unknown>
  dependencies?: string[]
  askPrompt?: string
  validateSection?: (...args: unknown[]) => unknown
  extractionExamples?: ExtractionExample[]
  content?: {
    intro?: string
    notes?: string[]
  }
}

export interface FieldValidation {
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: RegExp
  patternMessage?: string
  [key: string]: unknown
}

export interface PromptFieldDefinition {
  type: string
  required: boolean
  description: string
  label?: string
  enumValues?: string[]
  enumDescriptions?: Record<string, string>
  format?: string
  default?: unknown
  examples?: string[]
  validation?: FieldValidation
  validate?: (
    value: unknown,
    allFields: Record<string, unknown>,
    context: Record<string, unknown>
  ) => string | null | undefined
  completion?: CompletionConfig
  prompt_visible?: boolean
  conditional?: boolean
  immutable?: boolean
}

export interface PromptContent {
  type: string
  text: string
}

export interface FormSchemaFieldDefinition {
  type: string
  required: boolean
  description: string
  label?: string
  examples?: string[]
  enumValues?: string[]
  format?: string
  default?: unknown
  completion?: CompletionConfig
  validation?: Record<string, unknown>
}

export interface FormSchema {
  name: string
  title: string
  description: string
  modelName: string | null
  strategy: string
  fieldDefinitions: Record<string, FormSchemaFieldDefinition>
  fieldGroups: Record<string, FieldGroup>
  sections: Record<string, Section>
  defaults: Record<string, unknown>
}

/**
 * Structural interface describing the static shape of a BasePrompt subclass.
 * Consumed by generator functions that receive `{ promptClass: ... }` context.
 */
export interface PromptClassLike {
  strategy: StrategyType
  sections: Record<string, Section>
  fieldGroups: Record<string, FieldGroup>
  fieldDefinitions: Record<string, PromptFieldDefinition>
  name?: string
  title?: string
  description?: string
  modelName?: string
}
