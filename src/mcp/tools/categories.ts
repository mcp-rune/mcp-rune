/**
 * Tool Categories
 *
 * Defines behavior and requirements for different tool types.
 * Used by BaseToolRegistry to determine auth requirements automatically.
 */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'

/**
 * Tool category constants
 */
export const TOOL_CATEGORIES = {
  /** Data tools - require API authentication
   * CRUD operations, bulk operations, search, and discovery on models
   * Examples: list_models, find_model, create_model, update_model, delete_model, analysis_ingest
   */
  DATA: 'data',

  /** @deprecated Use DATA */
  CRUD: 'data' as const,

  /** Strategy tools - no authentication required
   * Prompt guidance, validation, and summary tools
   * Examples: get_prompt_guide, validate_form, get_form_summary
   */
  STRATEGY: 'strategy',

  /** Autocomplete tools - require API authentication
   * Provide field value suggestions from API
   * Examples: get_field_suggestions
   */
  AUTOCOMPLETE: 'autocomplete',

  /** Analysis tools - qualitative data analysis sessions
   * Requires vector storage configuration, no API auth required
   * Examples: analysis_store, analysis_query, analysis_clear
   */
  ANALYSIS: 'analysis',

  /** Operations tools - retrospective analysis of CRUD operations
   * Requires vector storage configuration, no API auth required
   * Examples: find_similar_operations, detect_operation_gaps, cluster_operations
   */
  OPERATIONS: 'operations',

  /** Domain tools - domain intelligence (knowledge, rules, workflows)
   * Requires domain registry configuration, no API auth required
   */
  DOMAIN: 'domain',

  /** Custom tools - server-specific behavior
   * May or may not require auth depending on implementation
   */
  CUSTOM: 'custom'
} as const

export type ToolCategory = (typeof TOOL_CATEGORIES)[keyof typeof TOOL_CATEGORIES]

export interface CategoryConfig {
  requiresAuth: boolean
  requiresPromptRegistry: boolean
  requiresVectorStorage?: boolean
  requiresDomainRegistry?: boolean
  isGeneric: boolean
  description: string
  defaultAnnotations: ToolAnnotations
}

/**
 * Category configuration
 * Defines default behavior for each category
 */
export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  [TOOL_CATEGORIES.DATA]: {
    requiresAuth: true,
    requiresPromptRegistry: false,
    isGeneric: true,
    description:
      'Data operations on models (CRUD, bulk, search, discovery), requires API authentication',
    defaultAnnotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  [TOOL_CATEGORIES.STRATEGY]: {
    requiresAuth: false,
    requiresPromptRegistry: true,
    isGeneric: true,
    description: 'Prompt guidance and validation tools, no auth required',
    defaultAnnotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  [TOOL_CATEGORIES.AUTOCOMPLETE]: {
    requiresAuth: true,
    requiresPromptRegistry: false,
    isGeneric: false,
    description: 'Field value suggestions, requires API authentication',
    defaultAnnotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  [TOOL_CATEGORIES.ANALYSIS]: {
    requiresAuth: false,
    requiresPromptRegistry: false,
    requiresVectorStorage: true,
    isGeneric: true,
    description: 'Analysis tools for qualitative data analysis sessions, requires vector storage',
    defaultAnnotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  [TOOL_CATEGORIES.OPERATIONS]: {
    requiresAuth: false,
    requiresPromptRegistry: false,
    requiresVectorStorage: true,
    isGeneric: true,
    description:
      'Operations tools for retrospective CRUD operation analysis, requires vector storage',
    defaultAnnotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  [TOOL_CATEGORIES.DOMAIN]: {
    requiresAuth: false,
    requiresPromptRegistry: false,
    requiresDomainRegistry: true,
    isGeneric: true,
    description: 'Domain intelligence tools, requires domain registry configuration',
    defaultAnnotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  [TOOL_CATEGORIES.CUSTOM]: {
    requiresAuth: true, // Default to requiring auth for safety
    requiresPromptRegistry: false,
    isGeneric: false,
    description: 'Server-specific behavior, auth requirement varies',
    defaultAnnotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  }
}

/**
 * Get configuration for a category
 */
export function getCategoryConfig(category: string): CategoryConfig {
  return CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG[TOOL_CATEGORIES.CUSTOM]!
}

/**
 * Check if a category requires authentication
 */
export function categoryRequiresAuth(category: string): boolean {
  const config = getCategoryConfig(category)
  return config.requiresAuth
}
