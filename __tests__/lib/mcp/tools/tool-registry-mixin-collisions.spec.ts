/**
 * Tests for ApiExtension ModelService mixin name-collision detection at boot.
 *
 * Mirrors the collision rules already enforced for tool names
 * (`api-extensions.md:224`) and summary-strategy names
 * (`api-extensions.md:303`): a mixin method registered by one extension that
 * a second extension also tries to register fails fast at `ToolRegistry`
 * construction with both contributor keys in the error message.
 */

import { describe, expect, it, vi } from 'vitest'

import type { ApiExtension } from '#src/mcp/data-layer/api-extensions/types.js'

import { ToolRegistry } from '../../../../src/mcp/tools/tool-registry.js'

vi.mock('#src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('#src/runtime/tracing.js', () => ({
  traceToolCall: vi.fn((_name, _args, handler) => handler())
}))

/** Build an ApiExtension that contributes the given mixin method names. */
function makeMixinExtension(methodNames: string[]): ApiExtension {
  return {
    register(ctx) {
      ctx.registerModelServiceMixin(() => {
        const methods: Record<string, () => unknown> = {}
        for (const name of methodNames) {
          methods[name] = () => undefined
        }
        return methods
      })
    }
  }
}

describe('lib/mcp/tools/tool-registry — mixin name collisions', () => {
  it('accepts two extensions with disjoint mixin method names', () => {
    expect(
      () =>
        new ToolRegistry({
          toolClasses: {},
          models: {},
          apiExtensions: {
            'ext-a': makeMixinExtension(['publish', 'archive']),
            'ext-b': makeMixinExtension(['restore'])
          }
        })
    ).not.toThrow()
  })

  it('throws at boot when two extensions register the same mixin method name', () => {
    expect(
      () =>
        new ToolRegistry({
          toolClasses: {},
          models: {},
          apiExtensions: {
            'ext-a': makeMixinExtension(['publish']),
            'ext-b': makeMixinExtension(['publish'])
          }
        })
    ).toThrow(
      /ApiExtension "ext-b" attempted to register ModelService mixin method "publish", which is already registered by "ext-a"/
    )
  })

  it('error message names both contributors and is unambiguous', () => {
    expect(() => {
      try {
        new ToolRegistry({
          toolClasses: {},
          models: {},
          apiExtensions: {
            stripe: makeMixinExtension(['charge']),
            'stripe-legacy': makeMixinExtension(['charge'])
          }
        })
      } catch (err) {
        expect((err as Error).message).toContain('"stripe-legacy"')
        expect((err as Error).message).toContain('"stripe"')
        expect((err as Error).message).toContain('"charge"')
        expect((err as Error).message).toContain('globally unique')
        throw err
      }
    }).toThrow()
  })

  it('detects collisions when one extension contributes multiple methods and another reuses one', () => {
    expect(
      () =>
        new ToolRegistry({
          toolClasses: {},
          models: {},
          apiExtensions: {
            'ext-a': makeMixinExtension(['publish', 'archive', 'restore']),
            'ext-b': makeMixinExtension(['archive'])
          }
        })
    ).toThrow(/mixin method "archive".*already registered by "ext-a"/)
  })

  it('detects collisions when a single extension registers two mixin factories with overlapping names', () => {
    const ext: ApiExtension = {
      register(ctx) {
        ctx.registerModelServiceMixin(() => ({ publish: () => undefined }))
        ctx.registerModelServiceMixin(() => ({ publish: () => undefined }))
      }
    }
    expect(
      () =>
        new ToolRegistry({
          toolClasses: {},
          models: {},
          apiExtensions: { ext }
        })
    ).toThrow(/mixin method "publish".*already registered/)
  })

  it('tolerates factories that dereference service properties at factory time', () => {
    // Some factories evaluate `service.endpointResolver` etc. in the factory
    // body (rather than only inside returned methods). The sentinel must not
    // crash on chained property access during boot-time name collection.
    const ext: ApiExtension = {
      register(ctx) {
        ctx.registerModelServiceMixin((service) => {
          const _helpers = service.endpointResolver
          const _api = service.apiClient
          return {
            publish: () => _helpers
          }
        })
      }
    }
    expect(
      () =>
        new ToolRegistry({
          toolClasses: {},
          models: {},
          apiExtensions: { ext }
        })
    ).not.toThrow()
  })
})
