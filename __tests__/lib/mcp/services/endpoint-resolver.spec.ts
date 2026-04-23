import {
  EndpointResolver,
  MissingParentError
} from '../../../../src/mcp/services/endpoint-resolver.js'
import type { ModelConfig } from '../../../../src/mcp/tools/base-tool.js'

describe('lib/mcp/services/endpoint-resolver', () => {
  // =========================================================================
  // Helpers
  // =========================================================================

  function makeConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
    return { endpoint: 'books', ...overrides }
  }

  // =========================================================================
  // resolveCollection
  // =========================================================================

  describe('resolveCollection', () => {
    it('returns modelConfig.endpoint by default', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveCollection({
        model: 'book',
        modelConfig: makeConfig()
      })
      expect(result).toBe('books')
    })

    it('uses parentPath when provided', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveCollection({
        model: 'book',
        modelConfig: makeConfig(),
        parentPath: 'authors/42/books'
      })
      expect(result).toBe('authors/42/books')
    })

    it('parentPath takes priority over default endpoint', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveCollection({
        model: 'book',
        modelConfig: makeConfig(),
        parentPath: 'custom/path/books'
      })
      expect(result).toBe('custom/path/books')
    })

    describe('nested-only models (standalone: false)', () => {
      it('throws MissingParentError when no parentPath', () => {
        const resolver = new EndpointResolver()
        expect(() =>
          resolver.resolveCollection({
            model: 'scheduling',
            modelConfig: makeConfig({
              endpoint: 'schedulings',
              api: {
                parent: 'title',
                standalone: false
              }
            })
          })
        ).toThrow(MissingParentError)
      })

      it('resolves when parentPath is provided', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveCollection({
          model: 'scheduling',
          modelConfig: makeConfig({
            endpoint: 'schedulings',
            api: {
              parent: 'title',
              standalone: false
            }
          }),
          parentPath: 'titles/99/schedulings'
        })
        expect(result).toBe('titles/99/schedulings')
      })

      it('includes parent models in error message', () => {
        const resolver = new EndpointResolver()
        expect(() =>
          resolver.resolveCollection({
            model: 'scheduling',
            modelConfig: makeConfig({
              endpoint: 'schedulings',
              api: {
                parent: ['title', 'title_group'],
                standalone: false
              }
            })
          })
        ).toThrow(/title, title_group/)
      })
    })
  })

  // =========================================================================
  // resolveRecord
  // =========================================================================

  describe('resolveRecord', () => {
    it('returns endpoint/recordId by default', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveRecord({
        model: 'book',
        modelConfig: makeConfig(),
        recordId: '123'
      })
      expect(result).toBe('books/123')
    })

    it('returns bare endpoint when no recordId', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveRecord({
        model: 'book',
        modelConfig: makeConfig()
      })
      expect(result).toBe('books')
    })

    describe('compound ID support', () => {
      it('uses compound ID as full path', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveRecord({
          model: 'asset',
          modelConfig: makeConfig({ endpoint: 'assets' }),
          recordId: 'titles/42/assets/7'
        })
        expect(result).toBe('titles/42/assets/7')
      })

      it('applies namespace to compound IDs', () => {
        const resolver = new EndpointResolver({ namespace: 'api/v1' })
        const result = resolver.resolveRecord({
          model: 'asset',
          modelConfig: makeConfig({ endpoint: 'assets' }),
          recordId: 'titles/42/assets/7'
        })
        expect(result).toBe('api/v1/titles/42/assets/7')
      })

      it('per-action override takes priority over compound ID', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveRecord(
          {
            model: 'book',
            modelConfig: makeConfig({
              api: { endpoints: { update: 'books/:id/revise' } }
            }),
            recordId: 'authors/42/books/7'
          },
          'update'
        )
        // Override wins — :id gets the full compound ID
        expect(result).toBe('books/authors/42/books/7/revise')
      })
    })
  })

  // =========================================================================
  // Namespace resolution
  // =========================================================================

  describe('namespace resolution', () => {
    it('applies server-wide namespace', () => {
      const resolver = new EndpointResolver({ namespace: 'api/v1' })
      const result = resolver.resolveCollection({
        model: 'book',
        modelConfig: makeConfig()
      })
      expect(result).toBe('api/v1/books')
    })

    it('applies server-wide namespace to record endpoints', () => {
      const resolver = new EndpointResolver({ namespace: 'api/v1' })
      const result = resolver.resolveRecord({
        model: 'book',
        modelConfig: makeConfig(),
        recordId: '123'
      })
      expect(result).toBe('api/v1/books/123')
    })

    it('model-level namespace overrides server-wide', () => {
      const resolver = new EndpointResolver({ namespace: 'api/v1' })
      const result = resolver.resolveCollection({
        model: 'book',
        modelConfig: makeConfig({ api: { namespace: 'api/v2' } })
      })
      expect(result).toBe('api/v2/books')
    })

    it('no namespace when neither server nor model defines one', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveCollection({
        model: 'book',
        modelConfig: makeConfig()
      })
      expect(result).toBe('books')
    })
  })

  // =========================================================================
  // Endpoint overrides (per-action)
  // =========================================================================

  describe('endpoint overrides', () => {
    it('uses collection override for list action', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveCollection(
        {
          model: 'book',
          modelConfig: makeConfig({
            api: { endpoints: { collection: 'catalogue/book-items' } }
          })
        },
        'list'
      )
      expect(result).toBe('catalogue/book-items')
    })

    it('uses per-action create override', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveCollection(
        {
          model: 'book',
          modelConfig: makeConfig({
            api: { endpoints: { create: 'books/draft' } }
          })
        },
        'create'
      )
      expect(result).toBe('books/draft')
    })

    it('per-action override takes priority over collection override', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveCollection(
        {
          model: 'book',
          modelConfig: makeConfig({
            api: { endpoints: { collection: 'catalogue/items', create: 'books/draft' } }
          })
        },
        'create'
      )
      expect(result).toBe('books/draft')
    })

    it('uses record override with :id substitution', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveRecord(
        {
          model: 'book',
          modelConfig: makeConfig({
            api: { endpoints: { record: 'catalogue/book-items/:id' } }
          }),
          recordId: '456'
        },
        'find'
      )
      expect(result).toBe('catalogue/book-items/456')
    })

    it('uses per-action update override with :id substitution', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveRecord(
        {
          model: 'book',
          modelConfig: makeConfig({
            api: { endpoints: { update: 'books/:id/revise' } }
          }),
          recordId: '789'
        },
        'update'
      )
      expect(result).toBe('books/789/revise')
    })

    it('uses per-action delete override', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveRecord(
        {
          model: 'book',
          modelConfig: makeConfig({
            api: { endpoints: { delete: 'books/:id/archive' } }
          }),
          recordId: '10'
        },
        'delete'
      )
      expect(result).toBe('books/10/archive')
    })

    it('falls back to default when action has no override', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveRecord(
        {
          model: 'book',
          modelConfig: makeConfig({
            api: { endpoints: { create: 'books/draft' } }
          }),
          recordId: '123'
        },
        'find'
      )
      expect(result).toBe('books/123')
    })
  })

  // =========================================================================
  // pathForType
  // =========================================================================

  describe('pathForType', () => {
    it('returns modelConfig.endpoint by default', () => {
      const resolver = new EndpointResolver()
      const config = makeConfig({ endpoint: 'book-items' })
      expect(resolver.pathForType('book', config)).toBe('book-items')
    })

    it('can be overridden in subclasses', () => {
      class DasherizedResolver extends EndpointResolver {
        override pathForType(model: string): string {
          return model.replace(/_/g, '-') + 's'
        }
      }
      const resolver = new DasherizedResolver()
      const result = resolver.resolveCollection({
        model: 'book_item',
        modelConfig: makeConfig({ endpoint: 'book_items' })
      })
      expect(result).toBe('book-items')
    })
  })

  // =========================================================================
  // Combined: namespace + overrides
  // =========================================================================

  describe('namespace + overrides interaction', () => {
    it('overrides bypass namespace (overrides are full paths)', () => {
      const resolver = new EndpointResolver({ namespace: 'api/v1' })
      const result = resolver.resolveCollection(
        {
          model: 'book',
          modelConfig: makeConfig({
            api: { endpoints: { collection: 'catalogue/book-items' } }
          })
        },
        'list'
      )
      // Overrides are explicit — they bypass namespace
      expect(result).toBe('catalogue/book-items')
    })

    it('parentPath bypasses namespace (paths are explicit)', () => {
      const resolver = new EndpointResolver({ namespace: 'api/v1' })
      const result = resolver.resolveCollection({
        model: 'scheduling',
        modelConfig: makeConfig({
          endpoint: 'schedulings',
          api: {
            parent: 'title',
            standalone: false
          }
        }),
        parentPath: 'titles/99/schedulings'
      })
      // Parent paths are explicit — bypass namespace
      expect(result).toBe('titles/99/schedulings')
    })
  })
})
