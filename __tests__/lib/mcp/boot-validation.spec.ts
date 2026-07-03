import { createDefaultAppRegistry } from '../../../src/mcp/apps/lib/create-default-registry.js'
import { BasePromptRegistry } from '../../../src/mcp/prompts/prompt-registry.js'
import { SchemaValidationError } from '../../../src/mcp/schema/schema-validation-error.js'
import { createServer } from '../../../src/mcp/server-factory.js'
import { ToolRegistry } from '../../../src/mcp/tools/tool-registry.js'

const badModels = {
  book: {
    modelName: 'book',
    singularName: 'book',
    api: { endpoint: 'books' },
    attributes: {
      title: { type: 'strng' }
    }
  }
} as any

const goodModels = {
  book: {
    modelName: 'book',
    singularName: 'book',
    api: { endpoint: 'books' },
    attributes: {
      title: { type: 'string' }
    }
  }
} as any

function serverConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'boot-validation-probe',
    version: '0.0.0',
    sessionId: 'test',
    transport: 'stdio',
    getAccessToken: async () => 'token',
    ...overrides
  } as any
}

describe('lib/mcp/boot-validation', () => {
  describe('createServer', () => {
    it('throws SchemaValidationError for declaration errors by default', () => {
      const toolRegistry = new ToolRegistry({ toolClasses: {}, models: badModels })
      expect(() => createServer(serverConfig({ toolRegistry }))).toThrow(SchemaValidationError)
      expect(() => createServer(serverConfig({ toolRegistry }))).toThrow(/unknown type "strng"/)
    })

    it("validate: 'warn' logs and continues", () => {
      const toolRegistry = new ToolRegistry({ toolClasses: {}, models: badModels })
      expect(() => createServer(serverConfig({ toolRegistry, validate: 'warn' }))).not.toThrow()
    })

    it("validate: 'off' skips validation entirely", () => {
      const toolRegistry = new ToolRegistry({ toolClasses: {}, models: badModels })
      expect(() => createServer(serverConfig({ toolRegistry, validate: 'off' }))).not.toThrow()
    })

    it('passes clean registries silently', () => {
      const toolRegistry = new ToolRegistry({ toolClasses: {}, models: goodModels })
      expect(() => createServer(serverConfig({ toolRegistry }))).not.toThrow()
    })

    it('includes model-bound prompt classes from the prompt registry', () => {
      const toolRegistry = new ToolRegistry({ toolClasses: {}, models: goodModels })
      const promptRegistry = new BasePromptRegistry()
      promptRegistry.register(
        'book_prompt',
        {
          formStrategy: 'statefull',
          fieldGroups: {},
          sections: {},
          fieldDefinitions: {}
        } as any,
        { model: 'book' }
      )
      expect(() => createServer(serverConfig({ toolRegistry, promptRegistry }))).toThrow(
        /formStrategy "statefull" is not a registered form strategy/
      )
    })
  })

  describe('BasePromptRegistry.getModelBoundClasses', () => {
    it('returns only model-bound classes keyed by model', () => {
      const registry = new BasePromptRegistry()
      const bound = { fieldGroups: {}, sections: {}, fieldDefinitions: {} } as any
      const unbound = { fieldGroups: {}, sections: {}, fieldDefinitions: {} } as any
      registry.register('book_prompt', bound, { model: 'book' })
      registry.register('helper_prompt', unbound)
      expect(registry.getModelBoundClasses()).toEqual({ book: bound })
    })
  })

  describe('createDefaultAppRegistry', () => {
    it('throws SchemaValidationError for declaration errors by default', () => {
      expect(() =>
        createDefaultAppRegistry({ modelClasses: badModels, namespace: 'probe' })
      ).toThrow(SchemaValidationError)
    })

    it("validate: 'off' returns the registry despite errors", () => {
      const registry = createDefaultAppRegistry({
        modelClasses: badModels,
        namespace: 'probe',
        validate: 'off'
      })
      expect(registry.size).toBeGreaterThan(0)
    })

    it('passes clean registries silently', () => {
      expect(() =>
        createDefaultAppRegistry({ modelClasses: goodModels, namespace: 'probe' })
      ).not.toThrow()
    })
  })
})
