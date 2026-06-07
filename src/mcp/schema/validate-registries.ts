/**
 * Two-tier schema validation for model, form, and prompt registries.
 *
 * Tier 1 — cross-registry binding: every form and prompt must reference a
 * model key that exists in MODEL_CLASSES. This check lives here because no
 * single registry can see across its siblings.
 *
 * Tier 2 — intra-class structure: field names, group keys, and type
 * references within each model, form, or prompt class. Delegated to the
 * per-layer validators (validateModelClass, validateAppForm,
 * validatePromptClass), which receive a resolved ModelClass only after
 * Tier 1 confirms the binding is valid.
 *
 * Pure functions only — no I/O, no logger calls. Errors and warnings are
 * returned as data structures; the caller decides how to render them.
 */

import type { AppFormClassLike } from '#src/mcp/apps/lib/app-form-validator.js'
import { validateAppForm } from '#src/mcp/apps/lib/app-form-validator.js'
import { validateModelClass } from '#src/mcp/model-layer/model-validator.js'
import type { PromptClassLike } from '#src/mcp/prompt-layer/prompt-validator.js'
import { validatePromptClass } from '#src/mcp/prompt-layer/prompt-validator.js'

import type { Issue, ModelClassLike, ValidationReport } from './types.js'

export interface RegistriesInput {
  /** Plain map of model name → ModelClass, matching how deployers export MODEL_CLASSES. */
  models: Record<string, ModelClassLike>
  /** Optional map of model name → FormClass. */
  forms?: Record<string, AppFormClassLike>
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

  if (input.forms) validateBoundForms(input.forms, input.models, modelNames, errors, warnings)
  if (input.prompts) validateBoundPrompts(input.prompts, input.models, errors, warnings)

  return { errors, warnings }
}

function validateBoundForms(
  forms: Record<string, AppFormClassLike>,
  models: Record<string, ModelClassLike>,
  modelNames: string[],
  errors: Issue[],
  warnings: Issue[]
): void {
  for (const [modelName, FormClass] of Object.entries(forms)) {
    const ModelClass = models[modelName]
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
    push(validateAppForm(modelName, FormClass, ModelClass), errors, warnings)
  }
}

function validateBoundPrompts(
  prompts: Record<string, PromptClassLike>,
  models: Record<string, ModelClassLike>,
  errors: Issue[],
  warnings: Issue[]
): void {
  for (const [modelName, PromptClass] of Object.entries(prompts)) {
    const ModelClass = models[modelName]
    if (!ModelClass) continue
    push(validatePromptClass(modelName, PromptClass, ModelClass), errors, warnings)
  }
}

function push(issues: Issue[], errors: Issue[], warnings: Issue[]): void {
  for (const i of issues) {
    if (i.level === 'error') errors.push(i)
    else warnings.push(i)
  }
}
