/**
 * Environment Variable Utilities
 *
 * Thin helpers for validated env var access. Use these instead of
 * raw `process.env` reads to get clear error messages at startup.
 */

/**
 * Require an environment variable. Throws if missing or empty.
 *
 * @param {string} name - Environment variable name
 * @param {string} [context] - Context for error message (e.g., 'OAuth')
 * @returns {string} The environment variable value
 * @throws {Error} If the variable is not set or empty
 */
export function requireEnv(name, context) {
  const value = process.env[name]
  if (!value) {
    const prefix = context ? `[${context}] ` : ''
    throw new Error(`${prefix}Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * Read an optional environment variable with a default.
 *
 * @param {string} name - Environment variable name
 * @param {string} [defaultValue=''] - Default value if not set
 * @returns {string} The environment variable value or default
 */
export function optionalEnv(name, defaultValue = '') {
  return process.env[name] || defaultValue
}

/**
 * Read an environment variable as an integer.
 *
 * @param {string} name - Environment variable name
 * @param {number} defaultValue - Default value if not set
 * @returns {number} The parsed integer value
 * @throws {Error} If the value is set but not a valid integer
 */
export function intEnv(name, defaultValue) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultValue
  const parsed = parseInt(raw, 10)
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: "${raw}"`)
  }
  return parsed
}

/**
 * Read an environment variable as a boolean.
 * Recognizes 'true' and '1' as true, everything else as false.
 *
 * @param {string} name - Environment variable name
 * @param {boolean} [defaultValue=false] - Default value if not set
 * @returns {boolean}
 */
export function boolEnv(name, defaultValue = false) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultValue
  return raw === 'true' || raw === '1'
}
