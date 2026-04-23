/**
 * Generic MCP Apps Registry
 *
 * Manages MCP App registrations -- each app provides a UI resource
 * and optional tool metadata for the MCP Apps extension protocol.
 *
 * Uses @modelcontextprotocol/ext-apps helpers for standard registration
 * which auto-manages capabilities and metadata normalization.
 *
 * Apps that declare `needsAuth: true` receive an API client in their
 * handleToolCall context, created from the session's access token.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE
} from '@modelcontextprotocol/ext-apps/server'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { errorMeta } from '#src/mcp/apps/helpers.js'
import type { SearchAdapter } from '#src/mcp/search/search-adapter.js'
import { SearchService } from '#src/mcp/search/search-service.js'
import type { SearchGroup } from '#src/mcp/search/types.js'
import * as logger from '#src/services/logger.js'

import type { FormDataStore } from './form-data-store.js'
import type { SelectionStore } from './selection-store.js'
import type { ApiClient, ToolResult } from './types.js'

interface AppDefinition {
  resourceUri?: string
  toolName?: string
  needsAuth?: boolean
  visibility?: string[]
  name: string
  description: string
  toolDescription?: string
  toolInputSchema?: Record<string, unknown>
  handleToolCall?(
    args: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<ToolResult>
  getHtml?: () => string
}

interface RegistryOptions {
  apiUrl?: string
  createApiClient?: (token: string, options: { apiUrl: string }) => ApiClient
  searchGroups?: Record<string, SearchGroup>
  defaultAdapter?: SearchAdapter
  /** SVG data URI for the h1::before header icon (overrides --header-icon CSS variable) */
  headerIcon?: string
}

interface RegisterToolsOptions {
  getAccessToken?: () => Promise<string>
  selectionStore?: SelectionStore
  formDataStore?: FormDataStore
}

/** Registry of MCP Apps for any server. Provides tool and resource registration to the server factory. */
export class AppRegistry {
  private _apps = new Map<string, AppDefinition>()
  private _apiUrl?: string
  private _createApiClient?: (token: string, options: { apiUrl: string }) => ApiClient
  private _searchGroups: Record<string, SearchGroup>
  private _defaultAdapter?: SearchAdapter
  private _headerIcon?: string

  constructor(
    apps: AppDefinition[] = [],
    { apiUrl, createApiClient, searchGroups = {}, defaultAdapter, headerIcon }: RegistryOptions = {}
  ) {
    this._apiUrl = apiUrl
    this._createApiClient = createApiClient
    this._searchGroups = searchGroups
    this._defaultAdapter = defaultAdapter
    this._headerIcon = headerIcon
    for (const app of apps) {
      if (app.toolName) {
        this._apps.set(app.toolName, app)
      }
    }
  }

  get size(): number {
    return this._apps.size
  }

  /**
   * Get all registered app tool names.
   * Used by workflow renderer to generate dynamic tool exclusion warnings.
   */
  getToolNames(): string[] {
    return Array.from(this._apps.keys())
  }

  /**
   * Register app tools on an McpServer instance via ext-apps helpers.
   * Each app with a toolName gets registered with normalized UI metadata.
   *
   * Apps with `needsAuth: true` receive `{ apiClient }` in their handleToolCall
   * context, created from the session's access token.
   */
  registerTools(
    mcpServer: McpServer,
    { getAccessToken, selectionStore, formDataStore }: RegisterToolsOptions = {}
  ): void {
    for (const app of this._apps.values()) {
      if (!app.toolName || !app.handleToolCall) continue

      const visibility = app.visibility || ['model', 'app']

      registerAppTool(
        mcpServer,
        app.toolName,
        {
          description: app.toolDescription,
          inputSchema: app.toolInputSchema as Record<string, z.ZodTypeAny>,
          _meta: app.resourceUri
            ? { ui: { resourceUri: app.resourceUri, visibility } }
            : { ui: { visibility } }
        },
        (async (args: Record<string, unknown>, _extra: unknown) => {
          logger.info('App tool called', { service: 'mcp-app', app: app.toolName })

          try {
            const context: Record<string, unknown> = {}

            // Create authenticated API client and search client for apps that need it
            if (app.needsAuth && getAccessToken && this._apiUrl && this._createApiClient) {
              const token = await getAccessToken()
              const apiClient = this._createApiClient(token, { apiUrl: this._apiUrl })
              context.apiClient = apiClient
              context.searchClient = new SearchService(apiClient, {
                searchGroups: this._searchGroups,
                defaultAdapter: this._defaultAdapter
              })
            }

            if (selectionStore) {
              context.selectionStore = selectionStore
            }

            if (formDataStore) {
              context.formDataStore = formDataStore
            }

            return await app.handleToolCall!(args, context)
          } catch (err) {
            logger.error('App tool error', {
              service: 'mcp-app',
              app: app.toolName,
              ...errorMeta(err)
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: ${app.toolName} failed -- ${(err as Error).message}`
                }
              ],
              isError: true
            }
          }
        }) as never
      )
    }
  }

  /**
   * Register app resources on an McpServer instance via ext-apps helpers.
   * This auto-manages the resources capability on the underlying server.
   */
  registerResources(mcpServer: McpServer): void {
    const registered = new Set<string>()
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
            let html = app.getHtml!()
            if (this._headerIcon) {
              html = html.replace(
                '</head>',
                `<style>:root{--header-icon:url("${this._headerIcon}");}</style></head>`
              )
            }
            return {
              contents: [
                {
                  uri: app.resourceUri!,
                  mimeType: RESOURCE_MIME_TYPE,
                  text: html
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
