import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export type { CallToolResult as ToolResult } from '@modelcontextprotocol/sdk/types.js'

export function textResult(text: string, meta?: Record<string, unknown>): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text', text }] }
  if (meta) result._meta = meta
  return result
}

export function textError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}
