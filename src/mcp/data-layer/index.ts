// mcp-rune data-layer — the projection-facing data-access seam, its in-memory
// stub, the default ModelService adapter, and the api-conventions that wrap
// each model's response shape.

export { BaseConvention, defaultConvention, jsonApiConvention } from './api-conventions/index.js'
export type {
  DataLayer,
  DataLayerFactory,
  DataLayerFactoryContext,
  ModelRequestOptions,
  PaginationParams
} from './data-layer.js'
export * from './model-service/index.js'
export type { InMemoryDataLayerOptions, StubFixtures, StubRecord } from './stub.js'
export { createInMemoryDataLayer, InMemoryDataLayer, loadFixturesFromJson } from './stub.js'
export type { NormalizedListResponse, PaginationInfo } from './types.js'
