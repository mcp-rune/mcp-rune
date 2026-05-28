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

import type { SearchAdapter, SearchGroup } from '#src/api-extensions/search/index.js'
import { createSearchService } from '#src/api-extensions/search/index.js'
import type { DataLayer, DataLayerFactory } from '#src/core/data-layer.js'
import { errorMeta } from '#src/mcp/apps/helpers.js'
import { ModelService } from '#src/mcp/services/model-service.js'
import type { ModelsRegistry } from '#src/mcp/tools/base-tool.js'
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
  /**
   * Tool annotations forwarded to registerAppTool. Read-only apps should
   * advertise `readOnlyHint: true` so hosts can offer them in lower-risk
   * permission tiers and so the model's tool-selection heuristics align
   * with MCP / OpenAI Apps SDK guidance.
   */
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
    [key: string]: unknown
  }
  handleToolCall?(
    args: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<ToolResult>
  getHtml?: () => string
}

/**
 * Per-deployment theming applied to every app's bundled HTML at serve time.
 * Both fields are optional and additive: `cssVariables` writes a `:root { … }`
 * block, `css` is appended verbatim. Variable names should match the tokens
 * defined in `src/mcp/apps/shared/base.css` (e.g. `--color-accent`,
 * `--color-accent-soft`, `--border-radius-md`).
 */
export interface ThemeOverrides {
  cssVariables?: Record<string, string>
  css?: string
}

interface RegistryOptions {
  apiUrl?: string
  createApiClient?: (token: string, options: { apiUrl: string }) => ApiClient
  /**
   * Models registry, required when apps need to fetch records through the
   * default `DataLayer` adapter. When omitted, apps that call
   * `context.dataLayer` will receive an empty-registry adapter and only
   * `dataLayer.dispatch` against literal URLs will work.
   */
  models?: ModelsRegistry
  /**
   * Optional `DataLayer` factory mirror of the one on `ToolRegistry`. Lets
   * integrators back the apps' data access with the same adapter they
   * configured for tools (in-memory stub, third-party library, etc.). When
   * omitted, the registry wraps the `createApiClient`-produced client in a
   * default `ModelService`.
   */
  dataLayer?: DataLayerFactory
  searchGroups?: Record<string, SearchGroup>
  defaultAdapter?: SearchAdapter
  /**
   * SVG data URI for the h1::before header icon. Kept as a top-level option
   * because it is the common case; equivalent to setting
   * `themeOverrides.cssVariables['--header-icon']` to `url("…")`.
   */
  headerIcon?: string
  /** Per-deployment CSS variable + raw-CSS overrides applied to every app. */
  themeOverrides?: ThemeOverrides
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
  private _models: ModelsRegistry
  private _dataLayerFactory: DataLayerFactory
  private _searchGroups: Record<string, SearchGroup>
  private _defaultAdapter?: SearchAdapter
  private _headerIcon?: string
  private _themeOverrides?: ThemeOverrides

  constructor(
    apps: AppDefinition[] = [],
    {
      apiUrl,
      createApiClient,
      models,
      dataLayer,
      searchGroups = {},
      defaultAdapter,
      headerIcon,
      themeOverrides
    }: RegistryOptions = {}
  ) {
    this._apiUrl = apiUrl
    this._createApiClient = createApiClient
    this._models = models ?? {}
    this._searchGroups = searchGroups
    this._defaultAdapter = defaultAdapter
    this._headerIcon = headerIcon
    this._themeOverrides = themeOverrides

    // Default DataLayer factory wraps ModelService. Apps share the same
    // pluggable seam as ToolRegistry — integrators can swap the adapter
    // (in-memory stub, third-party library, etc.) by passing `dataLayer`.
    const modelsRef = this._models
    this._dataLayerFactory =
      dataLayer ??
      (({ apiClient, models: m, logger: log }): DataLayer =>
        new ModelService({ apiClient: apiClient!, models: m ?? modelsRef, logger: log }))

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
          ...(app.annotations ? { annotations: app.annotations } : {}),
          _meta: app.resourceUri
            ? { ui: { resourceUri: app.resourceUri, visibility } }
            : { ui: { visibility } }
        },
        (async (args: Record<string, unknown>, _extra: unknown) => {
          logger.info('App tool called', { service: 'mcp-app', app: app.toolName })

          try {
            const context: Record<string, unknown> = {}

            // Build the authenticated DataLayer + search client for apps that need it
            if (app.needsAuth && getAccessToken && this._apiUrl && this._createApiClient) {
              const token = await getAccessToken()
              const apiClient = this._createApiClient(token, { apiUrl: this._apiUrl })
              const dataLayer = this._dataLayerFactory({
                apiClient,
                models: this._models,
                logger
              })
              context.dataLayer = dataLayer
              context.searchClient = createSearchService(dataLayer, {
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
            const html = this.injectIntoHead(app.getHtml!())
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

  /**
   * Inject per-deployment overrides into an app's bundled HTML just before
   * serving it as a resource. Collects `--header-icon`, `themeOverrides`
   * variables, and raw CSS into one `<style>` block placed before `</head>`.
   * Returns the input unchanged when nothing needs injecting.
   *
   * Public so tests can exercise it without going through `registerResources`.
   */
  injectIntoHead(html: string): string {
    const cssVariables: Record<string, string> = {
      ...(this._themeOverrides?.cssVariables ?? {})
    }
    if (this._headerIcon) {
      cssVariables['--header-icon'] = `url("${this._headerIcon}")`
    }

    const rawCss = this._themeOverrides?.css ?? ''
    if (Object.keys(cssVariables).length === 0 && !rawCss) return html

    const rootDecls = Object.entries(cssVariables)
      .map(([name, value]) => `${name}:${value};`)
      .join('')
    const rootBlock = rootDecls ? `:root{${rootDecls}}` : ''
    return html.replace('</head>', `<style>${rootBlock}${rawCss}</style></head>`)
  }
}
