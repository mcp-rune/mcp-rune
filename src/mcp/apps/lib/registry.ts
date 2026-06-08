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

import { createAnalysisLayerFactory } from '#src/mcp/analysis-layer/analysis-layer.js'
import { errorMeta } from '#src/mcp/apps/lib/helpers.js'
import type {
  SearchGroup,
  SearchRequestShaper
} from '#src/mcp/data-layer/api-extensions/search/index.js'
import {
  createSearchService,
  SearchEnabledDataLayer
} from '#src/mcp/data-layer/api-extensions/search/index.js'
import type { BaseConvention, DataLayer, DataLayerFactory } from '#src/mcp/data-layer/data-layer.js'
import { ModelService } from '#src/mcp/data-layer/model-service/model-service.js'
import {
  createModelLayerFactory,
  type ModelLayerFactory
} from '#src/mcp/model-layer/model-layer.js'
import type { KindDescriptor, KindRenderHint } from '#src/mcp/models/kinds/index.js'
import { registerKind } from '#src/mcp/models/kinds/index.js'
import type { ModelsRegistry } from '#src/mcp/models/model-definitions.js'
import * as logger from '#src/runtime/logger.js'

import type { FormSubmitMode } from '../../extensions/tool-flow.js'
import type { AppFormDataStore } from './app-form-data-store.js'
import type { ApiClient, ToolResult } from './app-shared-entities.js'
import type { SelectionStore } from './selection-store.js'

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
 * defined in `src/mcp/apps/shared/base.css` (e.g. `--acc`, `--acc-tint`,
 * `--ink`, `--surface`, `--line-2`, `--radius-md`).
 */
export interface ThemeOverrides {
  cssVariables?: Record<string, string>
  css?: string
}

/**
 * Deployer-facing kind extension — one entry per custom or overridden kind,
 * keyed by `"kind"` or `"kind:format"` (the same convention as `getKind`).
 *
 * Everything kind-definitional (parse, serialize, describe, validate, label,
 * htmlInputType, promptType, …) is registered with `src/mcp/models/kinds/` at
 * `AppRegistry` construction time and runs server-side. Only `render` flows
 * into the iframe via a `<script>` tag — the runtime in
 * `kind-renderers.runtime.js` compiles the hint into a DOM renderer through
 * a closed allowlist of operations (template, Intl locale, badge variant),
 * so the channel stays CSP-safe.
 *
 * This is the single extension path. There is no parallel iframe-only
 * descriptor; if you want to influence form behavior, put it in the
 * descriptor half.
 */
export interface KindExtension extends Partial<KindDescriptor> {
  render?: KindRenderHint
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
  /**
   * Server-wide wire-format default forwarded into
   * `DataLayerFactoryContext.defaultConvention`. Mirrors the option on
   * `ToolRegistry`; the default `ModelService` adapter applies it to any
   * model that does not declare `api.convention`. Falls back to
   * `jsonApiConvention` when omitted. Custom `dataLayer` factories may
   * honor or ignore this.
   */
  defaultConvention?: BaseConvention
  searchGroups?: Record<string, SearchGroup>
  defaultShaper?: SearchRequestShaper
  /**
   * SVG data URI for the h1::before header icon. Kept as a top-level option
   * because it is the common case; equivalent to setting
   * `themeOverrides.cssVariables['--header-icon']` to `url("…")`.
   */
  headerIcon?: string
  /** Per-deployment CSS variable + raw-CSS overrides applied to every app. */
  themeOverrides?: ThemeOverrides
  /**
   * Deployer-defined kinds, keyed by `"kind"` or `"kind:format"`. Each entry
   * is a `Partial<KindDescriptor>` (parse, validate, label, …) plus an
   * optional `render` hint for the iframe. AppRegistry registers the
   * descriptor half with `src/mcp/models/kinds/` at construction time and
   * serializes `render` into a CSP-safe `<script>` block consumed by
   * `kind-renderers.runtime.js`.
   *
   * Call `validateRegistries(...)` *after* constructing `AppRegistry` so
   * boot-time validation sees deployer-defined kinds.
   */
  kinds?: Record<string, KindExtension>
}

interface RegisterToolsOptions {
  getAccessToken?: () => Promise<string>
  selectionStore?: SelectionStore
  formDataStore?: AppFormDataStore
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
  private _defaultConvention: BaseConvention | undefined
  private _modelLayer: ModelLayerFactory
  private _searchGroups: Record<string, SearchGroup>
  private _defaultShaper?: SearchRequestShaper
  private _headerIcon?: string
  private _themeOverrides?: ThemeOverrides
  private _kindRenderHints: Record<string, KindRenderHint> = {}
  private _formSubmitMode: FormSubmitMode = 'direct'

