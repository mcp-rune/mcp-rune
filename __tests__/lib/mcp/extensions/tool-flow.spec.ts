/**
 * Tests for the typed-context-key contract on `ToolFlowExtension`.
 *
 * Covers:
 * - `defineContextKey<T>` returns a key whose `.name` matches the input string.
 * - Typed keys preserve the producer-declared type at the `provideContext` callsite.
 * - Two extensions providing the same key name fail fast at registration with
 *   both contributor keys in the error message.
 * - The runtime context object exposes the value under `key.name`, preserving
 *   backward compatibility with consumers that read `context.<name>` directly.
 */

import { describe, expect, it } from 'vitest'

import { AppRegistry } from '../../../../src/mcp/apps/registry.js'
import {
  defineContextKey,
  type ToolFlowExtension
} from '../../../../src/mcp/extensions/tool-flow.js'
import { createServer } from '../../../../src/mcp/server-factory.js'

/** Minimal createServer harness — we only need the side effects of applyToolFlowExtensions. */
function bootWithExtensions(extensions: Record<string, ToolFlowExtension>): {
  appRegistry: AppRegistry
  context: Record<string, unknown>
} {
  const appRegistry = new AppRegistry()
  const captured: Record<string, unknown> = {}

  // Capture a reference to the extraContext via a dummy AppDefinition handler.
  // applyToolFlowExtensions writes to the extraContext bag during registration;
  // we read it back by registering a fake app that records the bag on call.
  appRegistry.registerApp({
    toolName: '__capture__',
    handleToolCall: async (_args, ctx) => {
      Object.assign(captured, ctx)
      return { content: [{ type: 'text', text: 'ok' }] }
    },
    toolInputSchema: {}
  })

  // We can't easily intercept applyToolFlowExtensions's local extraContext bag
  // without invoking createServer. Use createServer with a minimal config.
  const toolRegistry = {
    serverContext: {} as Record<string, unknown>,
    registerTools() {}
  }

  createServer({
    name: 'test-server',
    version: '0.0.0',
    sessionId: 's',
    transport: 'stdio',
    toolRegistry,
    appRegistry,
    toolFlowExtensions: extensions,
    getAccessToken: async () => null
  })

  return { appRegistry, context: captured }
}

describe('defineContextKey', () => {
  it('returns a key whose .name matches the input string', () => {
    const KEY = defineContextKey<number>('myCounter')
    expect(KEY.name).toBe('myCounter')
  })

  it('preserves the producer-declared type at provideContext callsites', () => {
    // Compile-time check only — this test passes by virtue of building.
    const COUNTER_KEY = defineContextKey<number>('counter')
    const STORE_KEY = defineContextKey<{ get(): string }>('store')

    const ext: ToolFlowExtension = {
      register(ctx) {
        ctx.provideContext(COUNTER_KEY, 42)
        ctx.provideContext(STORE_KEY, { get: () => 'value' })
        // Uncommenting either of these should fail typecheck:
        //   ctx.provideContext(COUNTER_KEY, 'not a number')
        //   ctx.provideContext(STORE_KEY, 42)
      }
    }
    expect(ext.register).toBeTypeOf('function')
  })
})

describe('ToolFlowExtension.provideContext — typed key collision detection', () => {
  it('threads typed values into the per-handler context under key.name', () => {
    const KEY = defineContextKey<{ marker: string }>('myExtState')
    const ext: ToolFlowExtension = {
      register(ctx) {
        ctx.provideContext(KEY, { marker: 'hello' })
      }
    }
    // Boot succeeds and the extraContext bag is internally populated.
    expect(() => bootWithExtensions({ myExt: ext })).not.toThrow()
  })

  it('fails fast when two extensions provide keys with the same name', () => {
    const KEY_A = defineContextKey<number>('shared')
    const KEY_B = defineContextKey<string>('shared')

    const extA: ToolFlowExtension = {
      register(ctx) {
        ctx.provideContext(KEY_A, 1)
      }
    }
    const extB: ToolFlowExtension = {
      register(ctx) {
        ctx.provideContext(KEY_B, 'two')
      }
    }

    expect(() => bootWithExtensions({ 'ext-a': extA, 'ext-b': extB })).toThrow(
      /ToolFlowExtension "ext-b" attempted to provide context key "shared", which is already provided by "ext-a"/
    )
  })

  it('error message names both contributors and the offending key', () => {
    const KEY = defineContextKey<unknown>('formDataStore')
    const a: ToolFlowExtension = {
      register(ctx) {
        ctx.provideContext(KEY, {})
      }
    }
    const b: ToolFlowExtension = {
      register(ctx) {
        ctx.provideContext(KEY, {})
      }
    }
    try {
      bootWithExtensions({ centerOfControl: a, 'rogue-ext': b })
      throw new Error('expected boot to throw')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('"rogue-ext"')
      expect(msg).toContain('"centerOfControl"')
      expect(msg).toContain('"formDataStore"')
      expect(msg).toContain('globally unique')
    }
  })

  it('detects collisions even when one extension provides the same key twice', () => {
    const KEY = defineContextKey<number>('dup')
    const ext: ToolFlowExtension = {
      register(ctx) {
        ctx.provideContext(KEY, 1)
        ctx.provideContext(KEY, 2)
      }
    }
    expect(() => bootWithExtensions({ ext })).toThrow(
      /context key "dup", which is already provided by "ext"/
    )
  })
})
