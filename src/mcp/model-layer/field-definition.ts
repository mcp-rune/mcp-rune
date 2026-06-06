/**
 * FieldDefinition — resolved field schema produced by an API convention and
 * consumed by `schema-derivation`. Distinct from `AttributeDefinition` (the
 * model-author input): a FieldDefinition is the post-convention output that
 * names the wire field (e.g. `author_id`) and carries its derived metadata.
 */

import type { CompletionConfig } from '#src/mcp/models/attribute-definition.js'

export interface FieldDefinition {
  name: string
  type: string
  required: boolean
  description: string
  examples?: unknown[]
  items?: { type: string }
  completion?: CompletionConfig
  enumValues?: string[]
  format?: string
  default?: unknown
  label?: string
  validation?: Record<string, unknown>
}
