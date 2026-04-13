/**
 * Shared helpers for server-side MCP App schema generators.
 */

/**
 * Humanize a snake_case field name, stripping _id/_ids suffixes.
 * @param {string} str - Snake case string
 * @returns {string} Human readable string
 */
export function humanize(str) {
  return str
    .replace(/_id$/, '')
    .replace(/_ids$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Extract structured error metadata for logging.
 * @param {Error} err
 * @returns {Object} Structured error fields
 */
export function errorMeta(err) {
  return {
    errorType: err.constructor?.name,
    error: err.message,
    ...(err.response?.status && { httpStatus: err.response.status }),
    ...(err.code && { code: err.code }),
    ...(err.cause && { cause: err.cause.message })
  }
}

/**
 * Pluralize a model name to get its API endpoint.
 * Handles common English irregular plurals.
 * @param {string} name - Singular model name (e.g., 'category', 'activity')
 * @returns {string} Plural form (e.g., 'categories', 'activities')
 */
export function pluralize(name) {
  if (name.endsWith('y') && !name.endsWith('ay') && !name.endsWith('ey') && !name.endsWith('oy')) {
    return name.slice(0, -1) + 'ies'
  }
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('sh') || name.endsWith('ch')) {
    return name + 'es'
  }
  return name + 's'
}
