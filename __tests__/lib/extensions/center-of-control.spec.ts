/**
 * Tests for the built-in `centerOfControlExtension` and the surrounding
 * tool-flow extension surface on `AppRegistry`.
 */

const { mockRegisterAppTool, mockRegisterAppResource, mockLogger } = vi.hoisted(() => ({
  mockRegisterAppTool: vi.fn(),
  mockRegisterAppResource: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: mockRegisterAppTool,
  registerAppResource: mockRegisterAppResource,
  RESOURCE_MIME_TYPE: 'text/html;profile=mcp-app'
}))

vi.mock('#src/services/logger.js', () => mockLogger)

import { z } from 'zod'

import { centerOfControlExtension } from '../../../src/extensions/center-of-control.js'
import { AppRegistry } from '../../../src/mcp/apps/registry.js'
import type {
  ToolFlowExtensionContext,
  ToolFlowExtensionMap
} from '../../../src/mcp/extensions/tool-flow.js'

function makeFormApp() {
  return {
    resourceUri: 'ui://test/model-form',
    toolName: 'create_model_form',
    needsAuth: true,
    name: 'Create Model Form',
    description: 'Form',
    toolDescription: 'Open form',
    toolInputSchema: {
      model: z.enum(['book', 'tag']).describe('Model to create')
    },
    handleToolCall: async () => ({ content: [{ type: 'text' as const, text: '{}' }] }),
    getHtml: () => '<html></html>'
  }
}

function buildContext(
  registry: AppRegistry,
  overrides: Partial<ToolFlowExtensionContext> = {}
): { ctx: ToolFlowExtensionContext; extraContext: Record<string, unknown> } {
  const extraContext: Record<string, unknown> = {}
  const ctx: ToolFlowExtensionContext = {
    name: 'centerOfControl',
    mcpName: 'test-server',
    registerTool: (app) => {
      registry.registerApp(app)
    },
    getApp: (toolName) => registry.getApp(toolName),
    setFormSubmitMode: (mode) => registry.setFormSubmitMode(mode),
    provideContext: (key, value) => {
      extraContext[key.name] = value
    },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never,
    ...overrides
  }
  return { ctx, extraContext }
}

describe('lib/mcp/apps/registry — tool-flow surface', () => {
  it('defaults form submit mode to "direct"', () => {
    const registry = new AppRegistry()
    expect(registry.getFormSubmitMode()).toBe('direct')
  })

  it('exposes registerApp and getApp for extension authors', () => {
    const registry = new AppRegistry()
    const app = makeFormApp()
    registry.registerApp(app)
    expect(registry.getApp('create_model_form')).toBe(app)
    expect(registry.getToolNames()).toContain('create_model_form')
  })

  it('rejects registerApp when toolName is missing', () => {
    const registry = new AppRegistry()
    expect(() =>
      registry.registerApp({
        name: 'No tool',
        description: 'Nope'
      } as never)
    ).toThrow(/toolName is required/)
  })
})

describe('lib/extensions/center-of-control', () => {
  it('declares "apps" as a required capability', () => {
    expect(centerOfControlExtension.requires).toEqual(['apps'])
  })

  it('flips formSubmitMode to "collect" and registers the form-data tools', async () => {
    const registry = new AppRegistry([makeFormApp()])
    const { ctx, extraContext } = buildContext(registry)

    await centerOfControlExtension.register(ctx)

    expect(registry.getFormSubmitMode()).toBe('collect')
    expect(registry.getApp('collect_form_data')).toBeDefined()
    expect(registry.getApp('get_form_data')).toBeDefined()
    expect(extraContext.formDataStore).toBeDefined()
  })

  it('clones the create_model_form app resourceUri + getHtml onto collect_form_data', async () => {
    const formApp = makeFormApp()
    const registry = new AppRegistry([formApp])
    const { ctx } = buildContext(registry)

    await centerOfControlExtension.register(ctx)

    const collectTool = registry.getApp('collect_form_data')!
    expect(collectTool.resourceUri).toBe(formApp.resourceUri)
    expect(collectTool.getHtml?.()).toBe(formApp.getHtml())
  })

  it('throws when create_model_form is not registered', () => {
    const registry = new AppRegistry()
    const { ctx } = buildContext(registry)

    expect(() => centerOfControlExtension.register(ctx)).toThrow(
      /create_model_form.*app is required/
    )
  })

  it('preserves the model enum from create_model_form on collect_form_data', async () => {
    const registry = new AppRegistry([makeFormApp()])
    const { ctx } = buildContext(registry)

    await centerOfControlExtension.register(ctx)

    const collectTool = registry.getApp('collect_form_data')!
    const modelSchema = collectTool.toolInputSchema!.model as z.ZodEnum<['book', 'tag']>
    expect(modelSchema.options).toEqual(['book', 'tag'])
  })
})

describe('AppRegistry.registerTools — extension context wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('threads formSubmitMode and extraContext through every handler context', async () => {
    const handleToolCall = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }]
    }))
    const app = {
      resourceUri: 'ui://test/sample',
      toolName: 'sample',
      needsAuth: false,
      name: 'Sample',
      description: '',
      toolDescription: '',
      toolInputSchema: {},
      handleToolCall,
      getHtml: () => ''
    }
    const registry = new AppRegistry([app])
    registry.setFormSubmitMode('collect')

    registry.registerTools({} as never, { extraContext: { greeting: 'hi' } })

    const handler = mockRegisterAppTool.mock.calls[0][3]
    await handler({}, {})

    expect(handleToolCall).toHaveBeenCalledTimes(1)
    const ctxArg = handleToolCall.mock.calls[0][1] as Record<string, unknown>
    expect(ctxArg.formSubmitMode).toBe('collect')
    expect(ctxArg.greeting).toBe('hi')
  })

  it('defaults formSubmitMode in context to "direct" when not flipped', async () => {
    const handleToolCall = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }]
    }))
    const app = {
      resourceUri: 'ui://test/sample',
      toolName: 'sample',
      needsAuth: false,
      name: 'Sample',
      description: '',
      toolDescription: '',
      toolInputSchema: {},
      handleToolCall,
      getHtml: () => ''
    }
    const registry = new AppRegistry([app])

    registry.registerTools({} as never)

    const handler = mockRegisterAppTool.mock.calls[0][3]
    await handler({}, {})

    const ctxArg = handleToolCall.mock.calls[0][1] as Record<string, unknown>
    expect(ctxArg.formSubmitMode).toBe('direct')
  })
})

// Type-only smoke test: the public ToolFlowExtensionMap type accepts the
// built-in extension under its conventional `centerOfControl` key.
const _example: ToolFlowExtensionMap = { centerOfControl: centerOfControlExtension }
void _example
