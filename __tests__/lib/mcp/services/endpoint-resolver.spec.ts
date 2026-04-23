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

    it('uses parentResource when provided (bulk operations)', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveCollection({
        model: 'book',
        modelConfig: makeConfig(),
        parentResource: 'authors/42/books'
      })
      expect(result).toBe('authors/42/books')
    })

    describe('nested routing', () => {
      it('resolves pathTemplate when parent ID is in attributes', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveCollection({
          model: 'book',
          modelConfig: makeConfig({
            api: {
              nested: {
                parent: 'author',
                pathTemplate: 'authors/:author_id/books',
                parentKey: 'author_id'
              }
            }
          }),
          attributes: { author_id: '42', title: 'Test' }
        })
        expect(result).toBe('authors/42/books')
      })

      it('falls back to base endpoint when parent ID is absent and not nestedOnly', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveCollection({
          model: 'book',
          modelConfig: makeConfig({
            api: {
              nested: {
                parent: 'author',
                pathTemplate: 'authors/:author_id/books',
                parentKey: 'author_id'
              }
            }
          }),
          attributes: { title: 'Test' }
        })
        expect(result).toBe('books')
      })

      it('throws MissingParentError when nestedOnly and parent ID is absent', () => {
        const resolver = new EndpointResolver()
        expect(() =>
          resolver.resolveCollection({
            model: 'scheduling',
            modelConfig: makeConfig({
              endpoint: 'schedulings',
              api: {
                nested: {
                  parent: 'title',
                  nestedOnly: true,
                  pathTemplate: 'titles/:title_id/schedulings',
                  parentKey: 'title_id'
                }
              }
            }),
            attributes: {}
          })
        ).toThrow(MissingParentError)
      })

      it('resolves nestedOnly when parent ID is provided', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveCollection({
          model: 'scheduling',
          modelConfig: makeConfig({
            endpoint: 'schedulings',
            api: {
              nested: {
                parent: 'title',
                nestedOnly: true,
                pathTemplate: 'titles/:title_id/schedulings',
                parentKey: 'title_id'
              }
            }
          }),
          attributes: { title_id: '99' }
        })
        expect(result).toBe('titles/99/schedulings')
      })
    })

    describe('parentResource takes priority over nested routing', () => {
      it('uses parentResource even when nested config exists', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveCollection({
          model: 'book',
          modelConfig: makeConfig({
            api: {
              nested: {
                parent: 'author',
                pathTemplate: 'authors/:author_id/books',
                parentKey: 'author_id'
              }
            }
          }),
          attributes: { author_id: '42' },
          parentResource: 'custom/path/books'
        })
        expect(result).toBe('custom/path/books')
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
  })

  // =========================================================================
  // resolveNested
  // =========================================================================

  describe('resolveNested', () => {
    it('builds parent/id/child path', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveNested(makeConfig({ endpoint: 'authors' }), '42', 'books')
      expect(result).toBe('authors/42/books')
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

    it('applies server-wide namespace to nested endpoints', () => {
      const resolver = new EndpointResolver({ namespace: 'api/v1' })
      const result = resolver.resolveNested(makeConfig({ endpoint: 'authors' }), '42', 'books')
      expect(result).toBe('api/v1/authors/42/books')
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

    it('nested routing bypasses namespace (templates are full paths)', () => {
      const resolver = new EndpointResolver({ namespace: 'api/v1' })
      const result = resolver.resolveCollection({
        model: 'scheduling',
        modelConfig: makeConfig({
          endpoint: 'schedulings',
          api: {
            nested: {
              parent: 'title',
              nestedOnly: true,
              pathTemplate: 'titles/:title_id/schedulings',
              parentKey: 'title_id'
            }
          }
        }),
        attributes: { title_id: '99' }
      })
      // Nested templates are explicit paths — bypass namespace
      expect(result).toBe('titles/99/schedulings')
    })
  })
})
