// mcp-rune/core — config, env, helpers, validators, base model, api-client primitive
export type { ApiClient, RequestOptions, SearchApiClient } from './core/api-client.js'
export type { AttributeDefinition } from './core/base-model.js'
export { BaseModel } from './core/base-model.js'
export { loadConfig } from './core/config.js'
export type {
  DataLayer,
  DataLayerFactory,
  DataLayerFactoryContext,
  ModelRequestOptions,
  PaginationParams
} from './core/data-layer.js'
export type { InMemoryDataLayerOptions, StubFixtures, StubRecord } from './core/data-layer-stub.js'
export { createInMemoryDataLayer, InMemoryDataLayer } from './core/data-layer-stub.js'
export type { ModelWithDerivedAttrs } from './core/derived-fields.js'
export { resolveDerivedFields } from './core/derived-fields.js'
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
export type { KindDescriptor, KindOpts } from './core/kind-metadata.js'
export { getKind, KIND_REGISTRY, registerKind } from './core/kind-metadata.js'
export { readPackageInfo } from './core/package-info.js'
export { StartupTracker } from './core/startup-tracker.js'
export {
  validateEnum,
  validateModel,
  validatePositiveInt,
  validateRequired,
  validateUrl
} from './core/validators.js'
