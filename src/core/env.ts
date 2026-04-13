/**
 * Environment Variable Utilities
 *
 * Thin helpers for validated env var access. Use these instead of
 * raw `process.env` reads to get clear error messages at startup.
 */

/**
 * Require an environment variable. Throws if missing or empty.
 */
export function requireEnv(name: string, context?: string): string {
  const value = process.env[name]
  if (!value) {
    const prefix = context ? `[${context}] ` : ''
    throw new Error(`${prefix}Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * Read an optional environment variable with a default.
 */
export function optionalEnv(name: string, defaultValue: string = ''): string {
  return process.env[name] || defaultValue
}

/**
 * Read an environment variable as an integer.
 */
export function intEnv(name: string, defaultValue: number): number {
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
 */
export function boolEnv(name: string, defaultValue: boolean = false): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultValue
  return raw === 'true' || raw === '1'
}
