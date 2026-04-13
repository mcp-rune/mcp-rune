/**
 * Validate required fields are present
 * @param {Object} params - Parameters to validate
 * @param {string[]} required - Required field names
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateRequired(params, required) {
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
 * Validate a value is one of allowed enum values
 * @param {string} value - Value to validate
 * @param {string[]} allowed - Allowed values
 * @returns {boolean}
 */
export function validateEnum(value, allowed) {
  return allowed.includes(value)
}

/**
 * Validate a value is a positive integer
 * @param {any} value - Value to validate
 * @returns {boolean}
 */
export function validatePositiveInt(value) {
  const num = parseInt(value, 10)
  return !isNaN(num) && num > 0
}

/**
 * Validate a value is a valid URL
 * @param {string} value - Value to validate
 * @returns {boolean}
 */
export function validateUrl(value) {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

/**
 * Validate model name exists in config
 * @param {string} model - Model name
 * @param {Object} modelsConfig - Models configuration
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateModel(model, modelsConfig) {
  if (!model) {
    return { valid: false, error: 'Model name is required' }
  }
  if (!modelsConfig[model]) {
    const available = Object.keys(modelsConfig).join(', ')
    return { valid: false, error: `Unknown model: ${model}. Available: ${available}` }
  }
  return { valid: true }
}
