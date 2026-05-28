/**
 * Public surface for the summary-strategy mechanism.
 *
 * `BUILT_IN_SUMMARY_STRATEGIES` is the set of strategies the framework
 * registers by default. Hosts may extend the registry with their own
 * strategies via the `registerSummaryStrategy` collector on
 * `ApiExtensionContext`.
 */

import { coverageStrategy } from './coverage.js'
import { distributionStrategy } from './distribution.js'
import { SummaryStrategyRegistry } from './registry.js'
import type { SummaryStrategy } from './types.js'

export type { SummaryInput, SummaryOutput, SummaryStrategy } from './types.js'
export { coverageStrategy, distributionStrategy }
export { SummaryStrategyRegistry }

export const BUILT_IN_SUMMARY_STRATEGIES: ReadonlyArray<SummaryStrategy> = Object.freeze([
  distributionStrategy,
  coverageStrategy
])

let _defaultRegistry: SummaryStrategyRegistry | undefined

/**
 * Lazy process-wide fallback registry. Used by `BaseTool` consumers when no
 * `ToolRegistry`-owned registry was threaded through (e.g. ad-hoc test
 * instantiations). The fallback contains only the built-ins.
 */
export function defaultSummaryStrategyRegistry(): SummaryStrategyRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = new SummaryStrategyRegistry(BUILT_IN_SUMMARY_STRATEGIES)
  }
  return _defaultRegistry
}
