/**
 * Value Validators — the per-value checks driven by `required:`, `enumValues:`,
 * and `format:` on a model's `static attributes`.
 *
 *   class Book extends BaseModel {
 *     static attributes = {
 *       title:  { type: 'string', required: true },                              // ← validateRequired
 *       genre:  { type: 'enum',   enumValues: ['fiction', 'non-fiction'] },      // ← validateEnum
 *       link:   { type: 'url' }                                                  // ← validateUrl
 *     }
 *   }
 *
 * Each function takes a value (or a record + spec) and returns a small
 * `{ valid, missing | error }` result. They're the primitives that
 * higher-level whole-record validators compose; `modelLayer.validate(attrs)`
 * after PR2 will wrap them so callers don't reach in here directly.
 */

export interface ValidationResult {
  valid: boolean
  missing: string[]
}

export interface ModelValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validate required fields are present.
 */
export function validateRequired(
  params: Record<string, unknown>,
  required: string[]
): ValidationResult {
  const missing = required.filter((field) => {
    const value = params[field]
    return value === undefined || value === null || value === ''
  })
  return {
    valid: missing.length === 0,
    missing
  }
}

/**
 * Validate a value is one of allowed enum values.
 */
export function validateEnum(value: string, allowed: string[]): boolean {
  return allowed.includes(value)
}

/**
 * Validate a value is a positive integer.
 */
export function validatePositiveInt(value: unknown): boolean {
  const num = parseInt(String(value), 10)
  return !isNaN(num) && num > 0
}

/**
 * Validate a value is a valid URL.
 */
export function validateUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

/**
 * Validate model name exists in config.
 */
export function validateModel(
  model: string,
  modelsConfig: Record<string, unknown>
): ModelValidationResult {
  if (!model) {
    return { valid: false, error: 'Model name is required' }
  }
  if (!modelsConfig[model]) {
    const available = Object.keys(modelsConfig).join(', ')
    return { valid: false, error: `Unknown model: ${model}. Available: ${available}` }
  }
  return { valid: true }
}
