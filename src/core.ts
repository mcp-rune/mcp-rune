// mcp-rune/core — framework primitives: config, env, helpers, api-client,
// data-layer seam. Model-domain primitives live under `./models` (was here).
export type { ApiClient, RequestOptions, SearchApiClient } from './core/api-client.js'
export type { Config, ConfigDescriptor, ConfigSchema } from './core/config.js'
export { loadConfig } from './core/config.js'
export type {
  DataLayer,
  DataLayerFactory,
  DataLayerFactoryContext,
  ModelRequestOptions,
  PaginationParams
} from './core/data-layer.js'
export type { InMemoryDataLayerOptions, StubFixtures, StubRecord } from './core/data-layer-stub.js'
export {
  createInMemoryDataLayer,
  InMemoryDataLayer,
  loadFixturesFromJson
} from './core/data-layer-stub.js'
export { boolEnv, intEnv, optionalEnv, requireEnv } from './core/env.js'
export { hintForError } from './core/error-hints.js'
export {
  coerceToObject,
  formatErrorResponse,
  formatToolResponse,
  pickFields,
  sanitizeResponseData,
  truncateString
} from './core/helpers.js'
export { readPackageInfo } from './core/package-info.js'
export { StartupTracker } from './core/startup-tracker.js'
export { closestMatch, levenshtein } from './core/suggestions.js'
export type {
  AssociationConfig,
  BelongsToAssociation,
  HasManyAssociation
} from './mcp/api-conventions/base-convention.js'
