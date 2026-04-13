/**
 * Schema-Driven Configuration Loader
 *
 * Walks a declarative schema tree, resolves env vars, applies type coercion,
 * validates format constraints, collects ALL errors (instead of failing on
 * the first), and returns a deeply frozen config object with a toString()
 * method that masks sensitive values.
 *
 * Schema leaf descriptor shape:
 * {
 *   env: 'ENV_VAR_NAME',       // required — which env var to read
 *   type: 'string',            // 'string' (default) | 'integer' | 'boolean'
 *   default: 'value',          // optional default
 *   required: true,            // optional — push error if missing
 *   sensitive: true,           // optional — mask in toString()
 *   format: ['a', 'b', 'c'],  // optional — enum validation
 *   doc: 'Description'         // optional — for documentation/diagnostics
 * }
 */

/**
 * Determine whether a schema node is a leaf descriptor (has `env` key)
 * or a branch (nested object of descriptors).
 * @param {Object} node
 * @returns {boolean}
 */
function isLeaf(node) {
  return node !== null && typeof node === 'object' && 'env' in node
}

/**
 * Resolve a single leaf descriptor into a config value.
 * Pushes errors into `errors` instead of throwing.
 *
 * @param {Object} descriptor - Leaf descriptor
 * @param {Array<string>} errors - Accumulator for validation errors
 * @param {string} path - Dotted path for error messages (e.g., 'api.url')
 * @returns {*} Resolved and coerced value (or undefined on error)
 */
function resolveField(descriptor, errors, path) {
  const { env, type = 'string', required = false, format } = descriptor
  const hasDefault = 'default' in descriptor
  const raw = process.env[env]
  const isEmpty = raw === undefined || raw === ''

  // Missing value handling
  if (isEmpty) {
    if (hasDefault) return descriptor.default
    if (required) {
      const doc = descriptor.doc ? ` (${descriptor.doc})` : ''
      errors.push(`${path}: missing required env var ${env}${doc}`)
    }
    return undefined
  }

  // Type coercion
  let value
  switch (type) {
    case 'integer': {
      const parsed = parseInt(raw, 10)
      if (isNaN(parsed)) {
        errors.push(`${path}: env var ${env} must be an integer, got "${raw}"`)
        return undefined
      }
      value = parsed
      break
    }
    case 'boolean':
      value = raw === 'true' || raw === '1'
      break
    case 'string':
    default:
      value = raw
      break
  }

  // Format/enum validation
  if (format && Array.isArray(format) && format.length > 0) {
    if (!format.includes(value)) {
      errors.push(`${path}: env var ${env} must be one of [${format.join(', ')}], got "${value}"`)
      return undefined
    }
  }

  return value
}

/**
 * Recursively freeze an object and all nested objects.
 * @param {Object} obj
 * @returns {Object} The same object, deeply frozen
 */
function deepFreeze(obj) {
  Object.freeze(obj)
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value)
    }
  }
  return obj
}

/**
 * Recursively walk the schema tree and resolve all leaf descriptors.
 * @param {Object} schema - Schema tree (branches + leaves)
 * @param {Array<string>} errors - Error accumulator
 * @param {string} prefix - Current dotted path prefix
 * @returns {Object} Resolved config tree
 */
function resolveTree(schema, errors, prefix = '') {
  const result = {}
  for (const [key, node] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isLeaf(node)) {
      result[key] = resolveField(node, errors, path)
    } else if (node !== null && typeof node === 'object') {
      result[key] = resolveTree(node, errors, path)
    }
  }
  return result
}

/**
 * Format a config object as a human-readable multi-line string.
 * Masks sensitive values with '***'. Annotates defaults.
 *
 * @param {Object} config - Resolved config tree
 * @param {Object} schema - Original schema tree
 * @param {string} prefix - Current dotted path prefix
 * @returns {string[]} Lines of formatted output
 */
function formatLines(config, schema, prefix = '') {
  const lines = []
  for (const [key, node] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isLeaf(node)) {
      const value = config[key]
      const isSensitive = node.sensitive === true
      const hasDefault = 'default' in node
      const raw = process.env[node.env]
      const isEmpty = raw === undefined || raw === ''
      const usedDefault = isEmpty && hasDefault

      let display
      if (value === undefined) {
        display = '(not set)'
      } else if (isSensitive) {
        display = '***'
      } else {
        display = String(value)
      }

      const suffix = usedDefault ? ' (default)' : ''
      lines.push(`  ${path}: ${display}${suffix}`)
    } else if (node !== null && typeof node === 'object') {
      lines.push(...formatLines(config[key] || {}, node, path))
    }
  }
  return lines
}

/**
 * Load and validate configuration from environment variables using a
 * declarative schema.
 *
 * @param {Object} schema - Schema tree with leaf descriptors
 * @returns {Object} Deeply frozen config object with toString() method
 * @throws {Error} If any validation errors were collected
 */
export function loadConfig(schema) {
  const errors = []
  const config = resolveTree(schema, errors)

  if (errors.length > 0) {
    const message = [
      `Configuration errors (${errors.length}):`,
      ...errors.map((e) => `  - ${e}`)
    ].join('\n')
    throw new Error(message)
  }

  // Attach toString() that produces masked, human-readable output
  // Store schema reference in a non-enumerable property
  Object.defineProperty(config, '_schema', {
    value: schema,
    enumerable: false,
    writable: false,
    configurable: false
  })

  Object.defineProperty(config, 'toString', {
    value: function () {
      const lines = formatLines(this, this._schema)
      return ['Configuration:', ...lines].join('\n')
    },
    enumerable: false,
    writable: false,
    configurable: false
  })

  return deepFreeze(config)
}
