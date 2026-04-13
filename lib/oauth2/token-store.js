/**
 * OAuth2 Token Store
 *
 * Delegates to a PostgresqlAdapter injected via _setAdapter().
 * The adapter is set at startup by the MCP server config (e.g., src/engineer/config.js).
 *
 * When no adapter is injected, all operations throw — this means
 * DATABASE_URL was not set and database features are disabled.
 */

let adapter = null

/**
 * Get the adapter instance, or throw if none was injected.
 * @returns {import('./adapters/base-adapter.js').BaseTokenStoreAdapter}
 */
function getAdapter() {
  if (!adapter) {
    throw new Error('Token store not configured. Set DATABASE_URL to enable database features.')
  }
  return adapter
}

export async function storeTokens(params) {
  return getAdapter().storeTokens(params)
}

export async function getTokens(userId) {
  return getAdapter().getTokens(userId)
}

export async function getTokensBySession(mcpSessionId) {
  return getAdapter().getTokensBySession(mcpSessionId)
}

export async function deleteTokens(userId) {
  return getAdapter().deleteTokens(userId)
}

export async function deleteExpiredTokens() {
  return getAdapter().deleteExpiredTokens()
}

export async function close() {
  if (adapter) {
    await adapter.close()
    adapter = null
  }
}

/**
 * Inject the token store adapter (called at startup by server config)
 * @param {import('./adapters/base-adapter.js').BaseTokenStoreAdapter|null} newAdapter
 */
export function _setAdapter(newAdapter) {
  adapter = newAdapter
}

export default {
  storeTokens,
  getTokens,
  getTokensBySession,
  deleteTokens,
  deleteExpiredTokens,
  close,
  _setAdapter
}
