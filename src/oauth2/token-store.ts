/**
 * OAuth2 Token Store
 *
 * Delegates to a PostgresqlAdapter injected via _setAdapter().
 * The adapter is set at startup by the MCP server config (e.g., src/engineer/config.js).
 *
 * When no adapter is injected, all operations throw -- this means
 * DATABASE_URL was not set and database features are disabled.
 */

import type {
  BaseTokenStoreAdapter,
  StoreTokensParams,
  TokenData
} from './adapters/base-adapter.js'

let adapter: BaseTokenStoreAdapter | null = null

/** Get the adapter instance, or throw if none was injected. */
function getAdapter(): BaseTokenStoreAdapter {
  if (!adapter) {
    throw new Error('Token store not configured. Set DATABASE_URL to enable database features.')
  }
  return adapter
}

export async function storeTokens(params: StoreTokensParams): Promise<void> {
  return getAdapter().storeTokens(params)
}

export async function getTokens(userId: string): Promise<TokenData | null> {
  return getAdapter().getTokens(userId)
}

export async function getTokensBySession(mcpSessionId: string): Promise<TokenData | null> {
  return getAdapter().getTokensBySession(mcpSessionId)
}

export async function deleteTokens(userId: string): Promise<void> {
  return getAdapter().deleteTokens(userId)
}

export async function deleteExpiredTokens(): Promise<number> {
  return getAdapter().deleteExpiredTokens()
}

export async function close(): Promise<void> {
  if (adapter) {
    await adapter.close()
    adapter = null
  }
}

/** Inject the token store adapter (called at startup by server config) */
export function _setAdapter(newAdapter: BaseTokenStoreAdapter | null): void {
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
