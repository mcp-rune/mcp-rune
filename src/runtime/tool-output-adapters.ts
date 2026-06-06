/**
 * Tool Output Adapters - Generic Adapter Registry
 *
 * Normalizes raw tool responses into compact JSONB before storage.
 * Domain-specific adapters are registered by each server (e.g., src/mod/tools/output-adapters.js).
 *
 * @example
 * import { adaptToolOutput } from '#src/runtime/tool-output-adapters.js'
 *
 * const output = adaptToolOutput('create_model', response, { model: 'deal' })
 * // => { id: '123', name: 'BBC Drama', right_type: 'catchup', status: 'draft' }
 */

export type OutputAdapter = (
  rawOutput: Record<string, unknown>,
  toolArgs: Record<string, unknown>
) => Record<string, unknown> | null

const adapters = new Map<string, OutputAdapter>()

/**
 * Adapt a raw tool response into a compact output object
 *
 * Returns null when no adapter is registered, the response is falsy,
 * or the adapter throws. Never crashes the fire-and-forget flow.
 */
export function adaptToolOutput(
  toolName: string,
  rawOutput: Record<string, unknown> | null | undefined,
  toolArgs: Record<string, unknown> = {}
): Record<string, unknown> | null {
  if (!rawOutput) return null
  const adapter = adapters.get(toolName)
  if (!adapter) return null
  try {
    return adapter(rawOutput, toolArgs)
  } catch {
    return null
  }
}

/** Register an output adapter for a tool */
export function registerOutputAdapter(toolName: string, adapter: OutputAdapter): void {
  adapters.set(toolName, adapter)
}

/**
 * Factory that creates an adapter extracting named fields from a response
 */
export function pickFields(fields: string[]): OutputAdapter {
  return (response: Record<string, unknown>) => {
    if (!response || typeof response !== 'object') return null
    const output: Record<string, unknown> = {}
    for (const field of fields) {
      if (response[field] !== undefined) output[field] = response[field]
    }
    return Object.keys(output).length > 0 ? output : null
  }
}
