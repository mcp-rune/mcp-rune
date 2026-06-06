import { distributionStrategy } from '../../../../../src/mcp/analysis-layer/summary-strategies/distribution.js'
import {
  BUILT_IN_SUMMARY_STRATEGIES,
  defaultSummaryStrategyRegistry,
  SummaryStrategyRegistry
} from '../../../../../src/mcp/analysis-layer/summary-strategies/index.js'
import type { SummaryStrategy } from '../../../../../src/mcp/analysis-layer/summary-strategies/types.js'

const stubStrategy = (name: string, description = 'stub'): SummaryStrategy => ({
  name,
  description,
  generate: () => ({ finding: '', metadata: {} })
})

describe('lib/mcp/analysis-layer/summary-strategies/registry', () => {
  describe('SummaryStrategyRegistry', () => {
    it('starts empty when no initial strategies are provided', () => {
      const r = new SummaryStrategyRegistry()
      expect(r.names()).toEqual([])
      expect(r.all()).toEqual([])
      expect(r.get('distribution')).toBeUndefined()
      expect(r.has('distribution')).toBe(false)
    })

    it('seeds built-ins with owner "<built-in>"', () => {
      const r = new SummaryStrategyRegistry([distributionStrategy])
      expect(r.has('distribution')).toBe(true)
      expect(r.get('distribution')).toBe(distributionStrategy)
      expect(r.ownerOf('distribution')).toBe('<built-in>')
      expect(r.names()).toEqual(['distribution'])
    })

    it('accepts a custom strategy via register() with a custom owner', () => {
      const r = new SummaryStrategyRegistry([distributionStrategy])
      const custom = stubStrategy('sales-narrative')
      r.register('sales-ext', custom)
      expect(r.get('sales-narrative')).toBe(custom)
      expect(r.ownerOf('sales-narrative')).toBe('sales-ext')
      expect(r.names()).toEqual(['distribution', 'sales-narrative'])
      expect(r.all()).toEqual([distributionStrategy, custom])
    })

    it('rejects duplicate names with an error naming both owners', () => {
      const r = new SummaryStrategyRegistry([distributionStrategy])
      expect(() => r.register('crm-ext', stubStrategy('distribution'))).toThrow(
        /"distribution" attempted by "crm-ext" is already registered by "<built-in>"/
      )
    })

    it('rejects names that do not match the kebab-case pattern', () => {
      const r = new SummaryStrategyRegistry()
      expect(() => r.register('ext', stubStrategy('NotKebab'))).toThrow(/must match/)
      expect(() => r.register('ext', stubStrategy('with_underscore'))).toThrow(/must match/)
      expect(() => r.register('ext', stubStrategy('1leading-digit'))).toThrow(/must match/)
      expect(() => r.register('ext', stubStrategy(''))).toThrow(/must match/)
    })

    it('accepts valid kebab-case names', () => {
      const r = new SummaryStrategyRegistry()
      r.register('ext', stubStrategy('a'))
      r.register('ext', stubStrategy('valid-name'))
      r.register('ext', stubStrategy('name-with-digits-2'))
      expect(r.names()).toEqual(['a', 'valid-name', 'name-with-digits-2'])
    })

    it('throws via the constructor if initial strategies collide with each other', () => {
      const a = stubStrategy('dupe')
      const b = stubStrategy('dupe')
      expect(() => new SummaryStrategyRegistry([a, b])).toThrow(
        /"dupe" attempted by "<built-in>" is already registered by "<built-in>"/
      )
    })
  })

  describe('defaultSummaryStrategyRegistry', () => {
    it('is a singleton seeded with the built-ins', () => {
      const first = defaultSummaryStrategyRegistry()
      const second = defaultSummaryStrategyRegistry()
      expect(first).toBe(second)
      expect(first.has('distribution')).toBe(true)
    })
  })

  describe('BUILT_IN_SUMMARY_STRATEGIES', () => {
    it('includes the distribution strategy', () => {
      expect(BUILT_IN_SUMMARY_STRATEGIES).toContain(distributionStrategy)
    })

    it('is frozen', () => {
      expect(Object.isFrozen(BUILT_IN_SUMMARY_STRATEGIES)).toBe(true)
    })
  })
})
