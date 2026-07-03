import { BUILT_IN_SUMMARY_STRATEGIES } from '../../../../../src/mcp/analysis-layer/summary-strategies/index.js'
import type {
  SummaryEdge,
  SummaryInput
} from '../../../../../src/mcp/analysis-layer/summary-strategies/types.js'

/**
 * ADR 0007: built-in summary strategies are guaranteed deterministic. This
 * double-invoke-and-compare probe runs every built-in twice over one fixture
 * corpus and asserts byte-identical output — wall-clock time, randomness, or
 * iteration-order sensitivity would fail the build.
 */
describe('lib/mcp/analysis-layer/summary-strategies — determinism (ADR 0007)', () => {
  const records: Array<Record<string, unknown>> = [
    {
      id: '1',
      title: 'Clean Code',
      status: 'read',
      rating: 5,
      created_at: '2026-01-05',
      author_id: 'a1',
      genre_id: 'g1'
    },
    {
      id: '2',
      title: 'Refactoring',
      status: 'reading',
      rating: 4,
      created_at: '2026-02-11',
      author_id: 'a1',
      genre_id: 'g1'
    },
    {
      id: '3',
      title: 'The Pragmatic Programmer',
      status: 'read',
      rating: 5,
      created_at: '2026-03-20',
      author_id: 'a2',
      genre_id: 'g2'
    },
    {
      id: '4',
      title: 'Domain-Driven Design',
      status: 'unread',
      rating: null,
      created_at: '2026-04-01',
      author_id: 'a3',
      genre_id: 'g1'
    },
    {
      id: '5',
      title: 'Working Effectively with Legacy Code',
      status: 'read',
      rating: 3,
      created_at: '2026-05-15',
      author_id: 'a2',
      genre_id: 'g2'
    }
  ]

  const edges: SummaryEdge[] = records.flatMap((r) => [
    {
      src_id: r.id as string,
      dst_model: 'author',
      dst_id: r.author_id as string,
      edge_type: 'belongsTo:author'
    },
    {
      src_id: r.id as string,
      dst_model: 'genre',
      dst_id: r.genre_id as string,
      edge_type: 'belongsTo:genre'
    }
  ])

  // Deterministic 384-dim embeddings (varied per record so clustering has signal).
  const embeddings = new Map<string, Float32Array>(
    records.map((r, i) => {
      const v = new Float32Array(384)
      for (let d = 0; d < 384; d++) v[d] = Math.sin((i + 1) * (d + 1)) / 384
      return [r.id as string, v]
    })
  )

  const domainRegistry: SummaryInput['domainRegistry'] = {
    knowledge: {
      getConceptsForModel: () => [
        { name: 'craftsmanship', title: 'Craftsmanship', models: ['book'] }
      ]
    },
    rules: {
      rules: undefined,
      getRulesForModel: () => [
        {
          name: 'rated-when-read',
          description: 'A read book should carry a rating',
          scope: ['book'],
          severity: 'warning' as const,
          evaluate: (data: Record<string, unknown>) => ({
            passed: data.status !== 'read' || data.rating != null,
            message: 'read book missing rating'
          })
        }
      ]
    }
  } as SummaryInput['domainRegistry']

  const baseInput: SummaryInput = {
    analysisId: 'det-session',
    model: 'book',
    page: 1,
    totalPages: 1,
    records,
    fields: ['id', 'title', 'status', 'rating', 'created_at'],
    edges,
    embeddings,
    domainRegistry
  }

  it.each(BUILT_IN_SUMMARY_STRATEGIES.map((s) => [s.name, s] as const))(
    '%s produces identical output on repeated invocation',
    async (_name, strategy) => {
      if (strategy.appliesTo && !strategy.appliesTo(baseInput)) {
        // Feed it enough to apply; if it still opts out, there's nothing to compare.
        return
      }
      const first = await strategy.generate(baseInput)
      const second = await strategy.generate(baseInput)
      expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    }
  )

  it('covers every built-in strategy', () => {
    expect(BUILT_IN_SUMMARY_STRATEGIES.length).toBe(9)
  })
})
