/**
 * HybridFormStrategy — docs + one validation pass before submit.
 *
 * Adds a single server-side validation step to the stateless flow. The LLM
 * gathers every field, calls `validate_form` once with all fields, and
 * receives back errors, warnings, computed defaults, and a
 * `ready_to_submit` flag. If `ready_to_submit: true`, the LLM proceeds to
 * `create_model`; otherwise it fixes errors and re-validates.
 *
 * Best for prompts in the ~10–20-field range, with some conditionals, where
 * you want a safety net before `create_model` but don't need
 * section-by-section progress.
 *
 * ## Configure on a Prompt class
 *
 *     export class ProjectPrompt extends BasePrompt {
 *       static formStrategy = 'hybrid'
 *
 *       static fieldDefinitions = {
 *         name: { type: 'string', required: true, description: 'Project name' },
 *         description: { type: 'text', description: 'What this project is for' },
 *         status: {
 *           type: 'enum',
 *           enumValues: ['active', 'archived'],
 *           default: 'active'
 *         }
 *       }
 *
 *       // Optional: groups bucket fields for the human summary's layout.
 *       static fieldGroups = {
 *         identity: { fields: ['name', 'description'], context: 'Identity', required: true },
 *         lifecycle: { fields: ['status'], context: 'Lifecycle', required: false }
 *       }
 *
 *       // Optional: cross-field rules that can't be expressed per-field.
 *       static crossSectionValidation(fields, errors, warnings) {
 *         // Push into errors / warnings as needed.
 *       }
 *
 *       get promptContent() {
 *         return PromptContentBuilder.for(ProjectPrompt, 'project').standard().build()
 *       }
 *     }
 *
 * ## MCP tools activated
 *
 * | Tool                | Behavior                                                            |
 * | ------------------- | ------------------------------------------------------------------- |
 * | `get_prompt_guide`  | Returns `promptContent`                                             |
 * | `validate_form`     | Validates all fields; returns errors + computed + `ready_to_submit` |
 * | `get_form_summary`  | Human (markdown) + technical (payload) via the injected renderer    |
 * | `get_form_progress` | Not supported                                                       |
 *
 * The LLM is expected to call `validate_form` exactly once after gathering
 * fields, before calling `create_model`. The prompt's `promptContent` must
 * tell it to do so — nothing invokes `validate_form` automatically.
 *
 * ## State
 *
 * None on the server. Each `validate_form` call is independent; the LLM
 * passes the full field set every time. The server applies defaults and
 * returns them in `computed` so the LLM can adopt them on `create_model`.
 *
 * ## Customizing the summary
 *
 * The human and technical summary halves are produced by a
 * `FormSummaryRenderer` injected via `ToolRegistry({ summaryRenderer })`.
 * The default `DefaultFormSummaryRenderer` emits markdown for the human
 * half and a JSON-API-ish payload for the technical half. To customize the
 * format (i18n, alternate markup, custom technical envelope), implement
 * `FormSummaryRenderer` and pass an instance to the registry — no
 * subclassing required.
 *
 * Flow:
 *
 *     get_prompt_guide → LLM gathers fields → validate_form →
 *     get_form_summary (optional) → create_model
 */

import * as logger from '#src/runtime/logger.js'

import { BaseFormStrategy } from './base-form-strategy.js'
import { defaultFormSummaryRenderer } from './default-form-summary-renderer.js'
import type {
  FormSummaryRenderer,
  FormValidationResult,
  HybridPromptClass,
  SummaryResult,
  ValidationError
} from './form-strategy-definitions.js'

const log = logger.child({ service: 'form-strategy', formStrategy: 'hybrid' })

export class HybridFormStrategy extends BaseFormStrategy {
  static override type = 'hybrid'

  static override getSupportedOperations(): string[] {
    return ['getDocumentation', 'validateFields', 'generateSummary']
  }

  /** Get documentation for the prompt */
  static override getDocumentation(promptInstance: {
    promptContent: string
    constructor: { name: string }
  }): string {
    return promptInstance.promptContent
  }

  /** Validate all fields at once */
  static validateFields(
    promptClass: HybridPromptClass,
    fields: Record<string, unknown>,
    _context: Record<string, unknown> = {}
  ): FormValidationResult {
    const fieldDefs = promptClass.fieldDefinitions || {}
    log.debug('validateFields called', {
      fieldCount: Object.keys(fields).length,
      definedFieldCount: Object.keys(fieldDefs).length
    })

    const errors: ValidationError[] = []
    const warnings: string[] = []
    const computed: Record<string, unknown> = {}

    // 1. Check required fields
    for (const [name, def] of Object.entries(fieldDefs)) {
      if (def.required && (fields[name] === undefined || fields[name] === '')) {
        errors.push({
          field: name,
          message: `${def.description || name} is required`
        })
      }
    }

    // 2. Validate each field (enum, type, range, pattern, custom)
    for (const [name, value] of Object.entries(fields)) {
      const def = fieldDefs[name]
      const fieldErrors = this.validateField(name, value, def, fields)
      for (const message of fieldErrors) {
        errors.push({ field: name, message })
      }
    }

    // 3. Cross-section validation (form-level)
    if (
      promptClass.crossSectionValidation &&
      typeof promptClass.crossSectionValidation === 'function'
    ) {
      try {
        promptClass.crossSectionValidation(fields, errors, warnings)
      } catch (err) {
        log.error('Cross-section validator threw error', {
          error: (err as Error).message
        })
      }
    }

    // 4. Apply defaults for missing optional fields
    for (const [name, def] of Object.entries(fieldDefs)) {
      if (fields[name] === undefined && def.default !== undefined) {
        computed[name] = def.default
        warnings.push(`Using default for ${name}: ${def.default}`)
      }
    }

    // 5. Check if ready to submit (all required fields present)
    const requiredFields = Object.entries(fieldDefs)
      .filter(([, def]) => def.required)
      .map(([name]) => name)

    const readyToSubmit =
      errors.length === 0 &&
      requiredFields.every((f) => fields[f] !== undefined && fields[f] !== '')

    log.debug('validateFields complete', {
      valid: errors.length === 0,
      readyToSubmit,
      errorCount: errors.length,
      warningCount: warnings.length,
      computedCount: Object.keys(computed).length
    })

    return {
      valid: errors.length === 0,
      ready_to_submit: readyToSubmit,
      errors,
      warnings,
      computed,
      fields: { ...computed, ...fields }
    }
  }

  /**
   * Build a summary by delegating to the injected renderer. The strategy owns
   * "which prompt + fields are summarizable"; the renderer owns "how to format
   * them." Defaults to `defaultFormSummaryRenderer` for callers that don't
   * thread one through.
   */
  static generateSummary(
    promptClass: HybridPromptClass,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {},
    renderer: FormSummaryRenderer = defaultFormSummaryRenderer
  ): SummaryResult {
    const human = renderer.renderHuman(promptClass, fields)
    const technical = renderer.renderTechnical(promptClass, fields, context)

    log.debug('generateSummary complete', {
      humanSummaryLength: human?.length || 0,
      technicalAttributeCount: Object.keys(technical?.attributes || {}).length
    })

    return { human, technical }
  }

  static getDescription(): string {
    return `Hybrid Strategy: Documentation + validation before submit.
- LLM receives guidance documentation
- Server validates all fields before submission
- Errors and warnings returned together
- Defaults applied for missing optional fields
- Best for medium complexity forms`
  }
}
