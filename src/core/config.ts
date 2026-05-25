/**
 * Schema-Driven Configuration Loader
 *
 * Walks a declarative schema tree, resolves env vars, applies type coercion,
 * validates format constraints, collects ALL errors (instead of failing on
 * the first), and returns a deeply frozen config object with a toString()
 * method that masks sensitive values.
 */

/** Leaf descriptor for a single config value. */
export interface ConfigDescriptor {
  env: string
  type?: 'string' | 'integer' | 'boolean' | 'array'
  default?: string | number | boolean | string[]
  /** Only meaningful when type === 'array'. Defaults to ','. */
  separator?: string
  required?: boolean
  sensitive?: boolean
  /** For type 'array', validated per-item; otherwise against the scalar value. */
  format?: string[]
  doc?: string
}

/** Recursive schema: branches are nested objects, leaves are ConfigDescriptors. */
export interface ConfigSchema {
  [key: string]: ConfigDescriptor | ConfigSchema
}

/** Resolved config object with non-enumerable helpers. */
export interface Config {
  [key: string]: unknown
  toString(): string
}

/**
 * Determine whether a schema node is a leaf descriptor (has `env` key)
 * or a branch (nested object of descriptors).
 */
function isLeaf(node: ConfigDescriptor | ConfigSchema): node is ConfigDescriptor {
  return node !== null && typeof node === 'object' && 'env' in node
}

/**
 * Resolve a single leaf descriptor into a config value.
 * Pushes errors into `errors` instead of throwing.
 */
function resolveField(
  descriptor: ConfigDescriptor,
  errors: string[],
  path: string
): string | number | boolean | string[] | undefined {
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
  let value: string | number | boolean | string[]
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
    case 'array': {
      const separator = descriptor.separator ?? ','
      value = raw
        .split(separator)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      break
    }
    case 'string':
    default:
      value = raw
      break
  }

  // Format/enum validation
  if (format && Array.isArray(format) && format.length > 0) {
    if (Array.isArray(value)) {
      const bad = value.filter((it) => !format.includes(it))
      if (bad.length > 0) {
        errors.push(
          `${path}: env var ${env} contains invalid items [${bad.join(', ')}], allowed: [${format.join(', ')}]`
        )
        return undefined
      }
    } else if (!format.includes(value as string)) {
      errors.push(`${path}: env var ${env} must be one of [${format.join(', ')}], got "${value}"`)
      return undefined
    }
  }

  return value
}

/**
 * Recursively freeze an object and all nested objects.
 */
function deepFreeze<T extends Record<string, unknown>>(obj: T): T {
  Object.freeze(obj)
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as Record<string, unknown>)
    }
  }
  return obj
}

/**
 * Recursively walk the schema tree and resolve all leaf descriptors.
 */
function resolveTree(
  schema: ConfigSchema,
  errors: string[],
  prefix: string = ''
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, node] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isLeaf(node)) {
      result[key] = resolveField(node, errors, path)
    } else if (node !== null && typeof node === 'object') {
      result[key] = resolveTree(node as ConfigSchema, errors, path)
    }
  }
  return result
}

/**
 * Format a config object as a human-readable multi-line string.
 * Masks sensitive values with '***'. Annotates defaults.
 */
function formatLines(
  config: Record<string, unknown>,
  schema: ConfigSchema,
  prefix: string = ''
): string[] {
  const lines: string[] = []
  for (const [key, node] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isLeaf(node)) {
      const value = config[key]
      const isSensitive = node.sensitive === true
      const hasDefault = 'default' in node
      const raw = process.env[node.env]
      const isEmpty = raw === undefined || raw === ''
      const usedDefault = isEmpty && hasDefault

      const suffix = usedDefault ? ' (default)' : ''

      // YAML-style block rendering for non-empty, non-sensitive arrays:
      // each item on its own indented bullet line. Matches Spring Boot
      // Actuator / Rails / kubectl describe / YAML conventions.
      if (value !== undefined && !isSensitive && Array.isArray(value) && value.length > 0) {
        lines.push(`  ${path}:${suffix}`)
        for (const item of value) {
          lines.push(`    - ${item}`)
        }
        continue
      }

      let display: string
      if (value === undefined) {
        display = '(not set)'
      } else if (isSensitive) {
        display = '***'
      } else if (Array.isArray(value)) {
        // Empty array — render inline; non-empty arrays handled above.
        display = '[]'
      } else {
        display = String(value)
      }
      lines.push(`  ${path}: ${display}${suffix}`)
    } else if (node !== null && typeof node === 'object') {
      lines.push(
        ...formatLines((config[key] as Record<string, unknown>) || {}, node as ConfigSchema, path)
      )
    }
  }
  return lines
}

/**
 * Load and validate configuration from environment variables using a
 * declarative schema.
 *
 * Returns a deeply frozen config object with a `toString()` method
 * that masks sensitive values.
 *
 * @throws If any validation errors were collected
 */
export function loadConfig(schema: ConfigSchema): Config {
  const errors: string[] = []
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
    value: function (this: Record<string, unknown> & { _schema: ConfigSchema }) {
      const lines = formatLines(this, this._schema)
      return ['Configuration:', ...lines].join('\n')
    },
    enumerable: false,
    writable: false,
    configurable: false
  })

  return deepFreeze(config) as Config
}
