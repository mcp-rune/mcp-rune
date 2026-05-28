/**
 * One-call assembly of every MCP App the framework ships.
 *
 * Each of the six factories (autocomplete-picker, list-view, model-form
 * create+update, multi-select, record-detail, search-view) was previously
 * instantiated by hand at integration time. `createDefaultAppRegistry`
 * collapses that boilerplate into a single call while keeping every
 * `AppRegistry` option (theme, formatters, search adapter, DataLayer
 * factory, …) addressable. Use `exclude` to opt individual apps out.
 */

import type { SearchAdapter, SearchGroup } from '#src/api-extensions/search/index.js'
import type { DataLayerFactory } from '#src/core/data-layer.js'

import { createAutocompletePickerApp } from './autocomplete-picker.js'
import { createListViewApp } from './list-view.js'
import { createCreateFormApp, createUpdateFormApp } from './model-form.js'
import { createMultiSelectApp } from './multi-select.js'
import { createRecordDetailApp } from './record-detail.js'
import type { AppDefinition, FormatterDescriptor, ThemeOverrides } from './registry.js'
import { AppRegistry } from './registry.js'
import { createSearchViewApp } from './search-view.js'
import type { ApiClient, AppModelClass } from './types.js'

export type DefaultAppName =
  | 'autocomplete-picker'
  | 'list-view'
  | 'multi-select'
  | 'record-detail'
  | 'search-view'
  | 'create-form'
  | 'update-form'

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
  formatterScript?: string
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
    formatters,
    formatterScript
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
  // a different shape from the autocomplete-picker's group config. The default
  // helper wires it onto the registry only; deployers who need the picker's
  // group mode should compose the picker factory by hand.
  add('autocomplete-picker', createAutocompletePickerApp({ modelClasses, namespace }))
  add('list-view', createListViewApp({ modelClasses, namespace }))
  add('multi-select', createMultiSelectApp({ modelClasses, namespace }))
  add(
    'record-detail',
    createRecordDetailApp({
      modelClasses,
      ...(promptClasses && { promptClasses }),
      namespace
    })
  )
  add('search-view', createSearchViewApp({ modelClasses, namespace }))
  add(
    'create-form',
    createCreateFormApp({
      modelClasses,
      formClasses: effectiveFormClasses as never,
      ...(promptClasses && { promptClasses: promptClasses as never }),
      namespace
    })
  )
  add(
    'update-form',
    createUpdateFormApp({
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
    ...(formatters && { formatters }),
    ...(formatterScript !== undefined && { formatterScript })
  })
}
