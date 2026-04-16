/**
 * Common helper functions for MCP servers
 */

export interface ParentType {
  model: string
  endpoint: string
}

export interface ParentResource {
  id: string
  model: string
}

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>
  isError: boolean
}

export interface ModelConfig {
  endpoint: string
  api?: {
    nested?: {
      parent?: string | string[]
    }
  }
  [key: string]: unknown
}

/**
 * Truncate a string to a maximum length.
 */
export function truncateString(str: string, maxLength: number = 1000): string {
  if (!str || str.length <= maxLength) return str
  return (
    str.substring(0, maxLength) + `\n\n... [TRUNCATED - ${str.length - maxLength} more characters]`
  )
}

/**
 * Sanitize response data for MCP output.
 * Returns a JSON string for safe display. Handles arrays by showing a sample.
 */
export function sanitizeResponseData(data: unknown, maxSize: number = 50000): string {
  const jsonStr = JSON.stringify(data, null, 2)

  if (jsonStr.length <= maxSize) {
    return jsonStr
  }

  // If it's an array (paginated results), show structure with sample
  if (Array.isArray(data)) {
    return JSON.stringify(
      {
        warning: 'Response truncated due to size',
        original_size: jsonStr.length,
        record_count: data.length,
        sample: data.slice(0, 3),
        message: 'Showing first 3 records. Use pagination or filters to reduce result set.'
      },
      null,
      2
    )
  }

  // Otherwise truncate the JSON string
  return truncateString(jsonStr, maxSize)
}

/**
 * Pick only specified fields from API response records.
 * Always preserves `id` even if not listed in fields.
 * Returns data unchanged when fields is empty/omitted.
 * Works on single records and arrays. Never mutates input.
 */
export function pickFields(data: unknown, fields?: string[]): unknown {
  if (!fields || fields.length === 0) return data
  if (data == null) return data
  if (Array.isArray(data)) return data.map((item) => pickFields(item, fields))
  if (typeof data !== 'object') return data

  const record = data as Record<string, unknown>
  const result: Record<string, unknown> = {}
  if ('id' in record) result.id = record.id
  for (const key of fields) {
    if (key in record) result[key] = record[key]
  }
  return result
}

/**
 * Format MCP tool response.
 */
export function formatToolResponse(data: unknown, isError: boolean = false): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError
  }
}

/**
 * Format MCP error response.
 */
export function formatErrorResponse(message: string, status: number = 500): ToolResponse {
  return formatToolResponse({ error: message, status }, true)
}

/**
 * Coerce a value to an object, parsing JSON strings if necessary.
 *
 * ## Why This Is Needed
 *
 * LLMs sometimes pass object parameters as JSON strings instead of actual objects.
 * This is a known behavior pattern where the model serializes the object to a string
 * before passing it to the tool, resulting in errors like:
 *
 *   "Invalid arguments: Expected object, received string"
 *
 * This commonly occurs with:
 * - Complex nested objects
 * - Parameters named "fields", "data", "attributes", "params"
 * - When the LLM is uncertain about the schema
 *
 * ## Usage
 *
 * ```typescript
 * async execute(args) {
 *   const fields = coerceToObject(args.fields)
 *   if (fields === null) {
 *     return this.formatError('fields must be a valid object or JSON string')
 *   }
 *   // ... use fields safely as an object
 * }
 * ```
 */
export function coerceToObject(value: unknown): Record<string, unknown> | null {
  // Already an object (but not null or array)
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  // Try to parse JSON string
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      // Ensure parsed result is an object (not array or primitive)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Invalid JSON, fall through to return null
    }
  }

  // Undefined, null, array, or unparseable - return null
  return null
}

/**
 * Detect parent resource from attributes for nested resource creation.
 * Scans attributes for _link or _id fields matching known parent types.
 *
 * Note: may mutate `attributes` by removing `_id` keys.
 */
export function detectParentResource(
  attributes: Record<string, unknown>,
  parentTypes: ParentType[]
): ParentResource | null {
  for (const { model, endpoint } of parentTypes) {
    const linkAttr = `${model}_link`
    const idAttr = `${model}_id`

    // Check for link attribute (e.g., title_link)
    if (attributes[linkAttr]) {
      const linkValue = String(attributes[linkAttr])
      const match = linkValue.match(new RegExp(`${endpoint}/(\\d+)`))
      if (match) {
        return { id: match[1]!, model }
      }
    }

    // Check for ID attribute (e.g., title_id)
    if (attributes[idAttr]) {
      const parentId = String(attributes[idAttr])
      // Remove the ID attribute as it's not part of the API payload
      delete attributes[idAttr]
      return { id: parentId, model }
    }
  }

  return null
}

/**
 * Build parent types array from a models registry.
 * Scans all models for nestedCreation.parentModels to discover which models
 * serve as parents, eliminating the need for a hardcoded PARENT_TYPES constant.
 */
export function buildParentTypes(models: Record<string, ModelConfig>): ParentType[] {
  const parentMap = new Map<string, ParentType>()

  for (const config of Object.values(models)) {
    const nested = config.api?.nested
    if (!nested?.parent) continue

    const parentModels = Array.isArray(nested.parent) ? nested.parent : [nested.parent]
    for (const parentModelName of parentModels) {
      if (parentMap.has(parentModelName)) continue

      const parentConfig = models[parentModelName]
      if (parentConfig) {
        parentMap.set(parentModelName, {
          model: parentModelName,
          endpoint: parentConfig.endpoint
        })
      }
    }
  }

  return Array.from(parentMap.values())
}
