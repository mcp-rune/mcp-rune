/**
 * Fail-fast schema validation for models, forms, and prompts.
 *
 * The consuming server calls `validateRegistries({ models, forms, prompts })`
 * during boot (typically inside a `StartupTracker.phase()`). On any errors,
 * it throws `SchemaValidationError` with a structured report — the tracker
 * surfaces the error and the server refuses to start. This catches typos
 * like `type: 'datetimme'` or missing `enumValues` before they reach the
 * UI as a silent text-input fallback.
 *
 * Pure functions only — no I/O, no logger calls. Errors and warnings are
 * returned as data structures; the caller decides how to render them.
 *
 * See `docs/guides/schema-validation.md` (TODO) for the doctor CLI surface.
 */

import type { AttributeDefinition } from '#src/core/base-model.js'
import { KIND_REGISTRY } from '#src/core/kind-metadata.js'
import { closestMatch } from '#src/core/suggestions.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export type IssueLevel = 'error' | 'warning'
export type IssueScope = 'model' | 'attribute' | 'association' | 'form' | 'prompt'

export interface Issue {
  level: IssueLevel
  scope: IssueScope
  model: string
  attribute?: string
  message: string
  hint?: string
}

export interface ValidationReport {
  errors: Issue[]
  warnings: Issue[]
}

/**
 * Thrown when `validateRegistries` produces any `error`-level issue.
 * The `report` carries the structured issues; `message` is a pre-formatted
 * multi-line block suitable for surfacing in logs / CI output.
 */
export class SchemaValidationError extends Error {
  readonly report: ValidationReport
  constructor(report: ValidationReport) {
    super(formatReport(report))
    this.name = 'SchemaValidationError'
    this.report = report
  }
}

// Minimal structural shapes — we accept anything that matches these and
// validate the rest. Keeping these decoupled from the concrete BaseModel /
// BasePrompt / BaseForm types lets the validator work on raw JS classes
// without a full TS bridge.

interface ModelClassLike {
  modelName?: string
  api?: { endpoint?: string }
  attributes?: Record<string, AttributeDefinition>
  associations?: {
    belongsTo?: Record<string, { target_model?: string }>
    hasMany?: Record<string, { target_model?: string }>
  }
}

interface FormClassLike {
  fields?: string[]
  fieldsets?: Record<string, { fields?: string[] }>
}

