/**
 * Generic MCP Apps Registry
 *
 * Manages MCP App registrations — each app provides a UI resource
 * and optional tool metadata for the MCP Apps extension protocol.
 *
 * Uses @modelcontextprotocol/ext-apps helpers for standard registration
 * which auto-manages capabilities and metadata normalization.
 *
 * Apps that declare `needsAuth: true` receive an API client in their
 * handleToolCall context, created from the session's access token.
 */

import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE
} from '@modelcontextprotocol/ext-apps/server'
import { SearchClient } from '#lib/mcp/search/search-client.js'
import * as logger from '#lib/services/logger.js'
import { errorMeta } from '#lib/mcp/apps/helpers.js'

/**
 * Registry of MCP Apps for any server.
 * Provides tool and resource registration to the server factory.
 */
export class AppRegistry {
  /**
   * @param {Object[]} apps - App definitions
   * @param {Object} options
   * @param {string} options.apiUrl - API base URL for creating API clients
   * @param {Function} options.createApiClient - Factory: (token, { apiUrl }) => apiClient
   * @param {Object} [options.searchGroups] - Search group definitions
   */
  constructor(apps = [], { apiUrl, createApiClient, searchGroups = {} } = {}) {
    this._apps = new Map()
    this._apiUrl = apiUrl
    this._createApiClient = createApiClient
    this._searchGroups = searchGroups
    for (const app of apps) {
      this._apps.set(app.toolName, app)
    }
  }

  get size() {
    return this._apps.size
  }

  /**
   * Get all registered app tool names.
   * Used by workflow renderer to generate dynamic tool exclusion warnings.
   * @returns {string[]}
   */
  getToolNames() {
    return Array.from(this._apps.keys())
  }

  /**
   * Register app tools on an McpServer instance via ext-apps helpers.
   * Each app with a toolName gets registered with normalized UI metadata.
   *
   * Apps with `needsAuth: true` receive `{ apiClient }` in their handleToolCall
   * context, created from the session's access token.
   *
   * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
   * @param {Object} [options]
   * @param {Function} [options.getAccessToken] - Async function returning access token
   */
  registerTools(mcpServer, { getAccessToken, selectionStore, formDataStore } = {}) {
    for (const app of this._apps.values()) {
      if (!app.toolName || !app.handleToolCall) continue

      const visibility = app.visibility || ['model', 'app']

      registerAppTool(
        mcpServer,
        app.toolName,
        {
          description: app.toolDescription,
          inputSchema: app.toolInputSchema,
          _meta: app.resourceUri
            ? { ui: { resourceUri: app.resourceUri, visibility } }
            : { ui: { visibility } }
        },
        async (args) => {
          logger.info('App tool called', { service: 'mcp-app', app: app.toolName })

          try {
            const context = {}

            // Create authenticated API client and search client for apps that need it
            if (app.needsAuth && getAccessToken && this._apiUrl && this._createApiClient) {
              const token = await getAccessToken()
              const apiClient = this._createApiClient(token, { apiUrl: this._apiUrl })
              context.apiClient = apiClient
              context.searchClient = new SearchClient(apiClient, {
                searchGroups: this._searchGroups
              })
            }

            if (selectionStore) {
              context.selectionStore = selectionStore
            }

            if (formDataStore) {
              context.formDataStore = formDataStore
            }

            return await app.handleToolCall(args, context)
          } catch (err) {
            logger.error('App tool error', {
              service: 'mcp-app',
              app: app.toolName,
              ...errorMeta(err)
            })
            return {
              content: [{ type: 'text', text: `Error: ${app.toolName} failed — ${err.message}` }],
              isError: true
            }
          }
        }
      )
    }
  }

  /**
   * Register app resources on an McpServer instance via ext-apps helpers.
   * This auto-manages the resources capability on the underlying server.
   * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
   */
  registerResources(mcpServer) {
    const registered = new Set()
    for (const app of this._apps.values()) {
      if (!app.resourceUri || registered.has(app.resourceUri)) continue
      registered.add(app.resourceUri)
      registerAppResource(
        mcpServer,
        app.name,
        app.resourceUri,
        { description: app.description },
        () => {
          try {
            return {
              contents: [
                {
                  uri: app.resourceUri,
                  mimeType: RESOURCE_MIME_TYPE,
                  text: app.getHtml()
                }
              ]
            }
          } catch (err) {
            logger.error('Failed to load app HTML', {
              service: 'mcp-app',
              app: app.name,
              resourceUri: app.resourceUri,
              ...errorMeta(err)
            })
            throw err
          }
        }
      )
    }
  }
}
