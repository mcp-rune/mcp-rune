/**
 * Form-Strategy Pattern (qualified GoF Strategy)
 *
 * This module exports different form-strategies for handling form data collection:
 *
 * - StatelessFormStrategy: Documentation only, no validation (simple forms)
 * - HybridFormStrategy: Documentation + validation before submit (medium forms)
 * - StatefulFormStrategy: Full progressive validation with sections (complex forms)
 *
 * Usage:
 *   import { getFormStrategy } from './form-strategies/index.js'
 *   const strategy = getFormStrategy('hybrid')
 *   const result = strategy.validateFields(promptClass, fields)
 */

import * as logger from '#src/runtime/logger.js'

import { BaseFormStrategy } from './base-form-strategy.js'
import { HybridFormStrategy } from './hybrid-form-strategy.js'
import { StatefulFormStrategy } from './stateful-form-strategy.js'
import { StatelessFormStrategy } from './stateless-form-strategy.js'

export { BaseFormStrategy }
export { StatelessFormStrategy }
export { HybridFormStrategy }
export { StatefulFormStrategy }

/** Form-strategy registry */
export const formStrategies: Record<string, typeof BaseFormStrategy> = {
  stateless: StatelessFormStrategy,
  hybrid: HybridFormStrategy,
  stateful: StatefulFormStrategy
}

/** Get a form-strategy by type */
export function getFormStrategy(type: string): typeof BaseFormStrategy {
  const strategy = formStrategies[type]
  if (!strategy) {
    logger.warn(`Unknown form-strategy type: ${type}, falling back to stateless`)
    return StatelessFormStrategy
  }
  return strategy
}

/** Get all available form-strategy types */
export function getAvailableFormStrategies(): string[] {
  return Object.keys(formStrategies)
}

/** Get form-strategy descriptions for documentation */
export function getFormStrategyDescriptions(): Record<string, string> {
  return {
    stateless: StatelessFormStrategy.getDescription(),
    hybrid: HybridFormStrategy.getDescription(),
    stateful: StatefulFormStrategy.getDescription()
  }
}
