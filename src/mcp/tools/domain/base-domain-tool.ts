import type { ToolAnnotations, ToolSuccessResponse } from '../base-tool.js'
import { BaseTool } from '../base-tool.js'

/**
 * Presentation footer appended to all domain tool responses.
 *
 * Guides the LLM to use human-readable field labels (from model metadata)
 * instead of raw database attribute names when explaining concepts to users.
 */
export const PRESENTATION_FOOTER = `
---
**Presentation:** When explaining these concepts to users, use the field's label or description rather than its raw attribute name. For example, say "transmission trigger" instead of \`reference_tx_nth\`, "start offset" instead of \`start_offset_value\`, "publish date" instead of \`put_up\`, "end date" instead of \`take_down\`. Use the API attribute name only when showing code examples or API calls.`

/**
 * Base class for domain intelligence tools (knowledge, rules, workflows).
 * Reads from a configured domain registry, no upstream API auth.
 */
export class BaseDomainTool extends BaseTool {
  static override requiresAuth = false
  static override requiresDomainRegistry = true
  static override defaultAnnotations: ToolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }

  /** Require domain registry to be configured */
  requireDomainRegistry(): void {
    if (!this.domainRegistry) {
      throw new Error('No domain registry configured for this server.')
    }
  }

  /** Override formatResponse to append the presentation footer */
  override formatResponse(
    text: string | Record<string, unknown>,
    options?: { meta?: Record<string, unknown> }
  ): ToolSuccessResponse {
    const textStr = typeof text === 'string' ? text : JSON.stringify(text, null, 2)
    return super.formatResponse(textStr + PRESENTATION_FOOTER, options)
  }
}
