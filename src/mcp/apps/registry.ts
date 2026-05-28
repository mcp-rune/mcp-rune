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

import type { FormSubmitMode } from '../extensions/tool-flow.js'
import type { FormDataStore } from './form-data-store.js'
import type { SelectionStore } from './selection-store.js'
import type { ApiClient, ToolResult } from './types.js'

export interface AppDefinition {
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

/**
 * Declarative formatter descriptor.
 *
 * `display.template` writes "{value}"-substituted text.
 * `display.locale` reroutes datetime rendering through `Intl.DateTimeFormat`.
 * `display.badge` renders the value as a status badge with the given variant.
 * `parser.regex` + `parser.replacement` transform the API value before display.
 *
 * The shape is intentionally narrow — anything richer should ship as a
 * `formatterScript` (JS hook) so deployers don't try to smuggle behavior into
 * descriptors that are meant to stay declarative and CSP-safe.
 */
export interface FormatterDescriptor {
  display?: {
    template?: string
    locale?: string
    dateStyle?: 'full' | 'long' | 'medium' | 'short'
    timeStyle?: 'full' | 'long' | 'medium' | 'short'
    badge?: { icon?: string; className?: string }
  }
  parser?: {
    regex?: string
    replacement?: string
  }
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
  /**
   * Declarative formatter overrides keyed by `"kind"` or `"kind:format"`.
   * Translated by `formatters.runtime.js` into formatter objects through a
   * closed allowlist of operations. CSP-safe; serialized to a `<script>` tag.
   */
  formatters?: Record<string, FormatterDescriptor>
  /**
   * Deployer-supplied JavaScript that runs inside the app iframe AFTER
   * built-in formatters are registered. Expected to assign
   * `window.__MCP_RUNE_REGISTER_FORMATTERS__ = (registerFormatter, helpers) => { … }`.
   * This is the custom-kind path: register kinds the framework doesn't ship
   * (currency, phone, isbn, deployment-specific time) with arbitrary logic.
   *
   * Same trust boundary as the rest of the MCP server's output; framework
   * does no sandboxing beyond what the host provides.
   */
  formatterScript?: string
}

interface RegisterToolsOptions {
  getAccessToken?: () => Promise<string>
  selectionStore?: SelectionStore
  formDataStore?: FormDataStore
  /**
   * Extra context values to merge into every app tool handler's context
   * object. Populated by `ToolFlowExtension.provideContext(...)` and threaded
   * through the server factory.
   */
  extraContext?: Record<string, unknown>
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
  private _formatters?: Record<string, FormatterDescriptor>
  private _formatterScript?: string
  private _formSubmitMode: FormSubmitMode = 'direct'

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
      themeOverrides,
      formatters,
      formatterScript
    }: RegistryOptions = {}
  ) {
    this._apiUrl = apiUrl
    this._createApiClient = createApiClient
    this._models = models ?? {}
    this._searchGroups = searchGroups
    this._defaultAdapter = defaultAdapter
    this._headerIcon = headerIcon
    this._themeOverrides = themeOverrides
    this._formatters = formatters
    this._formatterScript = formatterScript

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
   * Register an additional app at runtime (e.g. from a `ToolFlowExtension`).
   * Returns the registry to allow chaining.
   *
   * Apps must declare a `toolName` to be registerable; resource-only apps
   * (no tool surface) are not supported via this entry point.
   */
  registerApp(app: AppDefinition): this {
    if (!app.toolName) {
      throw new Error('AppRegistry.registerApp: AppDefinition.toolName is required')
    }
    this._apps.set(app.toolName, app)
    return this
  }

  /** Look up a registered app by tool name. */
  getApp(toolName: string): AppDefinition | undefined {
    return this._apps.get(toolName)
  }

  /**
   * Current form submit mode threaded into `create_model_form` /
   * `update_model_form` responses. Defaults to `'direct'`; flip to
   * `'collect'` via a `ToolFlowExtension` (e.g. `centerOfControlExtension`).
   */
  getFormSubmitMode(): FormSubmitMode {
    return this._formSubmitMode
  }

  setFormSubmitMode(mode: FormSubmitMode): void {
    this._formSubmitMode = mode
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
    { getAccessToken, selectionStore, formDataStore, extraContext }: RegisterToolsOptions = {}
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
            const context: Record<string, unknown> = {
              ...(extraContext ?? {}),
              formSubmitMode: this._formSubmitMode
            }

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
   * serving it as a resource. Collects `--header-icon` + `themeOverrides`
   * variables + raw CSS into one `<style>` block, and `formatters` +
   * `formatterScript` into one `<script>` block, both placed before `</head>`.
   * Returns the input unchanged when nothing needs injecting.
   *
   * Order matters: the `<script>` block precedes the `<style>` block so the
   * formatter registry is populated before the bundled app code runs. Both
   * sit before `</head>` so the host iframe parses them before body content.
   *
   * Public so tests can exercise it without going through `registerResources`.
   */
  injectIntoHead(html: string): string {
    const styleBlock = this._buildStyleBlock()
    const scriptBlock = this._buildScriptBlock()
    if (!styleBlock && !scriptBlock) return html

    return html.replace('</head>', `${scriptBlock}${styleBlock}</head>`)
  }

  private _buildStyleBlock(): string {
    const cssVariables: Record<string, string> = {
      ...(this._themeOverrides?.cssVariables ?? {})
    }
    if (this._headerIcon) {
      cssVariables['--header-icon'] = `url("${this._headerIcon}")`
    }
    const rawCss = this._themeOverrides?.css ?? ''
    if (Object.keys(cssVariables).length === 0 && !rawCss) return ''

    const rootDecls = Object.entries(cssVariables)
      .map(([name, value]) => `${name}:${value};`)
      .join('')
    const rootBlock = rootDecls ? `:root{${rootDecls}}` : ''
    return `<style>${rootBlock}${rawCss}</style>`
  }

  private _buildScriptBlock(): string {
    const hasFormatters = this._formatters && Object.keys(this._formatters).length > 0
    const hasScript = !!this._formatterScript
    if (!hasFormatters && !hasScript) return ''

    const declarative = hasFormatters
      ? `window.__MCP_RUNE_FORMATTERS__=${escapeJsonForScript(JSON.stringify(this._formatters))};`
      : ''
    return `<script>${declarative}${hasScript ? this._formatterScript : ''}</script>`
  }
}

/** Make a JSON literal safe to embed inside a `<script>` block. */
function escapeJsonForScript(json: string): string {
  return json.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}
