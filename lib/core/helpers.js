/**
 * Common helper functions for MCP servers
 */

/**
 * Truncate a string to a maximum length
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
export function truncateString(str, maxLength = 1000) {
  if (!str || str.length <= maxLength) return str
  return (
    str.substring(0, maxLength) + `\n\n... [TRUNCATED - ${str.length - maxLength} more characters]`
  )
}

/**
 * Sanitize response data for MCP output.
 * Returns a JSON string for safe display. Handles arrays by showing a sample.
 * @param {*} data - Response data
 * @param {number} maxSize - Maximum size in characters
 * @returns {string} JSON string (possibly truncated)
 */
export function sanitizeResponseData(data, maxSize = 50000) {
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
 * @param {Object|Array} data - API response data
 * @param {string[]} [fields] - Field names to keep. Omit for all fields.
 * @returns {Object|Array} Filtered data
 */
export function pickFields(data, fields) {
  if (!fields || fields.length === 0) return data
  if (data == null) return data
  if (Array.isArray(data)) return data.map((item) => pickFields(item, fields))
  if (typeof data !== 'object') return data

  const result = {}
  if ('id' in data) result.id = data.id
  for (const key of fields) {
    if (key in data) result[key] = data[key]
  }
  return result
}

/**
 * Format MCP tool response
 * @param {Object} data - Response data
 * @param {boolean} isError - Whether this is an error response
 * @returns {Object} MCP formatted response
 */
export function formatToolResponse(data, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError
  }
}

/**
 * Format MCP error response
 * @param {string} message - Error message
 * @param {number} status - HTTP status code
 * @returns {Object} MCP formatted error response
 */
export function formatErrorResponse(message, status = 500) {
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
 * ```javascript
 * async execute(args) {
 *   const fields = coerceToObject(args.fields)
 *   if (fields === null) {
 *     return this.formatError('fields must be a valid object or JSON string')
 *   }
 *   // ... use fields safely as an object
 * }
 * ```
 *
 * @param {*} value - The value to coerce (object, JSON string, or other)
 * @returns {Object|null} The parsed object, or null if parsing failed
 */
export function coerceToObject(value) {
  // Already an object (but not null or array)
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  // Try to parse JSON string
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      // Ensure parsed result is an object (not array or primitive)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
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
 * @param {Object} attributes - Attributes object to search (may be mutated: _id attrs are removed)
 * @param {Array<{model: string, endpoint: string}>} parentTypes - Parent type configurations
 * @returns {{id: string, model: string}|null} Detected parent info or null
 */
export function detectParentResource(attributes, parentTypes) {
  for (const { model, endpoint } of parentTypes) {
    const linkAttr = `${model}_link`
    const idAttr = `${model}_id`

    // Check for link attribute (e.g., title_link)
    if (attributes[linkAttr]) {
      const match = attributes[linkAttr].match(new RegExp(`${endpoint}/(\\d+)`))
      if (match) {
        return { id: match[1], model }
      }
    }

    // Check for ID attribute (e.g., title_id)
    if (attributes[idAttr]) {
      const parentId = attributes[idAttr]
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
 *
 * @param {Object} models - Models registry (model name → config)
 * @returns {Array<{model: string, endpoint: string}>} Parent type configurations
 */
export function buildParentTypes(models) {
  const parentMap = new Map()

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
