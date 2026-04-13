/**
 * Shared helpers for server-side MCP App schema generators.
 */

/** Humanize a snake_case field name, stripping _id/_ids suffixes. */
export function humanize(str: string): string {
  return str
    .replace(/_id$/, '')
    .replace(/_ids$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Extract structured error metadata for logging. */
export function errorMeta(err: unknown): Record<string, unknown> {
  const e = err as Record<string, unknown>
  const message = e instanceof Error ? e.message : String(e)
  const cause = e instanceof Error ? e.cause : undefined
  return {
    errorType: (e as { constructor?: { name?: string } }).constructor?.name,
    error: message,
    ...((e as { response?: { status?: number } }).response?.status && {
      httpStatus: (e as { response: { status: number } }).response.status
    }),
    ...((e as { code?: string }).code && { code: (e as { code: string }).code }),
    ...(cause instanceof Error && { cause: cause.message })
  }
}

/**
 * Pluralize a model name to get its API endpoint.
 * Handles common English irregular plurals.
 */
export function pluralize(name: string): string {
  if (name.endsWith('y') && !name.endsWith('ay') && !name.endsWith('ey') && !name.endsWith('oy')) {
    return name.slice(0, -1) + 'ies'
  }
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('sh') || name.endsWith('ch')) {
    return name + 'es'
  }
  return name + 's'
}
