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

import * as logger from '#src/services/logger.js'
import { BaseStrategy } from './base-strategy.js'
import { StatelessStrategy } from './stateless-strategy.js'
import { HybridStrategy } from './hybrid-strategy.js'
import { StatefulStrategy } from './stateful-strategy.js'

export { BaseStrategy }
export { StatelessStrategy }
export { HybridStrategy }
export { StatefulStrategy }

/** Strategy registry */
export const strategies: Record<string, typeof BaseStrategy> = {
  stateless: StatelessStrategy,
  hybrid: HybridStrategy,
  stateful: StatefulStrategy
}

/** Get a strategy by type */
export function getStrategy(type: string): typeof BaseStrategy {
  const strategy = strategies[type]
  if (!strategy) {
    logger.warn(`Unknown strategy type: ${type}, falling back to stateless`)
    return StatelessStrategy
  }
  return strategy
}

/** Get all available strategy types */
export function getAvailableStrategies(): string[] {
  return Object.keys(strategies)
}

/** Get strategy descriptions for documentation */
export function getStrategyDescriptions(): Record<string, string> {
  return {
    stateless: StatelessStrategy.getDescription(),
    hybrid: HybridStrategy.getDescription(),
    stateful: StatefulStrategy.getDescription()
  }
}
