/**
 * Base class for create/update model tools
 *
 * Provides shared functionality:
 * - getUsageRules() with prompt guide restrictions for complex models
 *
 * This class is NOT registered in the tool registry directly.
 * It is extended by server-specific CreateModelTool and UpdateModelTool.
 */

import { defaultConvention } from '../data-layer/api-conventions/index.js'
import { BaseTool } from './base-tool.js'

export class SaveModelBaseTool extends BaseTool {
  /**
   * Why this class exists alongside `DataLayer.buildPayload`:
   *
   * `DataLayer.buildPayload(model, modelConfig, attrs)` is the
   * authenticated-path version that lives on the seam — it requires the
   * caller to already have a `DataLayer` instance and a `ModelConfig`.
   * The methods here are the *unauthenticated* helpers used during
   * tool-definition introspection (e.g. when the registry instantiates a
   * tool just to read its `inputSchema`) where no `DataLayer` is bound.
   *
   * Both paths route through the same convention; the divergence is
   * intentional and the surface stays narrow.
   */
  /**
   * Get usage rules for save operations.
   *
   * Adds MANDATORY restrictions for models that require guided creation.
   */
  override getUsageRules(): string[] {
    const rules: string[] = []

    if (this.promptRegistry) {
      // Add required prompt restrictions (MANDATORY)
      if (typeof this.promptRegistry.getRequiredPromptRestrictions === 'function') {
        const requiredRestrictions = this.promptRegistry.getRequiredPromptRestrictions()
        if (requiredRestrictions) {
          rules.push(
            `IMPORTANT - For these complex models, call get_prompt_guide FIRST for valid attribute values:\n${requiredRestrictions}\n\nThe guide provides documentation on valid attribute values and constraints.`
          )
        }
      }

      // Add bulk recommendations (OPTIONAL)
      if (typeof this.promptRegistry.getBulkRecommendations === 'function') {
        const bulkRecs = this.promptRegistry.getBulkRecommendations()
        if (bulkRecs) {
          rules.push(
            `RECOMMENDED - For bulk/nested creation, call get_prompt_guide for workflow patterns:\n${bulkRecs}`
          )
        }
      }
    }

    return rules
  }

  /**
   * Build the request payload for a write operation (create/update).
   *
   * When a `DataLayer` is bound (authenticated path) we route through
   * its `buildPayload` so adapters can override convention/association
   * handling. Otherwise we fall back to the plain convention pipeline
   * with no base URL — sufficient for non-HAL conventions and for the
   * tool-definition introspection path.
   */
  buildRequestPayload(model: string, attrs: Record<string, unknown>): Record<string, unknown> {
    const modelConfig = this.models[model]

    if (this.dataLayer && modelConfig) {
      return this.dataLayer.buildPayload(model, modelConfig, attrs)
    }

    const convention = modelConfig?.api?.convention ?? defaultConvention
    let finalAttrs = attrs
    if (modelConfig?.associations?.belongsTo) {
      finalAttrs = convention.resolveAssociationValues(
        attrs,
        modelConfig.associations.belongsTo,
        undefined
      )
    }
    return convention.buildRequestPayload(model, finalAttrs)
  }

  /** Check if a model requires guided creation */
  requiresGuidedCreation(model: string): boolean {
    if (!this.promptRegistry?.getPromptRequiredModels) {
      return false
    }
    const requiredModels = this.promptRegistry.getPromptRequiredModels()
    return requiredModels.includes(model)
  }

  /** Get the prompt name for a model that requires guided creation */
  getRequiredPromptName(model: string): string | null {
    if (!this.promptRegistry?.getPromptNameByModel) {
      return null
    }
    return this.promptRegistry.getPromptNameByModel(model)
  }
}
