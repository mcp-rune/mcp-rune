// mcp-rune model-domain public surface — `@mcp-rune/mcp-rune/models`.
//
// What a model IS: `BaseModel`, the kinds vocabulary, and the attribute /
// association definition types. Plus the model-driven schema validators the
// boot gate (`validateRegistries`) and deployers use. Consumption machinery
// (ModelLayer / AnalysisLayer) is reached through its own injected factories,
// not re-exported here.

export type { ModelData } from './base-model.js'
export { BaseModel } from './base-model.js'
export type {
  KindDescriptor,
  KindOpts,
  KindOptsSource,
  KindRenderHint,
  KnownKind
} from './kinds/index.js'
export {
  getKind,
  kindOptsFrom,
  registerKind,
  resolveInputType,
  UnknownKindError
} from './kinds/index.js'
export type {
  ApiConfig,
  AssociationConfig,
  AttributeDefinition,
  AttributesConfig,
  BelongsToAssociation,
  CompletionConfig,
  EndpointOverrides,
  HasManyAssociation
} from './model-definitions.js'
export * from '#src/mcp/analysis-layer/summary-strategies/index.js'
export type { ModelWithDerivedAttrs } from '#src/mcp/model-layer/derived-fields.js'
export { resolveDerivedFields } from '#src/mcp/model-layer/derived-fields.js'
export {
  validateAssociation,
  validateAttributeDefinition,
  validateModelClass
} from '#src/mcp/model-layer/model-validator.js'
export type {
  Issue,
  IssueLevel,
  IssueScope,
  RegistriesInput,
  ValidationReport
} from '#src/mcp/schema/index.js'
export { formatReport, SchemaValidationError, validateRegistries } from '#src/mcp/schema/index.js'
