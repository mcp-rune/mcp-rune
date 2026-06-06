// mcp-rune model-domain layer — BaseModel, kind metadata, and re-exports of
// model-layer + analysis-layer helpers for backwards-compatible public access.
// Helper logic itself lives in `src/mcp/model-layer/` (model-config consumers)
// and `src/mcp/analysis-layer/` (analysis-domain consumers). PR3 will remove
// the re-exports below in favor of `modelLayer` / `analysisLayer` injection.

export type { ApiConfig, EndpointOverrides } from './api-config.js'
export type {
  AssociationConfig,
  BelongsToAssociation,
  HasManyAssociation
} from './association-config.js'
export type {
  AttributeDefinition,
  AttributesConfig,
  CompletionConfig
} from './attribute-definition.js'
export type { ModelData } from './base-model.js'
export { BaseModel } from './base-model.js'
export type { KindDescriptor, KindOpts, KindRenderHint } from './kinds/index.js'
export { getKind, registerKind } from './kinds/index.js'
export * from '#src/mcp/analysis-layer/summary-strategies/index.js'
export type { ModelWithDerivedAttrs } from '#src/mcp/model-layer/derived-fields.js'
export { resolveDerivedFields } from '#src/mcp/model-layer/derived-fields.js'
export {
  validateAssociation,
  validateAttributeDefinition,
  validateModelClass
} from '#src/mcp/model-layer/model-validator.js'
export {
  validateEnum,
  validateModel,
  validatePositiveInt,
  validateRequired,
  validateUrl
} from '#src/mcp/model-layer/validators.js'
export type {
  Issue,
  IssueLevel,
  IssueScope,
  RegistriesInput,
  ValidationReport
} from '#src/mcp/schema/index.js'
export { formatReport, SchemaValidationError, validateRegistries } from '#src/mcp/schema/index.js'
