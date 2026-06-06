/**
 * ApiConfig — per-model API configuration (endpoint + convention + overrides).
 */

import type { BaseConvention } from '#src/mcp/data-layer/api-conventions/base-convention.js'

/** Per-action endpoint overrides for models with non-standard API paths. */
export interface EndpointOverrides {
  /** Override for collection operations (list, create). */
  collection?: string
  /** Override for record operations (find, update, delete) — use :id for record ID. */
  record?: string
  /** Action-specific overrides — take highest priority. */
  create?: string
  update?: string
  delete?: string
}

export interface ApiConfig {
  /** Base API path for this model (e.g., 'books', 'activities'). */
  endpoint: string
  convention?: BaseConvention
  readOnly?: boolean
  /** Parent model name(s) for nested resources. */
  parent?: string | string[]
  /** Whether the model has a standalone (non-nested) endpoint. Default: true. */
  standalone?: boolean
  /** API namespace prefix (e.g., 'api/v1'). Overrides server-wide default. */
  namespace?: string
  /** Per-action endpoint overrides for non-standard API paths. */
  endpoints?: EndpointOverrides
}
