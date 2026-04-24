import {
  EndpointResolver,
  MissingParentError,
  UnknownActionError
} from '../../../../src/mcp/services/endpoint-resolver.js'
import type { ModelConfig } from '../../../../src/mcp/tools/base-tool.js'

describe('lib/mcp/services/endpoint-resolver', () => {
  // =========================================================================
  // Helpers
  // =========================================================================

  function makeConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
    const { api: apiOverrides, ...rest } = overrides
    return { api: { endpoint: 'books', ...apiOverrides }, ...rest }
  }

  // =========================================================================
  // resolveCollection
  // =========================================================================

  describe('resolveCollection', () => {
    it('returns modelConfig.api.endpoint by default', () => {
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
              api: {
                endpoint: 'schedulings',
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
            api: {
              endpoint: 'schedulings',
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
              api: {
                endpoint: 'schedulings',
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
          modelConfig: makeConfig({ api: { endpoint: 'assets' } }),
          recordId: 'titles/42/assets/7'
        })
        expect(result).toBe('titles/42/assets/7')
      })

      it('applies namespace to compound IDs', () => {
        const resolver = new EndpointResolver({ namespace: 'api/v1' })
        const result = resolver.resolveRecord({
          model: 'asset',
          modelConfig: makeConfig({ api: { endpoint: 'assets' } }),
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
    it('returns modelConfig.api.endpoint by default', () => {
      const resolver = new EndpointResolver()
      const config = makeConfig({ api: { endpoint: 'book-items' } })
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
        modelConfig: makeConfig({ api: { endpoint: 'book_items' } })
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
          api: {
            endpoint: 'schedulings',
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

  // =========================================================================
  // resolveAction
  // =========================================================================

  describe('resolveAction', () => {
    function makeActionConfig(
      actions: Record<string, { method?: string; path: string; [k: string]: unknown }>,
      apiOverrides: Record<string, unknown> = {}
    ): ModelConfig {
      return makeConfig({ api: { actions, ...apiOverrides } })
    }

    it('resolves a simple record action with :id substitution', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveAction({
        model: 'book',
        modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }),
        action: 'publish',
        recordId: '42'
      })
      expect(result).toEqual({ url: 'books/42/publish', method: 'POST' })
    })

    it('defaults method to POST', () => {
      const resolver = new EndpointResolver()
      const { method } = resolver.resolveAction({
        model: 'book',
        modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }),
        action: 'publish',
        recordId: '1'
      })
      expect(method).toBe('POST')
    })

    it('respects explicit method', () => {
      const resolver = new EndpointResolver()
      const { method } = resolver.resolveAction({
        model: 'book',
        modelConfig: makeActionConfig({
          export: { path: ':id/export', method: 'GET' }
        }),
        action: 'export',
        recordId: '1'
      })
      expect(method).toBe('GET')
    })

    it('resolves collection-level action (no :id)', () => {
      const resolver = new EndpointResolver()
      const result = resolver.resolveAction({
        model: 'book',
        modelConfig: makeActionConfig({
          bulk_publish: { path: 'bulk-publish' }
        }),
        action: 'bulk_publish'
      })
      expect(result).toEqual({ url: 'books/bulk-publish', method: 'POST' })
    })

    describe('compound ID support', () => {
      it('uses compound ID as full path (skips base prepend)', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveAction({
          model: 'asset',
          modelConfig: makeActionConfig(
            { publish: { path: ':id/publish' } },
            { endpoint: 'assets' }
          ),
          action: 'publish',
          recordId: 'titles/42/assets/7'
        })
        expect(result).toEqual({ url: 'titles/42/assets/7/publish', method: 'POST' })
      })

      it('applies namespace to compound ID paths', () => {
        const resolver = new EndpointResolver({ namespace: 'api/v1' })
        const result = resolver.resolveAction({
          model: 'asset',
          modelConfig: makeActionConfig(
            { publish: { path: ':id/publish' } },
            { endpoint: 'assets' }
          ),
          action: 'publish',
          recordId: 'titles/42/assets/7'
        })
        expect(result).toEqual({ url: 'api/v1/titles/42/assets/7/publish', method: 'POST' })
      })
    })

    describe('multi-param substitution (Rails-style)', () => {
      it('substitutes :id and :param_name from pathParams', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveAction({
          model: 'book',
          modelConfig: makeActionConfig({
            approve_chapter: { path: ':id/chapters/:chapter_id/approve' }
          }),
          action: 'approve_chapter',
          recordId: '42',
          pathParams: { chapter_id: '5' }
        })
        expect(result).toEqual({ url: 'books/42/chapters/5/approve', method: 'POST' })
      })

      it('substitutes multiple pathParams without :id', () => {
        const resolver = new EndpointResolver()
        const result = resolver.resolveAction({
          model: 'book',
          modelConfig: makeActionConfig({
            generate_report: { path: 'reports/:report_type/:year/generate', method: 'GET' }
          }),
          action: 'generate_report',
          pathParams: { report_type: 'sales', year: '2026' }
        })
        expect(result).toEqual({ url: 'books/reports/sales/2026/generate', method: 'GET' })
      })

      it('throws on unresolved path parameters', () => {
        const resolver = new EndpointResolver()
        expect(() =>
          resolver.resolveAction({
            model: 'book',
            modelConfig: makeActionConfig({
              approve_chapter: { path: ':id/chapters/:chapter_id/approve' }
            }),
            action: 'approve_chapter',
            recordId: '42'
            // no pathParams — :chapter_id unresolved
          })
        ).toThrow(/Unresolved path parameters.*:chapter_id/)
      })
    })

    describe('namespace resolution', () => {
      it('applies server-wide namespace', () => {
        const resolver = new EndpointResolver({ namespace: 'api/v1' })
        const result = resolver.resolveAction({
          model: 'book',
          modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }),
          action: 'publish',
          recordId: '42'
        })
        expect(result.url).toBe('api/v1/books/42/publish')
      })

      it('model-level namespace overrides server-wide', () => {
        const resolver = new EndpointResolver({ namespace: 'api/v1' })
        const result = resolver.resolveAction({
          model: 'book',
          modelConfig: makeActionConfig(
            { publish: { path: ':id/publish' } },
            { namespace: 'api/v2' }
          ),
          action: 'publish',
          recordId: '42'
        })
        expect(result.url).toBe('api/v2/books/42/publish')
      })
    })

    describe('error handling', () => {
      it('throws UnknownActionError for undefined action', () => {
        const resolver = new EndpointResolver()
        expect(() =>
          resolver.resolveAction({
            model: 'book',
            modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }),
            action: 'archive',
            recordId: '42'
          })
        ).toThrow(UnknownActionError)
      })

      it('includes available actions in error message', () => {
        const resolver = new EndpointResolver()
        expect(() =>
          resolver.resolveAction({
            model: 'book',
            modelConfig: makeActionConfig({
              publish: { path: ':id/publish' },
              archive: { path: ':id/archive' }
            }),
            action: 'unknown',
            recordId: '42'
          })
        ).toThrow(/publish, archive/)
      })

      it('throws UnknownActionError when model has no actions', () => {
        const resolver = new EndpointResolver()
        expect(() =>
          resolver.resolveAction({
            model: 'book',
            modelConfig: makeConfig(),
            action: 'publish',
            recordId: '42'
          })
        ).toThrow(UnknownActionError)
      })
    })
  })
})
