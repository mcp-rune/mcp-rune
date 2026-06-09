import { InMemoryDomainAdapter } from '../../../../../src/mcp/domain/adapters/inmemory.js'
import { BusinessRule } from '../../../../../src/mcp/domain/business-rules.js'
import type { DomainModule } from '../../../../../src/mcp/domain/domain-definitions.js'
import { DomainConcept } from '../../../../../src/mcp/domain/knowledge.js'
import { WorkflowDefinition } from '../../../../../src/mcp/domain/workflows.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const concept = (name: string, models: string[] = ['book']) =>
  new DomainConcept({ name, title: name, description: `${name} desc`, models, tags: [name] })

const rule = (name: string, scope: string[] = ['book']) =>
  new BusinessRule({
    name,
    description: `${name} rule`,
    scope,
    evaluate: () => ({ passed: true, message: 'ok' })
  })

const workflow = (name: string, models: string[] = ['book']) =>
  new WorkflowDefinition({
    name,
    title: name,
    description: `${name} desc`,
    tags: [name],
    models,
    steps: [{ order: 1, title: 'Step', description: 'Do it' }]
  })

// ─── Constructor ─────────────────────────────────────────────────────────────

describe('InMemoryDomainAdapter', () => {
  describe('constructor', () => {
    it('accepts a single DomainModule (non-array)', async () => {
      const adapter = new InMemoryDomainAdapter({
        concepts: [concept('c1')],
        rules: [rule('r1')],
        workflows: [workflow('w1')]
      })
      expect(await adapter.getAllConcepts()).toHaveLength(1)
      expect(await adapter.getRulesForModel('book')).toHaveLength(1)
      expect(await adapter.getAllWorkflows()).toHaveLength(1)
    })

    it('accepts an array of modules and merges them', async () => {
      const moduleA: DomainModule = {
        concepts: [concept('a1'), concept('a2')],
        rules: [rule('r1')]
      }
      const moduleB: DomainModule = { workflows: [workflow('w1'), workflow('w2')] }
      const adapter = new InMemoryDomainAdapter([moduleA, moduleB])

      expect(await adapter.getAllConcepts()).toHaveLength(2)
      expect(await adapter.getRulesForModel('book')).toHaveLength(1)
      expect(await adapter.getAllWorkflows()).toHaveLength(2)
    })

    it('accepts an empty array', async () => {
      const adapter = new InMemoryDomainAdapter([])
      expect(await adapter.getAllConcepts()).toHaveLength(0)
      expect(await adapter.getRulesForModel('book')).toHaveLength(0)
      expect(await adapter.getAllWorkflows()).toHaveLength(0)
    })

    it('handles a module with missing fields gracefully', async () => {
      const adapter = new InMemoryDomainAdapter({})
      expect(await adapter.getAllConcepts()).toHaveLength(0)
      expect(await adapter.getRulesForModel('book')).toHaveLength(0)
      expect(await adapter.getAllWorkflows()).toHaveLength(0)
    })

    it('accepts plain DomainConceptConfig objects (not class instances)', async () => {
      const adapter = new InMemoryDomainAdapter({
        concepts: [
          { name: 'plain', title: 'Plain', description: 'Plain concept', models: ['book'] }
        ]
      })
      const found = await adapter.getConcept('plain')
      expect(found).toBeDefined()
      expect(found!.name).toBe('plain')
      // Should be a proper DomainConcept instance
      expect(found).toBeInstanceOf(DomainConcept)
    })

    it('accepts plain BusinessRuleConfig objects (not class instances)', async () => {
      const adapter = new InMemoryDomainAdapter({
        rules: [
          {
            name: 'plain_rule',
            description: 'Plain rule',
            scope: ['book'],
            evaluate: () => ({ passed: true, message: 'ok' })
          }
        ]
      })
      const rules = await adapter.getRulesForModel('book')
      expect(rules).toHaveLength(1)
      expect(rules[0]).toBeInstanceOf(BusinessRule)
    })

    it('accepts plain WorkflowDefinitionConfig objects (not class instances)', async () => {
      const adapter = new InMemoryDomainAdapter({
        workflows: [
          {
            name: 'plain_wf',
            title: 'Plain',
            description: 'Plain workflow',
            steps: [{ order: 1, title: 'Step', description: 'Do it' }]
          }
        ]
      })
      const wf = await adapter.getWorkflow('plain_wf')
      expect(wf).toBeDefined()
      expect(wf).toBeInstanceOf(WorkflowDefinition)
    })

    it('accepts already-instantiated class instances without double-wrapping', async () => {
      const c = concept('existing')
      const adapter = new InMemoryDomainAdapter({ concepts: [c] })
      const found = await adapter.getConcept('existing')
      // Should be the same object identity (not re-wrapped)
      expect(found).toBe(c)
    })

    it('merges concepts from three modules correctly', async () => {
      const adapter = new InMemoryDomainAdapter([
        { concepts: [concept('a')] },
        { concepts: [concept('b'), concept('c')] },
        { concepts: [concept('d')] }
      ])
      const all = await adapter.getAllConcepts()
      expect(all.map((c) => c.name).sort()).toEqual(['a', 'b', 'c', 'd'])
    })
  })

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('init() resolves without error', async () => {
      const adapter = new InMemoryDomainAdapter({})
      await expect(adapter.init()).resolves.toBeUndefined()
    })

    it('close() resolves without error', async () => {
      const adapter = new InMemoryDomainAdapter({})
      await expect(adapter.close()).resolves.toBeUndefined()
    })

    it('initSearch() resolves without error', async () => {
      const adapter = new InMemoryDomainAdapter({ concepts: [concept('c')] })
      await expect(adapter.initSearch()).resolves.toBeUndefined()
    })
  })

  // ─── Concepts ───────────────────────────────────────────────────────────────

  describe('concepts', () => {
    let adapter: InMemoryDomainAdapter

    beforeEach(() => {
      adapter = new InMemoryDomainAdapter([
        {
          concepts: [
            concept('reading_pipeline', ['book', 'genre']),
            concept('author_bio', ['author'])
          ]
        },
        { concepts: [concept('catalogue', ['book', 'genre'])] }
      ])
    })

    it('getConcept returns concept by exact name', async () => {
      const c = await adapter.getConcept('reading_pipeline')
      expect(c).toBeDefined()
      expect(c!.name).toBe('reading_pipeline')
    })

    it('getConcept returns undefined for unknown name', async () => {
      expect(await adapter.getConcept('nonexistent')).toBeUndefined()
    })

    it('getAllConcepts returns all merged concepts', async () => {
      const all = await adapter.getAllConcepts()
      expect(all).toHaveLength(3)
      expect(all.map((c) => c.name).sort()).toEqual(['author_bio', 'catalogue', 'reading_pipeline'])
    })

    it('getConceptsForModel filters by model', async () => {
      const bookConcepts = await adapter.getConceptsForModel('book')
      expect(bookConcepts).toHaveLength(2)
      expect(bookConcepts.every((c) => c.models.includes('book'))).toBe(true)

      const authorConcepts = await adapter.getConceptsForModel('author')
      expect(authorConcepts).toHaveLength(1)
      expect(authorConcepts[0].name).toBe('author_bio')
    })

    it('getConceptsForModel returns empty array for unknown model', async () => {
      expect(await adapter.getConceptsForModel('nonexistent')).toEqual([])
    })

    it('searchConcepts finds matching concepts', async () => {
      const results = await adapter.searchConcepts('reading')
      expect(results.some((c) => c.name === 'reading_pipeline')).toBe(true)
    })

    it('searchConcepts returns empty array for no matches', async () => {
      const results = await adapter.searchConcepts('zzz_no_match_xyz')
      expect(results).toHaveLength(0)
    })
  })

  // ─── Rules ──────────────────────────────────────────────────────────────────

  describe('rules', () => {
    let adapter: InMemoryDomainAdapter

    beforeEach(() => {
      adapter = new InMemoryDomainAdapter([
        {
          rules: [
            rule('book_requires_author', ['book']),
            new BusinessRule({
              name: 'book_rating_valid',
              description: 'Rating between 1 and 5',
              scope: ['book'],
              severity: 'warning',
              evaluate: (data) => ({
                passed:
                  !data.rating || ((data.rating as number) >= 1 && (data.rating as number) <= 5),
                message: 'Rating must be 1–5'
              })
            })
          ]
        },
        { rules: [rule('author_requires_name', ['author'])] }
      ])
    })

    it('getRulesForModel returns rules scoped to a model', async () => {
      const bookRules = await adapter.getRulesForModel('book')
      expect(bookRules).toHaveLength(2)
      expect(bookRules.every((r) => r.scope.includes('book'))).toBe(true)
    })

    it('getRulesForModel returns empty for unknown model', async () => {
      expect(await adapter.getRulesForModel('genre')).toHaveLength(0)
    })

    it('describeRules returns name, description, severity', async () => {
      const descriptions = await adapter.describeRules('book')
      expect(descriptions).toHaveLength(2)
      expect(descriptions[0]).toHaveProperty('name')
      expect(descriptions[0]).toHaveProperty('description')
      expect(descriptions[0]).toHaveProperty('severity')
    })

    it('evaluateRules returns passed true when all rules pass', async () => {
      const result = await adapter.evaluateRules('book', { rating: 4 })
      expect(result.passed).toBe(true)
    })

    it('evaluateRules returns passed false when an error rule fails', async () => {
      const adapter2 = new InMemoryDomainAdapter({
        rules: [
          new BusinessRule({
            name: 'must_have_author',
            description: 'Author required',
            scope: ['book'],
            severity: 'error',
            evaluate: (data) => ({
              passed: !!data.author,
              message: data.author ? 'ok' : 'missing author'
            })
          })
        ]
      })
      const result = await adapter2.evaluateRules('book', {})
      expect(result.passed).toBe(false)
    })

    it('evaluateRules passes optional context to evaluate function', async () => {
      let receivedContext: Record<string, unknown> | undefined
      const adapter2 = new InMemoryDomainAdapter({
        rules: [
          new BusinessRule({
            name: 'ctx_rule',
            description: 'Context rule',
            scope: ['book'],
            evaluate: (_data, ctx) => {
              receivedContext = ctx
              return { passed: true, message: 'ok' }
            }
          })
        ]
      })
      await adapter2.evaluateRules('book', {}, { authorId: '42' })
      expect(receivedContext).toEqual({ authorId: '42' })
    })

    it('merges rules from multiple modules', async () => {
      const allBook = await adapter.getRulesForModel('book')
      const allAuthor = await adapter.getRulesForModel('author')
      expect(allBook).toHaveLength(2)
      expect(allAuthor).toHaveLength(1)
    })
  })

  // ─── Workflows ──────────────────────────────────────────────────────────────

  describe('workflows', () => {
    let adapter: InMemoryDomainAdapter

    beforeEach(() => {
      adapter = new InMemoryDomainAdapter([
        {
          workflows: [
            workflow('add_book', ['book']),
            new WorkflowDefinition({
              name: 'rate_book',
              title: 'Rate Book',
              description: 'Set a rating on a completed book',
              tags: ['review', 'book'],
              models: ['book'],
              steps: [{ order: 1, title: 'Find book', description: 'Search for the book' }]
            })
          ]
        },
        {
          workflows: [workflow('add_author', ['author'])]
        }
      ])
    })

    it('getWorkflow returns workflow by exact name', async () => {
      const wf = await adapter.getWorkflow('add_book')
      expect(wf).toBeDefined()
      expect(wf!.name).toBe('add_book')
    })

    it('getWorkflow returns undefined for unknown name', async () => {
      expect(await adapter.getWorkflow('nonexistent')).toBeUndefined()
    })

    it('getAllWorkflows returns all workflows from all modules', async () => {
      const all = await adapter.getAllWorkflows()
      expect(all).toHaveLength(3)
      expect(all.map((w) => w.name).sort()).toEqual(['add_author', 'add_book', 'rate_book'])
    })

    it('getWorkflowsByModel filters by model', async () => {
      const bookWfs = await adapter.getWorkflowsByModel('book')
      expect(bookWfs).toHaveLength(2)
      expect(bookWfs.every((w) => w.models.includes('book'))).toBe(true)

      const authorWfs = await adapter.getWorkflowsByModel('author')
      expect(authorWfs).toHaveLength(1)
    })

    it('getWorkflowsByTag filters by tag', async () => {
      const reviewWfs = await adapter.getWorkflowsByTag('review')
      expect(reviewWfs).toHaveLength(1)
      expect(reviewWfs[0].name).toBe('rate_book')
    })

    it('getWorkflowsByTag returns empty for unknown tag', async () => {
      expect(await adapter.getWorkflowsByTag('zzz_missing')).toHaveLength(0)
    })

    it('searchWorkflows finds matching workflows', async () => {
      const results = await adapter.searchWorkflows('rating')
      expect(results.some((w) => w.name === 'rate_book')).toBe(true)
    })
  })
})