  constructor(
    apps: AppDefinition[] = [],
    {
      apiUrl,
      createApiClient,
      models,
      dataLayer,
      defaultConvention,
      searchGroups = {},
      defaultShaper,
      headerIcon,
      themeOverrides,
      kinds
    }: RegistryOptions = {}
  ) {
    this._apiUrl = apiUrl
    this._createApiClient = createApiClient
    this._models = models ?? {}
    this._defaultConvention = defaultConvention
    this._searchGroups = searchGroups
    this._defaultShaper = defaultShaper
    this._headerIcon = headerIcon
    this._themeOverrides = themeOverrides

    if (kinds) {
      for (const [extKey, extension] of Object.entries(kinds)) {
        const { render, ...descriptor } = extension
        const sep = extKey.indexOf(':')
        const kind = sep === -1 ? extKey : extKey.slice(0, sep)
        const format = sep === -1 ? undefined : extKey.slice(sep + 1)
        if (Object.keys(descriptor).length > 0) {
          registerKind(kind, descriptor, format ? { format } : {})
        }
        if (render) {
          this._kindRenderHints[extKey] = render
        }
      }
    }

    // Default DataLayer factory wraps ModelService. Apps share the same
    // pluggable seam as ToolRegistry — integrators can swap the adapter
    // (in-memory stub, third-party library, etc.) by passing `dataLayer`.
    const modelsRef = this._models
    this._dataLayerFactory =
      dataLayer ??
      (({ apiClient, models: m, logger: log, defaultConvention: dc }): DataLayer =>
        new ModelService({
          apiClient: apiClient!,
          models: m ?? modelsRef,
          defaultConvention: dc,
          logger: log
        }))

    // Per-model-bound ModelLayer factory. Stateless w.r.t. auth and shared
    // across every app invocation — the AnalysisLayer counterpart is built
    // per-request below because it carries the request-scoped DataLayer.
    this._modelLayer = createModelLayerFactory(this._models)

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
   * Current form submit mode threaded into `new_model_app` /
   * `edit_model_app` responses. Defaults to `'direct'`; flip to
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

            // Build the authenticated DataLayer for apps that need it. The
            // DataLayer exposed to handlers is wrapped in SearchEnabledDataLayer
            // so app code routes every text/filter/lookup/group operation
            // through the `*Normalized` methods on the seam — apps never see
            // SearchService directly. This enforces the projection-layer rule
            // by absence: the context bag has no `searchClient` field.
            context.modelLayer = this._modelLayer

            if (app.needsAuth && getAccessToken && this._apiUrl && this._createApiClient) {
              const token = await getAccessToken()
              const apiClient = this._createApiClient(token, { apiUrl: this._apiUrl })
              const baseDataLayer = this._dataLayerFactory({
                apiClient,
                models: this._models,
                defaultConvention: this._defaultConvention,
                logger
              })
              const searchService = createSearchService(baseDataLayer, {
                searchGroups: this._searchGroups,
                defaultShaper: this._defaultShaper
              })
              const dataLayer = new SearchEnabledDataLayer(baseDataLayer, searchService)
              context.dataLayer = dataLayer
              context.analysisLayer = createAnalysisLayerFactory(this._models, dataLayer)
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
   * variables + raw CSS into one `<style>` block, and kind render hints into
   * one `<script>` block, both placed before `</head>`. Returns the input
   * unchanged when nothing needs injecting.
   *
   * Order matters: the `<script>` block precedes the `<style>` block so the
   * renderer registry is populated before the bundled app code runs. Both
   * sit before `</head>` so the host iframe parses them before body content.
   *
   * Public so tests can exercise it without going through `registerResources`.
   */
  injectIntoHead(html: string): string {
    const styleBlock = this._buildStyleBlock()
    const scriptBlock = this._buildKindRenderersBlock()
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

  private _buildKindRenderersBlock(): string {
    if (Object.keys(this._kindRenderHints).length === 0) return ''
    const json = escapeJsonForScript(JSON.stringify(this._kindRenderHints))
    return `<script>window.__MCP_RUNE_KIND_RENDERERS__=${json};</script>`
  }
}

/** Make a JSON literal safe to embed inside a `<script>` block. */
function escapeJsonForScript(json: string): string {
  return json.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}
