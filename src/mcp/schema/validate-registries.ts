/**
 * Fail-fast schema validation entry point for models, forms, and prompts.
 *
 * The consuming server calls `validateRegistries({ models, forms, prompts })`
 * during boot (typically inside a `StartupTracker.phase()`). On any errors,
 * it throws `SchemaValidationError` with a structured report — the tracker
 * surfaces the error and the server refuses to start. This catches typos
 * like `type: 'datetimme'` or missing `enumValues` before they reach the
 * UI as a silent text-input fallback.
 *
 * Pure functions only — no I/O, no logger calls. Errors and warnings are
 * returned as data structures; the caller decides how to render them.
 */

import type { FormClassLike } from '#src/mcp/apps/lib/form-validator.js'
import { validateFormClass } from '#src/mcp/apps/lib/form-validator.js'
import { validateModelClass } from '#src/mcp/model-layer/model-validator.js'
import type { PromptClassLike } from '#src/mcp/prompts/prompt-validator.js'
import { validatePromptClass } from '#src/mcp/prompts/prompt-validator.js'

import type { Issue, ModelClassLike, ValidationReport } from './types.js'

export interface RegistriesInput {
  /** Plain map of model name → ModelClass, matching how deployers export MODEL_CLASSES. */
  models: Record<string, ModelClassLike>
  /** Optional map of model name → FormClass. */
  forms?: Record<string, FormClassLike>
  /** Optional map of model name → PromptClass. */
  prompts?: Record<string, PromptClassLike>
}

/**
 * Run every available check across the registries and return a
 * `{ errors, warnings }` report. Does NOT throw — callers decide the
 * policy (e.g. throw on errors, log warnings).
 */
export function validateRegistries(input: RegistriesInput): ValidationReport {
  const errors: Issue[] = []
  const warnings: Issue[] = []

  const modelNames = Object.keys(input.models)

  for (const [name, ModelClass] of Object.entries(input.models)) {
    push(validateModelClass(name, ModelClass, modelNames), errors, warnings)
  }

  if (input.forms) {
    for (const [modelName, FormClass] of Object.entries(input.forms)) {
      const ModelClass = input.models[modelName]
      if (!ModelClass) {
        errors.push({
          level: 'error',
          scope: 'form',
          model: modelName,
          message: `FormClass for "${modelName}" references a model that is not in MODEL_CLASSES.`,
          hint: `Known models: ${modelNames.join(', ')}`
        })
        continue
      }
      push(validateFormClass(modelName, FormClass, ModelClass), errors, warnings)
    }
  }

  if (input.prompts) {
    for (const [modelName, PromptClass] of Object.entries(input.prompts)) {
      const ModelClass = input.models[modelName]
      if (!ModelClass) continue // already reported via forms or models
      push(validatePromptClass(modelName, PromptClass, ModelClass), errors, warnings)
    }
  }

  return { errors, warnings }
}

function push(issues: Issue[], errors: Issue[], warnings: Issue[]): void {
  for (const i of issues) {
    if (i.level === 'error') errors.push(i)
    else warnings.push(i)
  }
}
