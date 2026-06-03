import { ruleViolationStrategy } from '../../../../src/core/summary-strategies/rule-violation.js'
import type { SummaryInput } from '../../../../src/core/summary-strategies/types.js'

const completedNeedRating = {
  name: 'completed-books-need-rating',
  description: 'Completed books must carry a rating.',
  scope: ['book'],
  severity: 'warning' as const,
  evaluate(record: Record<string, unknown>) {
    if (record.status === 'completed' && record.rating == null) {
      return { passed: false, message: `Missing rating on book ${record.id ?? '?'}` }
    }
    return { passed: true }
  }
}

const registryWithRule = {
  rules: {
    getRulesForModel(model: string) {
      return model === 'book' ? [completedNeedRating] : []
    }
  }
}

function makeInput(overrides: Partial<SummaryInput>): SummaryInput {
  return {
    analysisId: 'a1',
    model: 'book',
    page: 1,
    totalPages: 1,
    records: [],
    ...overrides
  }
}

describe('lib/core/summary-strategies/rule-violation', () => {
  it('exposes name, description, requires=["domainRegistry"]', () => {
    expect(ruleViolationStrategy.name).toBe('rule-violation')
    expect(ruleViolationStrategy.requires).toEqual(['domainRegistry'])
  })

  it('appliesTo returns false when no rule scopes the model', () => {
    expect(
      ruleViolationStrategy.appliesTo!(
        makeInput({
          model: 'unknown',
          records: [{ id: '1' }],
          domainRegistry: registryWithRule
        })
      )
    ).toBe(false)
  })

  it('appliesTo returns true when a rule scopes the model and records exist', () => {
    expect(
      ruleViolationStrategy.appliesTo!(
        makeInput({ records: [{ id: '1' }], domainRegistry: registryWithRule })
      )
    ).toBe(true)
  })

  it('counts pass/fail per rule and captures first failing IDs', async () => {
    const records = [
      { id: 'b1', status: 'completed', rating: 5 },
      { id: 'b2', status: 'completed' /* missing rating */ },
      { id: 'b3', status: 'reading' },
      { id: 'b4', status: 'completed' /* missing rating */ }
    ]
    const out = await ruleViolationStrategy.generate(
      makeInput({ records, domainRegistry: registryWithRule })
    )
    const stats = out.metadata.rules as Record<
      string,
      { passed: number; failed: number; severity: string; failed_ids: string[] }
    >
    expect(stats['completed-books-need-rating']!.failed).toBe(2)
    expect(stats['completed-books-need-rating']!.passed).toBe(2)
    expect(stats['completed-books-need-rating']!.severity).toBe('warning')
    expect(stats['completed-books-need-rating']!.failed_ids).toEqual(['b2', 'b4'])
  })

  it('renders an OK finding when no records fail', async () => {
    const records = [
      { id: 'b1', status: 'reading' },
      { id: 'b2', status: 'unread' }
    ]
    const out = await ruleViolationStrategy.generate(
      makeInput({ records, domainRegistry: registryWithRule })
    )
    expect(out.finding).toContain('passed (2/2)')
  })
})
