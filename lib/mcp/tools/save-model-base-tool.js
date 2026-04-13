/**
 * Base class for create/update model tools
 *
 * Provides shared functionality:
 * - getUsageRules() with prompt guide restrictions for complex models
 *
 * This class is NOT registered in the tool registry directly.
 * It is extended by server-specific CreateModelTool and UpdateModelTool.
 */

import { BaseTool } from './base-tool.js'
import { defaultConvention } from '../api-conventions/index.js'

export class SaveModelBaseTool extends BaseTool {
  /**
   * Get usage rules for save operations
   *
   * Adds MANDATORY restrictions for models that require guided creation.
   *
   * @returns {string[]} Array of usage rules
   */
  getUsageRules() {
    const rules = []

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
   * Reads the convention from the model config. Falls back to the
   * wrapped (Rails) convention when no convention is configured.
   *
   * @param {string} model - Singular model name (e.g. 'scheduling')
   * @param {Object} attrs - Attribute key-value pairs
   * @returns {Object} Formatted request payload
   */
  buildRequestPayload(model, attrs) {
    const modelConfig = this.models?.[model]
    const convention = modelConfig?.api?.convention ?? defaultConvention

    // Resolve _id attributes into convention-specific fields (e.g., title_id → title_link for HAL)
    let finalAttrs = attrs
    if (modelConfig?.associations?.belongsTo) {
      finalAttrs = convention.resolveAssociationValues(
        attrs,
        modelConfig.associations.belongsTo,
        this.apiClient?.baseUrl
      )
    }

    return convention.buildRequestPayload(model, finalAttrs)
  }

  /**
   * Check if a model requires guided creation
   * @param {string} model - Model name
   * @returns {boolean} Whether the model requires calling get_prompt_guide first
   */
  requiresGuidedCreation(model) {
    if (!this.promptRegistry?.getPromptRequiredModels) {
      return false
    }
    const requiredModels = this.promptRegistry.getPromptRequiredModels()
    return requiredModels.includes(model)
  }

  /**
   * Get the prompt name for a model that requires guided creation
   * @param {string} model - Model name
   * @returns {string|null} Prompt name or null
   */
  getRequiredPromptName(model) {
    if (!this.promptRegistry?.getPromptNameByModel) {
      return null
    }
    return this.promptRegistry.getPromptNameByModel(model)
  }
}
