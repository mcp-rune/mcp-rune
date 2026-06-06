// mcp-rune/api-conventions — convention base + built-in conventions for
// shaping API request/response payloads (jsonApiConvention default,
// custom conventions via subclassing BaseConvention).
export type {
  ErrorResponse,
  NormalizedListResponse,
  PaginationInfo
} from './mcp/data-layer/api-conventions/index.js'
export {
  BaseConvention,
  defaultConvention,
  jsonApiConvention
} from './mcp/data-layer/api-conventions/index.js'
export type { FieldDefinition } from './mcp/model-layer/field-definition.js'
