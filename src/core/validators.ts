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
