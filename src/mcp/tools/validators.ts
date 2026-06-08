/**
 * Boot-time tool-input-schema validator. Request-time validators
 * (filters, nested resources) live on `DataLayer`.
 */

import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'

/**
 * Validate a tool's `inputSchema` field by running it through the SDK's
 * exact `tools/list` serialization pipeline. Catches schemas that would
 * crash the all-or-nothing `tools/list` response at registration time
 * rather than at first client request.
 */
export function validateToolInputSchema(toolName: string, inputSchema: unknown): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = normalizeObjectSchema(inputSchema as any)
    if (obj) {
      toJsonSchemaCompat(obj, { strictUnions: true })
    }
  } catch (err) {
    throw new Error(`Tool "${toolName}" has an invalid inputSchema: ${(err as Error).message}`, {
      cause: err
    })
  }
}
