/**
 * One-call assembly of every MCP App the framework ships.
 *
 * Each factory (pick-model-app, find-model-app, new-model-app,
 * edit-model-app, multi-pick-model-app, show-model-app) was previously
 * instantiated by hand at integration time. `createDefaultAppRegistry`
 * collapses that boilerplate into a single call while keeping every
 * `AppRegistry` option (theme, kinds, search adapter, DataLayer
 * factory, …) addressable. Use `exclude` to opt individual apps out.
 */

import type {
  SearchGroup,
  SearchRequestShaper
} from '#src/mcp/data-layer/api-extensions/search/index.js'
import type { DataLayerFactory } from '#src/mcp/data-layer/data-layer.js'

import { createFindModelApp } from '../find-model-app/index.js'
import { createMultiPickModelApp } from '../multi-pick-model-app/index.js'
import { createPickModelApp } from '../pick-model-app/index.js'
import { createShowModelApp } from '../show-model-app/index.js'
import { createViewSelectionApp } from '../view-selection-app/index.js'
import type { AppFormClass } from './app-form-entities.js'
import type { ApiClient, AppModelClass } from './app-shared-entities.js'
import { createModelFormApp } from './create-model-form-app.js'
import type { AppDefinition, KindExtension, ThemeOverrides } from './registry.js'
import { AppRegistry } from './registry.js'
import { synthesizeDefaultFormClass } from './synthesize-form-class.js'

export type DefaultAppName =
  | 'pick-model-app'
  | 'find-model-app'
  | 'multi-pick-model-app'
  | 'show-model-app'
  | 'view-selection-app'
  | 'new-model-app'
  | 'edit-model-app'

export interface DefaultAppRegistryOptions {
  modelClasses: Record<string, AppModelClass>
  /**
   * Per-model form classes. Each entry satisfies the {@link AppFormClass}
   * shape (`BaseAppForm` subclasses and structurally-compatible literals
   * both work). When a model is absent from this dictionary the registry
   * synthesizes a default form class from `ModelClass.attributes` —
   * every attribute whose definition does not set `prompt_visible: false`
   * becomes a field, in declaration order.
   */
  formClasses?: Record<string, AppFormClass>
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
  defaultShaper?: SearchRequestShaper
  headerIcon?: string
  themeOverrides?: ThemeOverrides
  kinds?: Record<string, KindExtension>
}

/**
 * Wire up every framework-shipped MCP App with one call. Returns an
 * `AppRegistry` ready to be passed to `createServer({ appRegistry })`.
 *
 * @example
 *   const appRegistry = createDefaultAppRegistry({
 *     modelClasses: MODEL_CLASSES,
 *     namespace: 'bookshelf',
 *     themeOverrides: { cssVariables: { '--acc': '#0a84ff', '--acc-2': '#0a84ff' } }
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
    defaultShaper,
    headerIcon,
    themeOverrides,
    kinds
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

  // Build the effective per-model form-class dictionary. Deployer-supplied
  // entries pass through verbatim; missing entries fall back to a
  // synthesized default (every prompt-visible attribute, in order).
  // Models that would synthesize to an empty fields list are skipped so
  // the form apps simply don't list them as eligible.
  const formClassesForApps: Record<string, AppFormClass> = {}
  for (const [name, ModelClass] of Object.entries(modelClasses)) {
    const explicit = formClasses?.[name]
    if (explicit) {
      formClassesForApps[name] = explicit
      continue
    }
    const synthesized = synthesizeDefaultFormClass(ModelClass)
    if (synthesized.fields.length > 0) {
      formClassesForApps[name] = synthesized
    }
  }

  // `searchGroups` here describes the AppRegistry-level SearchService routing,
  // a different shape from the pick-model-app's group config. The default
  // helper wires it onto the registry only; deployers who need the picker's
  // group mode should compose the picker factory by hand.
  add('pick-model-app', createPickModelApp({ modelClasses, namespace }))
  add('find-model-app', createFindModelApp({ modelClasses, namespace }))
  add('multi-pick-model-app', createMultiPickModelApp({ modelClasses, namespace }))
  add(
    'show-model-app',
    createShowModelApp({
      modelClasses,
      ...(promptClasses && { promptClasses }),
      namespace
    })
  )
  add('view-selection-app', createViewSelectionApp({ modelClasses, namespace }))
  add(
    'new-model-app',
    createModelFormApp({
      mode: 'create',
      modelClasses,
      formClasses: formClassesForApps,
      ...(promptClasses && { promptClasses: promptClasses as never }),
      namespace
    })
  )
  add(
    'edit-model-app',
    createModelFormApp({
      mode: 'update',
      modelClasses,
      formClasses: formClassesForApps,
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
    ...(defaultShaper && { defaultShaper }),
    ...(headerIcon !== undefined && { headerIcon }),
    ...(themeOverrides && { themeOverrides }),
    ...(kinds && { kinds })
  })
}
