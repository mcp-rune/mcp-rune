// mcp-rune/api-conventions — convention base + built-in conventions for
// shaping API request/response payloads (jsonApiConvention default,
// custom conventions via subclassing BaseConvention).
export type {
  AssociationConfig,
  BelongsToAssociation,
  ErrorResponse,
  FieldDefinition,
  HasManyAssociation,
  NormalizedListResponse,
  PaginationInfo
} from './mcp/api-conventions/index.js'
export {
  BaseConvention,
  defaultConvention,
  jsonApiConvention
} from './mcp/api-conventions/index.js'
