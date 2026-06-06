import { describe, expect, it } from 'vitest'

import {
  ActionResolver,
  customActionsConfig,
  UnknownActionError
} from '#src/mcp/data-layer/api-extensions/custom-actions/custom-actions.js'

import { EndpointResolver } from '../../../../../../src/mcp/data-layer/model-service/endpoint-resolver.js'
import type { ModelConfig } from '../../../../../../src/mcp/tools/base-tool.js'

describe('api-extensions/custom-actions — ActionResolver', () => {
  function makeActionConfig(
    actions: Record<
      string,
      { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; rawPayload?: boolean }
    >,
    apiOverrides: Record<string, unknown> = {}
  ): ModelConfig {
    return {
      api: { endpoint: 'books', ...apiOverrides },
      extensions: {
        'custom-actions': customActionsConfig({ actions })
      }
    } as ModelConfig
  }

  function makeResolver(namespace?: string): ActionResolver {
    return new ActionResolver(new EndpointResolver(namespace ? { namespace } : undefined))
  }

  it('resolves a simple record action with :id substitution', () => {
    const result = makeResolver().resolveAction({
      model: 'book',
      modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }),
      action: 'publish',
      recordId: '42'
    })
    expect(result).toEqual({ url: 'books/42/publish', method: 'POST' })
  })

  it('defaults method to POST', () => {
    const { method } = makeResolver().resolveAction({
      model: 'book',
      modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }),
      action: 'publish',
      recordId: '1'
    })
    expect(method).toBe('POST')
  })

  it('respects explicit method', () => {
    const { method } = makeResolver().resolveAction({
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
    const result = makeResolver().resolveAction({
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
      const result = makeResolver().resolveAction({
        model: 'asset',
        modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }, { endpoint: 'assets' }),
        action: 'publish',
        recordId: 'titles/42/assets/7'
      })
      expect(result).toEqual({ url: 'titles/42/assets/7/publish', method: 'POST' })
    })

    it('applies namespace to compound ID paths', () => {
      const result = makeResolver('api/v1').resolveAction({
        model: 'asset',
        modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }, { endpoint: 'assets' }),
        action: 'publish',
        recordId: 'titles/42/assets/7'
      })
      expect(result).toEqual({ url: 'api/v1/titles/42/assets/7/publish', method: 'POST' })
    })
  })

  describe('multi-param substitution (Rails-style)', () => {
    it('substitutes :id and :param_name from pathParams', () => {
      const result = makeResolver().resolveAction({
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
      const result = makeResolver().resolveAction({
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
      expect(() =>
        makeResolver().resolveAction({
          model: 'book',
          modelConfig: makeActionConfig({
            approve_chapter: { path: ':id/chapters/:chapter_id/approve' }
          }),
          action: 'approve_chapter',
          recordId: '42'
        })
      ).toThrow(/Unresolved path parameters.*:chapter_id/)
    })
  })

  describe('namespace resolution', () => {
    it('applies server-wide namespace', () => {
      const result = makeResolver('api/v1').resolveAction({
        model: 'book',
        modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }),
        action: 'publish',
        recordId: '42'
      })
      expect(result.url).toBe('api/v1/books/42/publish')
    })

    it('model-level namespace overrides server-wide', () => {
      const result = makeResolver('api/v1').resolveAction({
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
      expect(() =>
        makeResolver().resolveAction({
          model: 'book',
          modelConfig: makeActionConfig({ publish: { path: ':id/publish' } }),
          action: 'archive',
          recordId: '42'
        })
      ).toThrow(UnknownActionError)
    })

    it('includes available actions in error message', () => {
      expect(() =>
        makeResolver().resolveAction({
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

    it('throws UnknownActionError when model has no actions slice', () => {
      expect(() =>
        makeResolver().resolveAction({
          model: 'book',
          modelConfig: { api: { endpoint: 'books' } } as ModelConfig,
          action: 'publish',
          recordId: '42'
        })
      ).toThrow(UnknownActionError)
    })
  })
})
