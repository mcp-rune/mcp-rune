/**
 * Public surface for the summary-strategy mechanism.
 *
 * `BUILT_IN_SUMMARY_STRATEGIES` is the set of strategies the framework
 * registers by default. Hosts may extend the registry with their own
 * strategies via the `registerSummaryStrategy` collector on
 * `ApiExtensionContext`.
 */

import { anomalyStrategy } from './anomaly.js'
import { conceptTouchStrategy } from './concept-touch.js'
import { coverageStrategy } from './coverage.js'
import { distributionStrategy } from './distribution.js'
import { entityExtractionStrategy } from './entity-extraction.js'
import { SummaryStrategyRegistry } from './registry.js'
import { relationshipCoverageStrategy } from './relationship-coverage.js'
import { ruleViolationStrategy } from './rule-violation.js'
import { semanticClusterStrategy } from './semantic-cluster.js'
import { temporalStrategy } from './temporal.js'
import type { SummaryStrategy } from './types.js'

export type {
  SummaryConcept,
  SummaryDomainRegistry,
  SummaryEdge,
  SummaryInput,
  SummaryOutput,
  SummaryRequirement,
  SummaryRule,
  SummaryStrategy
} from './types.js'
export {
  anomalyStrategy,
  conceptTouchStrategy,
  coverageStrategy,
  distributionStrategy,
  entityExtractionStrategy,
  relationshipCoverageStrategy,
  ruleViolationStrategy,
  semanticClusterStrategy,
  SummaryStrategyRegistry,
  temporalStrategy
}

export const BUILT_IN_SUMMARY_STRATEGIES: ReadonlyArray<SummaryStrategy> = Object.freeze([
  distributionStrategy,
  coverageStrategy,
  anomalyStrategy,
  temporalStrategy,
  entityExtractionStrategy,
  relationshipCoverageStrategy,
  conceptTouchStrategy,
  ruleViolationStrategy,
  semanticClusterStrategy
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
