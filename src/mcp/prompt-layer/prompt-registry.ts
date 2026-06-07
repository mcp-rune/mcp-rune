/**
 * PromptRegistry — canonical interface and a minimal concrete implementation
 * for the framework's prompt surface.
 *
 * The framework consumes a `PromptRegistry` in three places: tool descriptions
 * (`SaveModelBaseTool` queries `getRequiredPromptRestrictions` /
 * `getBulkRecommendations` / `getPromptRequiredModels` / `getPromptNameByModel`
 * to enrich tool docs), MCP server registration (`createServer` calls
 * `getDefinitions` and `getPrompt`), and the optional `PromptCache` wrapper
 * (delegates a wider surface). Until now each consumer redeclared the shape
 * locally as a duck-typed interface — four interfaces that did not agree.
 *
 * This file is the single source of truth.
 *
 * Deployers either implement `PromptRegistry` directly (any shape goes —
 * keep it as small as your server needs) or extend `BasePromptRegistry` for
 * the standard register-by-name pattern with collision detection.
 */

import type { BasePrompt } from '../prompts/base-prompt.js'

/**
 * Handle for a prompt — the class itself, carrying both its constructor and
 * its statics (`fieldDefinitions`, `fieldGroups`, `sections`, …). Consumers
 * read statics for completion and tool-doc derivation; the registry calls
 * `new()` for `getPrompt()`.
 */
export type PromptClass = typeof BasePrompt

/** Definition surfaced via `getDefinitions()`, mapped onto MCP `prompts/list` entries. */
export interface PromptDefinition {
  name: string
  description?: string
  required?: boolean
  [key: string]: unknown
}

/** Content returned by `getPrompt(name)`, passed back to the MCP server. */
export interface PromptResult {
  description: string
  messages: unknown[]
}

/**
 * The canonical PromptRegistry interface.
 *
 * Required methods are consumed unconditionally by the framework. Optional
 * methods are consumed via runtime feature-detect (`typeof method === 'function'`)
 * and exist so deployers can enrich tool descriptions, expose cache stats, or
 * back `PromptCache` without being forced to implement every hook.
 */
export interface PromptRegistry {
  /** Required: list prompt definitions for MCP `prompts/list`. */
  getDefinitions(): PromptDefinition[]

  /** Required: resolve a prompt by name for MCP `prompts/get`. */
  getPrompt(name: string, args?: Record<string, unknown>): PromptResult

  /** Required: look up a prompt class by name (used for completion / field metadata). */
  getPromptClass(name: string): PromptClass | null

  /** Optional: expose cache stats to `/health` and `/cache-stats`. */
  getStats?(): Record<string, unknown>

  /** Optional: feature-detected by `SaveModelBaseTool` to enrich tool descriptions. */
  getPromptNameByModel?(model: string): string | null
  getPromptClassByModel?(model: string): PromptClass | null
  getPromptRequiredModels?(): string[]
  getRequiredPromptRestrictions?(): string | null
  getBulkRecommendations?(): string | null

  /** Optional: consumed by `PromptCache` delegation when the cache wraps this registry. */
  getAllPromptNames?(): string[]
  getRequiredPrompts?(): unknown[]
  getPromptMap?(): Record<string, unknown>
  getToolDocDescriptionList?(): string
  getBulkRecommendedPrompts?(): unknown[]
  getFormSchema?(promptName: string): Record<string, unknown>

  /** Optional: consumed by `GetPromptGuideTool` for deployer-specific instance construction. */
  getPromptInstance?(
    name: string,
    args: Record<string, string>
  ): { promptContent: string; description: string } | null
  getUnknownPromptError?(name: string): string
}

/** Options for `BasePromptRegistry.register`. */
export interface RegisterOptions {
  /** Definition fields surfaced via `getDefinitions()`. */
  description?: string
  required?: boolean
  /** Model this prompt is associated with — populates `getPromptByModel` lookups. */
  model?: string
  /** Identifier of the contributor (an extension key, or `<built-in>`) for collision diagnostics. */
  ownerKey?: string
}

const BUILT_IN_OWNER = '<built-in>'

interface RegistryEntry {
  promptClass: PromptClass
  description?: string
  required?: boolean
  model?: string
}

/**
 * BasePromptRegistry — a minimal concrete `PromptRegistry` with
 * name-based registration and fail-fast collision detection.
 *
 * Mirrors the shape of `SummaryStrategyRegistry`: names are globally unique,
 * duplicates throw at registration with both contributor keys in the error.
 *
 * Deployers with bespoke prompt-lookup logic (dynamic prompts, multi-source
 * registries, custom enrichment for `SaveModelBaseTool`) implement
 * `PromptRegistry` directly instead.
 */
