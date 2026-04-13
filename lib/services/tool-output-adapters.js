/**
 * Tool Output Adapters - Generic Adapter Registry
 *
 * Normalizes raw tool responses into compact JSONB before storage.
 * Domain-specific adapters are registered by each server (e.g., src/mod/tools/output-adapters.js).
 *
 * @example
 * import { adaptToolOutput } from '#lib/services/tool-output-adapters.js'
 *
 * const output = adaptToolOutput('create_model', response, { model: 'deal' })
 * // => { id: '123', name: 'BBC Drama', right_type: 'catchup', status: 'draft' }
 */

const adapters = new Map()

/**
 * Adapt a raw tool response into a compact output object
 *
 * Returns null when no adapter is registered, the response is falsy,
 * or the adapter throws. Never crashes the fire-and-forget flow.
 *
 * @param {string} toolName - Tool name (e.g., 'create_model')
 * @param {Object} rawOutput - Raw API response
 * @param {Object} [toolArgs] - Tool arguments (passed to adapter for context)
 * @returns {Object|null} Compact output or null
 */
export function adaptToolOutput(toolName, rawOutput, toolArgs = {}) {
  if (!rawOutput) return null
  const adapter = adapters.get(toolName)
  if (!adapter) return null
  try {
    return adapter(rawOutput, toolArgs)
  } catch {
    return null
  }
}

/**
 * Register an output adapter for a tool
 *
 * @param {string} toolName - Tool name
 * @param {Function} adapter - Adapter function: (rawOutput, toolArgs) => Object|null
 */
export function registerOutputAdapter(toolName, adapter) {
  adapters.set(toolName, adapter)
}

/**
 * Factory that creates an adapter extracting named fields from a response
 *
 * @param {string[]} fields - Field names to extract
 * @returns {Function} Adapter function: (response) => Object|null
 */
export function pickFields(fields) {
  return (response) => {
    if (!response || typeof response !== 'object') return null
    const output = {}
    for (const field of fields) {
      if (response[field] !== undefined) output[field] = response[field]
    }
    return Object.keys(output).length > 0 ? output : null
  }
}
