/**
 * One-call assembly of every MCP App the framework ships.
 *
 * Each of the seven factories (pick-model-app, list-model-app,
 * new-model-app, edit-model-app, multi-pick-model-app, show-model-app,
 * search-model-app) was previously instantiated by hand at integration
 * time. `createDefaultAppRegistry`
 * collapses that boilerplate into a single call while keeping every
 * `AppRegistry` option (theme, formatters, search adapter, DataLayer
 * factory, …) addressable. Use `exclude` to opt individual apps out.
 */

import type { SearchAdapter, SearchGroup } from '#src/api-extensions/search/index.js'
import type { DataLayerFactory } from '#src/core/data-layer.js'

import { createListModelApp } from './list-model-app.js'
import { createEditModelApp, createNewModelApp } from './model-form.js'
import { createMultiPickModelApp } from './multi-pick-model-app.js'
import { createPickModelApp } from './pick-model-app.js'
import type { AppDefinition, FormatterDescriptor, ThemeOverrides } from './registry.js'
import { AppRegistry } from './registry.js'
import { createSearchModelApp } from './search-model-app.js'
import { createShowModelApp } from './show-model-app.js'
import type { ApiClient, AppModelClass } from './types.js'

export type DefaultAppName =
  | 'pick-model-app'
  | 'list-model-app'
  | 'multi-pick-model-app'
  | 'show-model-app'
  | 'search-model-app'
  | 'new-model-app'
  | 'edit-model-app'

export interface DefaultAppRegistryOptions {
  modelClasses: Record<string, AppModelClass>
  /** Per-model form config; defaults to `modelClasses` (every model gets a form). */
  formClasses?: Record<string, unknown>
  /** Per-model PromptClass for form defaults; optional. */
  promptClasses?: Record<string, unknown>
  namespace: string

  /** Apps to skip. Useful for trimming the surface when a deployment doesn't need an app. */
  exclude?: DefaultAppName[]

  /** Forwarded to `AppRegistry`. */
  apiUrl?: string
  createApiClient?: (token: string, options: { apiUrl: string }) => ApiClient
  dataLayer?: DataLayerFactory
  searchGroups?: Record<string, SearchGroup>
  defaultAdapter?: SearchAdapter
  headerIcon?: string
  themeOverrides?: ThemeOverrides
  formatters?: Record<string, FormatterDescriptor>
}

/**
 * Wire up every framework-shipped MCP App with one call. Returns an
 * `AppRegistry` ready to be passed to `createServer({ appRegistry })`.
 *
 * @example
 *   const appRegistry = createDefaultAppRegistry({
 *     modelClasses: MODEL_CLASSES,
 *     namespace: 'bookshelf',
 *     themeOverrides: { cssVariables: { '--color-accent': '#0a84ff' } }
 *   })
 */
export function createDefaultAppRegistry(opts: DefaultAppRegistryOptions): AppRegistry {
  const {
    modelClasses,
    formClasses,
    promptClasses,
    namespace,
    exclude = [],
    apiUrl,
    createApiClient,
    dataLayer,
    searchGroups,
    defaultAdapter,
    headerIcon,
    themeOverrides,
    formatters
  } = opts

  const excludedSet = new Set<DefaultAppName>(exclude)
  const apps: AppDefinition[] = []

  function add(name: DefaultAppName, produced: unknown) {
    if (excludedSet.has(name)) return
    if (Array.isArray(produced)) {
      for (const entry of produced) {
        if (entry) apps.push(entry as AppDefinition)
      }
    } else if (produced) {
      apps.push(produced as AppDefinition)
    }
  }

  const effectiveFormClasses = formClasses ?? (modelClasses as unknown as Record<string, unknown>)

  // `searchGroups` here describes the AppRegistry-level SearchService routing,
  // a different shape from the pick-model-app's group config. The default
  // helper wires it onto the registry only; deployers who need the picker's
  // group mode should compose the picker factory by hand.
  add('pick-model-app', createPickModelApp({ modelClasses, namespace }))
  add('list-model-app', createListModelApp({ modelClasses, namespace }))
  add('multi-pick-model-app', createMultiPickModelApp({ modelClasses, namespace }))
  add(
    'show-model-app',
    createShowModelApp({
      modelClasses,
      ...(promptClasses && { promptClasses }),
      namespace
    })
  )
  add('search-model-app', createSearchModelApp({ modelClasses, namespace }))
  add(
    'new-model-app',
    createNewModelApp({
      modelClasses,
      formClasses: effectiveFormClasses as never,
      ...(promptClasses && { promptClasses: promptClasses as never }),
      namespace
    })
  )
  add(
    'edit-model-app',
    createEditModelApp({
      modelClasses,
      formClasses: effectiveFormClasses as never,
      ...(promptClasses && { promptClasses: promptClasses as never }),
      namespace
    })
  )

  return new AppRegistry(apps, {
    models: modelClasses,
    ...(apiUrl !== undefined && { apiUrl }),
    ...(createApiClient && { createApiClient }),
    ...(dataLayer && { dataLayer }),
    ...(searchGroups && { searchGroups }),
    ...(defaultAdapter && { defaultAdapter }),
    ...(headerIcon !== undefined && { headerIcon }),
    ...(themeOverrides && { themeOverrides }),
    ...(formatters && { formatters })
  })
}
