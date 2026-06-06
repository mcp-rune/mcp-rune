// mcp-rune model-domain layer — BaseModel, schema validation, kind metadata,
// derived fields, edge extraction, multi-hop fetch, graph stratifiers, and
// summary strategies.

export type { ApiConfig, AttributeDefinition, EndpointOverrides, ModelData } from './base-model.js'
export { BaseModel } from './base-model.js'
export type { ModelWithDerivedAttrs } from './derived-fields.js'
export { resolveDerivedFields } from './derived-fields.js'
export type { KindDescriptor, KindOpts } from './kind-metadata.js'
export { getKind, KIND_REGISTRY, registerKind, UnknownKindError } from './kind-metadata.js'
export type {
  Issue,
  IssueLevel,
  IssueScope,
  RegistriesInput,
  ValidationReport
} from './schema-validation.js'
export {
  formatReport,
  SchemaValidationError,
  validateAssociation,
  validateAttributeDefinition,
  validateFormClass,
  validateModelClass,
  validatePromptClass,
  validateRegistries
} from './schema-validation.js'
export * from './summary-strategies/index.js'
export {
  validateEnum,
  validateModel,
  validatePositiveInt,
  validateRequired,
  validateUrl
} from './validators.js'
