/**
 * Strategy Pattern for Form Handling
 *
 * This module exports different strategies for handling form data collection:
 *
 * - StatelessStrategy: Documentation only, no validation (simple forms)
 * - HybridStrategy: Documentation + validation before submit (medium forms)
 * - StatefulStrategy: Full progressive validation with sections (complex forms)
 *
 * Usage:
 *   import { getStrategy } from './strategies/index.js'
 *   const strategy = getStrategy('hybrid')
 *   const result = strategy.validateFields(promptClass, fields)
 */

import * as logger from '#lib/services/logger.js'
import { BaseStrategy } from './base-strategy.js'
import { StatelessStrategy } from './stateless-strategy.js'
import { HybridStrategy } from './hybrid-strategy.js'
import { StatefulStrategy } from './stateful-strategy.js'

export { BaseStrategy }
export { StatelessStrategy }
export { HybridStrategy }
export { StatefulStrategy }

/**
 * Strategy registry
 */
export const strategies = {
  stateless: StatelessStrategy,
  hybrid: HybridStrategy,
  stateful: StatefulStrategy
}

/**
 * Get a strategy by type
 * @param {string} type - Strategy type: 'stateless', 'hybrid', or 'stateful'
 * @returns {typeof BaseStrategy} Strategy class
 */
export function getStrategy(type) {
  const strategy = strategies[type]
  if (!strategy) {
    logger.warn(`Unknown strategy type: ${type}, falling back to stateless`)
    return StatelessStrategy
  }
  return strategy
}

/**
 * Get all available strategy types
 * @returns {string[]}
 */
export function getAvailableStrategies() {
  return Object.keys(strategies)
}

/**
 * Get strategy descriptions for documentation
 * @returns {Object}
 */
export function getStrategyDescriptions() {
  return {
    stateless: StatelessStrategy.getDescription(),
    hybrid: HybridStrategy.getDescription(),
    stateful: StatefulStrategy.getDescription()
  }
}
