export { BaseConvention } from './base-convention.js'
export type {
  AssociationConfig,
  BelongsToAssociation,
  CompletionConfig,
  FieldDefinition,
  HasManyAssociation,
  NormalizedListResponse,
  PaginationInfo,
} from './base-convention.js'
export { halConvention } from './hal.js'
export { jsonApiConvention } from './json-api.js'

import type { BaseConvention } from './base-convention.js'
import { jsonApiConvention } from './json-api.js'
export const defaultConvention: BaseConvention = jsonApiConvention
