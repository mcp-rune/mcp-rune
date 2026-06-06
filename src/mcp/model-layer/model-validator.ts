/**
 * Model Validator — schema-time checks on a Model class's `static attributes`
 * and `static associations`. Run at boot so a malformed declaration fails
 * loudly before any tool/app/prompt touches it.
 *
 *   class Book extends BaseModel {
 *     static attributes = {
 *       title:  { type: 'string',  required: true },             // ✓ kind registered
 *       rating: { type: 'integer', format: 'rating', max: 5 },   // ✓ kind:format registered
 *       cover:  { type: 'avatar' }                               // ✗ Issue: unknown kind
 *     }
 *     static associations = {
 *       belongsTo: { author: { target_model: 'authour' } }       // ✗ Issue: target_model not in registry
 *     }
 *   }
 *
 * `validateModelClass(name, ModelClass, allModelNames)` returns an `Issue[]`
 * listing every problem with severity + path. Pure functions only — no I/O,
 * no logger calls. The caller (`validateRegistries`) aggregates and surfaces
 * them. Reached through `modelLayer.validate(...)` (record-level) and
 * `validateRegistries` (boot-level) after PR2.
 */

import '#src/mcp/models/kinds/index.js'

import { closestMatch } from '#src/core/suggestions.js'
import type { AttributeDefinition } from '#src/mcp/models/base-model.js'
import { KIND_REGISTRY } from '#src/mcp/models/kinds/registry.js'
import type { Issue, ModelClassLike } from '#src/mcp/schema/types.js'

/**
 * Validate every attribute + association on a single model class.
 */
export function validateModelClass(
  modelName: string,
  ModelClass: ModelClassLike,
  allModelNames: readonly string[]
): Issue[] {
  const issues: Issue[] = []
  const attrs = ModelClass.attributes ?? {}

  for (const [attrName, attr] of Object.entries(attrs)) {
    issues.push(...validateAttributeDefinition(modelName, attrName, attr))
  }

  const belongsTo = ModelClass.associations?.belongsTo ?? {}
  for (const [assocName, assoc] of Object.entries(belongsTo)) {
    issues.push(...validateAssociation(modelName, assocName, assoc, allModelNames, 'belongsTo'))
  }
  const hasMany = ModelClass.associations?.hasMany ?? {}
  for (const [assocName, assoc] of Object.entries(hasMany)) {
    issues.push(...validateAssociation(modelName, assocName, assoc, allModelNames, 'hasMany'))
  }

  return issues
}

/**
 * Validate a single attribute definition.
 *
 * Rules:
 *   1. `attr.type` must be a registered kind (key in `KIND_REGISTRY`).
 *   2. `type: 'enum'` requires a non-empty `enumValues` array.
 *   3. `type: 'array'` with `enumValues` set must contain only primitive values.
 *   4. `attr.format`, if set, should resolve via `kind:format` or as a top-level kind.
 */
export function validateAttributeDefinition(
  modelName: string,
  attrName: string,
  attr: AttributeDefinition
): Issue[] {
  const issues: Issue[] = []
  const kinds = Array.from(KIND_REGISTRY.keys()).filter((k) => !k.includes(':'))

  // Rule 1: type must be registered.
  if (!attr.type || !KIND_REGISTRY.has(attr.type.toLowerCase())) {
    const suggestion = attr.type ? closestMatch(attr.type, kinds) : null
    issues.push({
      level: 'error',
      scope: 'attribute',
      model: modelName,
      attribute: attrName,
      message: attr.type
        ? `attribute "${attrName}" has unknown type "${attr.type}"`
        : `attribute "${attrName}" is missing required field "type"`,
      hint: suggestion
        ? `did you mean "${suggestion}"? Registered kinds: ${kinds.join(', ')}`
        : `Registered kinds: ${kinds.join(', ')}`
    })
    return issues // Skip downstream checks if the type itself is invalid.
  }

  // Rule 2: enum requires enumValues.
  if (attr.type === 'enum') {
    if (!Array.isArray(attr.enumValues) || attr.enumValues.length === 0) {
      issues.push({
        level: 'error',
        scope: 'attribute',
        model: modelName,
        attribute: attrName,
        message: `attribute "${attrName}" has type "enum" but no enumValues`,
        hint: 'enum attributes require a non-empty enumValues: ["value1", "value2", ...] array'
      })
    }
  }

  // Rule 3: array + enumValues entries must be primitive.
  if (attr.type === 'array' && Array.isArray(attr.enumValues)) {
    const nonPrimitive = attr.enumValues.find((v) => typeof v === 'object' && v !== null)
    if (nonPrimitive !== undefined) {
      issues.push({
        level: 'error',
        scope: 'attribute',
        model: modelName,
        attribute: attrName,
        message: `attribute "${attrName}" has type "array" with non-primitive enumValues entry`,
        hint: 'enumValues entries must be strings, numbers, or booleans'
      })
    }
  }

  // Rule 4: format probe. Warn when the format LOOKS like a type narrowing
  // (single bare identifier — e.g. "url", "isbn", "iso8601") but doesn't
  // resolve to a registered renderer. Free-form prose like "ISO 8601" or
  // "Hex color (#RRGGBB)" — anything with a space or punctuation — is
  // treated as documentation and skipped. That keeps the doctor's signal
  // sharp; type narrowings that the user clearly intended to register are
  // surfaced, while descriptive notes don't generate noise.
  if (attr.format && /^[a-z0-9_-]+$/i.test(attr.format)) {
    const k = attr.type.toLowerCase()
    const f = attr.format.toLowerCase()
    const formatResolves = KIND_REGISTRY.has(`${k}:${f}`) || KIND_REGISTRY.has(f)
    if (!formatResolves) {
      issues.push({
        level: 'warning',
        scope: 'attribute',
        model: modelName,
        attribute: attrName,
        message: `attribute "${attrName}" has format "${attr.format}" that does not resolve to a registered renderer`,
        hint: `Tried kind:format ("${k}:${f}") and bare format ("${f}"). The form will fall back to the bare-kind renderer ("${k}"). If "${attr.format}" is just documentation, prose with a space (e.g. "${attr.format} format") is silently accepted.`
      })
    }
  }

  return issues
}

/**
 * Validate that an association's `target_model` resolves to a known model.
 */
export function validateAssociation(
  modelName: string,
  assocName: string,
  assoc: { target_model?: string },
  allModelNames: readonly string[],
  kind: 'belongsTo' | 'hasMany'
): Issue[] {
  const issues: Issue[] = []
  if (!assoc.target_model) {
    issues.push({
      level: 'error',
      scope: 'association',
      model: modelName,
      attribute: assocName,
      message: `${kind} association "${assocName}" is missing target_model`,
      hint: 'each association must declare { rel, target_model }'
    })
    return issues
  }
  if (!allModelNames.includes(assoc.target_model)) {
    const suggestion = closestMatch(assoc.target_model, allModelNames)
    issues.push({
      level: 'error',
      scope: 'association',
      model: modelName,
      attribute: assocName,
      message: `${kind} association "${assocName}" → unknown target_model "${assoc.target_model}"`,
      hint: suggestion
        ? `did you mean "${suggestion}"? Known models: ${allModelNames.join(', ')}`
        : `Known models: ${allModelNames.join(', ')}`
    })
  }
  return issues
}