export class BasePromptRegistry implements PromptRegistry {
  private readonly _entries = new Map<string, RegistryEntry>()
  private readonly _owners = new Map<string, string>()
  private readonly _modelToName = new Map<string, string>()

  register(name: string, promptClass: PromptClass, options: RegisterOptions = {}): void {
    const ownerKey = options.ownerKey ?? BUILT_IN_OWNER
    const existingOwner = this._owners.get(name)
    if (existingOwner !== undefined) {
      throw new Error(
        `Prompt "${name}" attempted by "${ownerKey}" is already registered by ` +
          `"${existingOwner}". Prompt names must be globally unique.`
      )
    }
    this._entries.set(name, {
      promptClass,
      description: options.description,
      required: options.required,
      model: options.model
    })
    this._owners.set(name, ownerKey)
    if (options.model !== undefined) {
      const existingModelName = this._modelToName.get(options.model)
      if (existingModelName !== undefined) {
        throw new Error(
          `Model "${options.model}" already has prompt "${existingModelName}"; ` +
            `cannot also bind to "${name}" (from "${ownerKey}").`
        )
      }
      this._modelToName.set(options.model, name)
    }
  }

  getDefinitions(): PromptDefinition[] {
    return [...this._entries.entries()].map(([name, entry]) => {
      const def: PromptDefinition = { name }
      if (entry.description !== undefined) def.description = entry.description
      if (entry.required !== undefined) def.required = entry.required
      return def
    })
  }

  getPrompt(name: string, _args?: Record<string, unknown>): PromptResult {
    const entry = this._entries.get(name)
    if (!entry) {
      throw new Error(`Prompt "${name}" not found in registry.`)
    }
    const instance = new entry.promptClass()
    const content = instance.promptContent
    return {
      description: instance.description ?? entry.description ?? '',
      messages:
        typeof content === 'string'
          ? [{ role: 'user', content: { type: 'text', text: content } }]
          : Array.isArray(content)
            ? content
            : []
    }
  }

  getPromptClass(name: string): PromptClass | null {
    return this._entries.get(name)?.promptClass ?? null
  }

  getAllPromptNames(): string[] {
    return [...this._entries.keys()]
  }

  getPromptNameByModel(model: string): string | null {
    return this._modelToName.get(model) ?? null
  }

  getPromptClassByModel(model: string): PromptClass | null {
    const name = this._modelToName.get(model)
    return name ? (this._entries.get(name)?.promptClass ?? null) : null
  }

  /** @internal — for diagnostic logging. */
  ownerOf(name: string): string | undefined {
    return this._owners.get(name)
  }

  // ===========================================================================
  // Optional PromptRegistry methods — implemented with sensible defaults so
  // BasePromptRegistry can be passed directly to `createPromptCache` and other
  // consumers that previously required a hand-rolled custom registry.
  // ===========================================================================

  getRequiredPrompts(): Array<[string, RegistryEntry]> {
    return [...this._entries.entries()].filter(([, entry]) => entry.required === true)
  }

  getPromptRequiredModels(): string[] {
    return this.getRequiredPrompts()
      .map(([, entry]) => entry.model)
      .filter((m): m is string => typeof m === 'string')
  }

  getPromptMap(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const [name, entry] of this._entries) {
      if (entry.model !== undefined) map[entry.model] = name
    }
    return map
  }

  getToolDocDescriptionList(): string {
    return [...this._entries.entries()]
      .map(([name, entry]) => `- "${name}" - ${entry.description ?? ''}`)
      .join('\n')
  }

  getRequiredPromptRestrictions(): string | null {
    const required = this.getRequiredPrompts()
    if (required.length === 0) return null
    return required
      .map(
        ([name, entry]) =>
          `- "${entry.model ?? name}" - First call get_prompt_guide(guide_name: "${name}")`
      )
      .join('\n')
  }

  getBulkRecommendedPrompts(): Array<[string, RegistryEntry]> {
    // Default implementation: no prompts marked as bulk-recommended. Subclasses
    // override to surface model-specific bulk-creation patterns.
    return []
  }

  getBulkRecommendations(): string | null {
    return null
  }

  getFormSchema(name: string): Record<string, unknown> {
    const entry = this._entries.get(name)
    if (!entry) {
      throw new Error(`Unknown prompt: ${name}`)
    }
    const promptClass = entry.promptClass as PromptClass & {
      toFormSchema?: () => Record<string, unknown>
    }
    if (typeof promptClass.toFormSchema !== 'function') {
      throw new Error(
        `Prompt "${name}" does not implement toFormSchema(). Override BasePromptRegistry.getFormSchema to provide one.`
      )
    }
    const schema = promptClass.toFormSchema() as unknown as Record<string, unknown>
    if (entry.model !== undefined) schema.modelName = entry.model
    return schema
  }
}
