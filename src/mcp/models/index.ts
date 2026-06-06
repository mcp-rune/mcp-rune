// mcp-rune model-domain layer — BaseModel, schema validation, kind metadata,
// derived fields, edge extraction, multi-hop fetch, graph stratifiers, and
// summary strategies.

export type { ApiConfig, AttributeDefinition, EndpointOverrides, ModelData } from './base-model.js'
export { BaseModel } from './base-model.js'
export type { ModelWithDerivedAttrs } from './derived-fields.js'
export { resolveDerivedFields } from './derived-fields.js'
export type { KindDescriptor, KindOpts, KindRenderHint } from './kinds/index.js'
export { getKind, registerKind } from './kinds/index.js'
export {
  validateAssociation,
  validateAttributeDefinition,
  validateModelClass
} from './model-validator.js'
export * from './summary-strategies/index.js'
export {
  validateEnum,
  validateModel,
  validatePositiveInt,
  validateRequired,
  validateUrl
} from './validators.js'
export type {
  Issue,
  IssueLevel,
  IssueScope,
  RegistriesInput,
  ValidationReport
} from '#src/mcp/schema/index.js'
export { formatReport, SchemaValidationError, validateRegistries } from '#src/mcp/schema/index.js'
