/**
 * Standardized LLM-facing summary block for MCP App tool responses.
 *
 * App tools return two content blocks: block 0 carries the UI payload the
 * sandboxed iframe consumes, block 1 is the LLM directive built here. Block 1
 * tells the model that the data is already on screen and must not be repeated
 * in its reply, plus an explicit id list so it can reference rows by id rather
 * than re-narrating them.
 */

export interface AppSummaryInput {
  toolName: string
  count: number
  ids: Array<string | number>
  page?: number
  totalPages?: number
  totalRecords?: number
  context?: string
}

/**
 * Build the LLM-facing summary text that becomes block 1 of an app response.
 * Wording is intentionally identical across apps so the LLM gets a consistent
 * signal that the data is rendered, not pending summarization.
 */
export function formatAppSummary({
  toolName,
  count,
  ids,
  page,
  totalPages,
  totalRecords,
  context
}: AppSummaryInput): string {
  const idPreview = ids.slice(0, 20).map(String).join(', ')
  const idEllipsis = ids.length > 20 ? ', …' : ''
  const total = totalRecords ?? count
  const pageInfo =
    page !== undefined && totalPages !== undefined ? ` (page ${page}/${totalPages})` : ''
  const totalSuffix = total !== count ? ` of ${total}` : ''
  const ctx = context ? ` ${context}` : ''

  return (
    `Displayed ${count}${totalSuffix} records in the ${toolName} MCP App${pageInfo}.${ctx} ` +
    `ids: [${idPreview}${idEllipsis}]. ` +
    `The user can see these records in the App UI. Do NOT repeat their fields in your reply; ` +
    `reference them by id if needed and ask the user what to do next.`
  )
}

/** Extract ids from a heterogeneous records array. Falls back to '?' for missing ids. */
export function extractIds(
  records: ReadonlyArray<Record<string, unknown>>
): Array<string | number> {
  return records.map((r) => {
    const id = r.id
    if (typeof id === 'string' || typeof id === 'number') return id
    return '?'
  })
}

/**
 * Build the response-level `_meta` to tag an app result's bulky UI payload as
 * transient. Harnesses that honour `_meta.context.lifecycle` will compress the
 * UI payload out of the LLM's working context after the directive in block 1
 * has been read. The `summary` mirrors block 1 so trimmed view still references
 * the ids the LLM was asked to remember.
 */
export function appResponseMeta(summary: string): Record<string, unknown> {
  return {
    context: {
      lifecycle: 'transient',
      summary
    }
  }
}
