/**
 * BasePrompt — definition class for MCP prompts.
 *
 * Holds the static configuration that describes a prompt:
 *   - `strategy`         — stateless / hybrid / stateful
 *   - `sections`         — user-facing workflow structure
 *   - `fieldGroups`      — semantic groupings used by validation + extraction
 *   - `fieldDefinitions` — per-field schema, validation, completion
 *
 * Subclasses override these four static maps and a `get promptContent()`
 * getter that assembles the documentation via `PromptContentGenerator`
 * (see `./prompt-content-generator.ts`).
 *
 * The type vocabulary (`Section`, `FieldGroup`, `PromptFieldDefinition`, …)
 * lives in `./prompt-definitions.ts`. Rendering helpers live as pure
 * functions in `./generators/` and are reached through
 * `PromptContentGenerator`, not from this class.
 */

import type {
  FieldGroup,
  FormSchema,
  FormSchemaFieldDefinition,
  PromptFieldDefinition,
  Section,
  StrategyType
} from './prompt-definitions.js'

export class BasePrompt {
  /**
   * Assembled prompt content. Subclasses override with a getter that builds
   * the prompt using `PromptContentGenerator`. Returns an empty string by
   * default so the base class can be instantiated for inspection.
   */
  get promptContent(): string {
    return ''
  }

  /**
   * Optional per-instance description shown in `prompts/get` responses.
   * Falls back to the registry entry's description.
   */
  description?: string

  /** Strategy type for this prompt. Override in subclasses. */
  static strategy: StrategyType = 'stateless'

  /** Sections define the user-facing workflow structure. */
  static sections: Record<string, Section> = {}

  /** Field groups organized for validation and technical structure. */
  static fieldGroups: Record<string, FieldGroup> = {}

  /** Field definitions with validation and extraction hints. */
  static fieldDefinitions: Record<string, PromptFieldDefinition> = {}

  /** Get default values for all fields. */
  static getDefaults(): Record<string, unknown> {
    const defaults: Record<string, unknown> = {}
    for (const [fieldName, fieldDef] of Object.entries(this.fieldDefinitions)) {
      if (fieldDef.default !== undefined) {
        defaults[fieldName] = fieldDef.default
      }
    }
    return defaults
  }

  /**
   * Get default form state for the interactive form.
   * Subclasses may override to provide custom defaults.
   */
  getDefaultFormState(): Record<string, unknown> {
    return (this.constructor as typeof BasePrompt).getDefaults()
  }

  /**
   * Strategy-specific intro fragment used by subclasses when composing their
   * `static description`. Downstream consumers embed this as:
   *   `static description = `${MyPrompt.getStrategyIntro()} something.``
   */
  static getStrategyIntro(): string {
    switch (this.strategy) {
      case 'stateless':
        return 'Guide for creating'
      case 'hybrid':
        return 'Interactive guide for creating'
      case 'stateful':
        return 'REQUIRED interactive guided prompt for creating'
      default:
        return 'Guide for creating'
    }
  }

  /** Get section by group name (reverse lookup). */
  static getSectionForGroup(groupName: string): {
    name: string
    title: string
    description: string
    required: boolean
    groups: string[]
  } | null {
    for (const [sectionName, section] of Object.entries(this.sections)) {
      if (section.groups.includes(groupName)) {
        return { name: sectionName, ...section }
      }
    }
    return null
  }

  /** Generate technical summary (API attributes). */
  static generateTechnicalSummary(
    formState: Record<string, unknown>,
    context: { model?: string } = {}
  ): string {
    const attributes: Record<string, unknown> = {}

    for (const [fieldName, value] of Object.entries(formState)) {
      if (value !== undefined && value !== null && value !== '') {
        attributes[fieldName] = value
      }
    }

    return JSON.stringify(
      {
        model: context.model || 'unknown',
        attributes
      },
      null,
      2
    )
  }

  /**
   * Serialize prompt class metadata into a transport-safe form schema.
   * Used by the custom `prompts/getFormSchema` MCP handler.
   *
   * Handles:
   * - Converting RegExp validation.pattern to string
   * - Stripping function-type validators (server handles those via validate_form)
   * - Including completion config as-is (client uses it for autocomplete)
   */
  static toFormSchema(): FormSchema {
    const fieldDefinitions: Record<string, FormSchemaFieldDefinition> = {}
    for (const [fieldName, def] of Object.entries(this.fieldDefinitions || {})) {
      const fieldSchema: FormSchemaFieldDefinition = {
        type: def.type,
        required: !!def.required,
        description: def.description || ''
      }
      if (def.label) fieldSchema.label = def.label
      if (def.examples) fieldSchema.examples = def.examples
      if (def.enumValues) fieldSchema.enumValues = def.enumValues
      if (def.format) fieldSchema.format = def.format
      if (def.default !== undefined) fieldSchema.default = def.default
      if (def.completion) fieldSchema.completion = def.completion

      if (def.validation) {
        const validation: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(def.validation)) {
          if (val instanceof RegExp) {
            validation[key] = val.source
          } else if (typeof val !== 'function') {
            validation[key] = val
          }
        }
        if (Object.keys(validation).length > 0) {
          fieldSchema.validation = validation
        }
      }

      fieldDefinitions[fieldName] = fieldSchema
    }

    return {
      name: this.name,
      title: (this as unknown as { title?: string }).title || this.name,
      description: (this as unknown as { description?: string }).description || '',
      modelName: (this as unknown as { modelName?: string }).modelName || null,
      strategy: this.strategy || 'stateless',
      fieldDefinitions,
      fieldGroups: this.fieldGroups || {},
      sections: this.sections || {},
      defaults: this.getDefaults()
    }
  }
}