interface PromptClassLike {
  fieldGroups?: Record<string, { fields: string[] }>
  sections?: Record<string, { groups?: string[] }>
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RegistriesInput {
  /** Plain map of model name → ModelClass, matching how engineer-mcp exports MODEL_CLASSES. */
  models: Record<string, ModelClassLike>
  /** Optional map of model name → FormClass. */
  forms?: Record<string, FormClassLike>
  /** Optional map of model name → PromptClass. */
  prompts?: Record<string, PromptClassLike>
}

/**
 * Run every available check across the registries and return a
 * `{ errors, warnings }` report. Does NOT throw — callers decide the
 * policy (e.g. throw on errors, log warnings).
 */
export function validateRegistries(input: RegistriesInput): ValidationReport {
  const errors: Issue[] = []
  const warnings: Issue[] = []

  const modelNames = Object.keys(input.models)

  for (const [name, ModelClass] of Object.entries(input.models)) {
    const issues = validateModelClass(name, ModelClass, modelNames)
    push(issues, errors, warnings)
  }

  if (input.forms) {
    for (const [modelName, FormClass] of Object.entries(input.forms)) {
      const ModelClass = input.models[modelName]
      if (!ModelClass) {
        errors.push({
          level: 'error',
          scope: 'form',
          model: modelName,
          message: `FormClass for "${modelName}" references a model that is not in MODEL_CLASSES.`,
          hint: `Known models: ${modelNames.join(', ')}`
        })
        continue
      }
      const issues = validateFormClass(modelName, FormClass, ModelClass)
      push(issues, errors, warnings)
    }
  }

  if (input.prompts) {
    for (const [modelName, PromptClass] of Object.entries(input.prompts)) {
      const ModelClass = input.models[modelName]
      if (!ModelClass) continue // already reported via forms or models
      const issues = validatePromptClass(modelName, PromptClass, ModelClass)
      push(issues, errors, warnings)
    }
  }

  return { errors, warnings }
}

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

/**
 * Validate a FormClass against its model. Each entry in `FormClass.fields`
 * and `fieldsets[*].fields` must name an attribute or an association on the
 * model (associations contribute `<name>_id` for belongsTo, `<name>_ids` for
 * hasMany — and association-link forms also accept `<name>_link`).
 */
export function validateFormClass(
  modelName: string,
  FormClass: FormClassLike,
  ModelClass: ModelClassLike
): Issue[] {
  const issues: Issue[] = []
  const validNames = collectValidFieldNames(ModelClass)
  const declared = new Set(FormClass.fields ?? [])

  for (const fieldName of FormClass.fields ?? []) {
    if (!validNames.has(fieldName)) {
      const suggestion = closestMatch(fieldName, validNames)
      issues.push({
        level: 'error',
        scope: 'form',
        model: modelName,
        attribute: fieldName,
        message: `FormClass.fields references unknown attribute "${fieldName}" on ${modelName}`,
        hint: suggestion
          ? `did you mean "${suggestion}"?`
          : `Known attributes: ${[...validNames].join(', ')}`
      })
    }
  }

  for (const [fsKey, fs] of Object.entries(FormClass.fieldsets ?? {})) {
    for (const fieldName of fs.fields ?? []) {
      if (!declared.has(fieldName)) {
        issues.push({
          level: 'error',
          scope: 'form',
          model: modelName,
          attribute: fieldName,
          message: `fieldsets["${fsKey}"] references "${fieldName}" which is not in FormClass.fields`,
          hint: 'every name in a fieldset must also appear in the top-level fields array'
        })
      }
    }
  }

  return issues
}

/**
 * Validate a PromptClass: every fieldGroups[*].fields entry must resolve to
 * an attribute on the model, and every sections[*].groups entry must name a
 * fieldGroup key.
 */
export function validatePromptClass(
  modelName: string,
  PromptClass: PromptClassLike,
  ModelClass: ModelClassLike
): Issue[] {
  const issues: Issue[] = []
  const validNames = collectValidFieldNames(ModelClass)
  const groupKeys = new Set(Object.keys(PromptClass.fieldGroups ?? {}))

  for (const [gKey, group] of Object.entries(PromptClass.fieldGroups ?? {})) {
    for (const fieldName of group.fields ?? []) {
      if (!validNames.has(fieldName)) {
        const suggestion = closestMatch(fieldName, validNames)
        issues.push({
          level: 'error',
          scope: 'prompt',
          model: modelName,
          attribute: fieldName,
          message: `fieldGroups["${gKey}"].fields references unknown attribute "${fieldName}" on ${modelName}`,
          hint: suggestion
            ? `did you mean "${suggestion}"?`
            : `Known attributes: ${[...validNames].join(', ')}`
        })
      }
    }
  }

  for (const [sKey, section] of Object.entries(PromptClass.sections ?? {})) {
    for (const groupName of section.groups ?? []) {
      if (!groupKeys.has(groupName)) {
        const suggestion = closestMatch(groupName, groupKeys)
        issues.push({
          level: 'error',
          scope: 'prompt',
          model: modelName,
          message: `sections["${sKey}"].groups references unknown fieldGroup "${groupName}"`,
          hint: suggestion
            ? `did you mean "${suggestion}"?`
            : `Known groups: ${[...groupKeys].join(', ')}`
        })
      }
    }
  }

  return issues
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function collectValidFieldNames(ModelClass: ModelClassLike): Set<string> {
  const names = new Set<string>(Object.keys(ModelClass.attributes ?? {}))
  // belongsTo: `<name>_id` and `<name>_link` are both legal form field names.
  for (const assocName of Object.keys(ModelClass.associations?.belongsTo ?? {})) {
    names.add(`${assocName}_id`)
    names.add(`${assocName}_link`)
  }
  // hasMany convention (mirrors form-schema.ts `buildField`): the assoc
  // name is the plural rel (`tags`), and the form field is the singular
  // `_ids` form (`tag_ids`). We accept both forms plus the bare rel name.
  for (const assocName of Object.keys(ModelClass.associations?.hasMany ?? {})) {
    names.add(assocName) // rel name (e.g. `tags`)
    names.add(`${assocName}_ids`) // pluralised _ids (e.g. `tags_ids`)
    names.add(`${assocName}_links`)
    if (assocName.endsWith('s')) {
      const singular = assocName.slice(0, -1)
      names.add(`${singular}_ids`) // singular _ids (e.g. `tag_ids`)
      names.add(`${singular}_links`)
    }
  }
  return names
}

function push(issues: Issue[], errors: Issue[], warnings: Issue[]): void {
  for (const i of issues) {
    if (i.level === 'error') errors.push(i)
    else warnings.push(i)
  }
}

/**
 * Render a `ValidationReport` as a multi-line string suitable for logs or
 * CI output. Errors first, then warnings, both grouped by model.
 */
export function formatReport(report: ValidationReport): string {
  const lines: string[] = []
  if (report.errors.length > 0) {
    lines.push(`Schema validation failed with ${report.errors.length} error(s):`)
    lines.push(...formatIssues(report.errors))
  }
  if (report.warnings.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`Schema validation produced ${report.warnings.length} warning(s):`)
    lines.push(...formatIssues(report.warnings))
  }
  return lines.join('\n')
}

function formatIssues(issues: Issue[]): string[] {
  const lines: string[] = []
  const byModel = new Map<string, Issue[]>()
  for (const i of issues) {
    const arr = byModel.get(i.model) ?? []
    arr.push(i)
    byModel.set(i.model, arr)
  }
  for (const [model, list] of byModel) {
    lines.push(`  ${model}:`)
    for (const issue of list) {
      const ref = issue.attribute ? `${issue.scope}.${issue.attribute}` : issue.scope
      lines.push(`    [${ref}] ${issue.message}`)
      if (issue.hint) lines.push(`      hint: ${issue.hint}`)
    }
  }
  return lines
}
