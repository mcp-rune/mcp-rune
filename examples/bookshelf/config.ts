import { createServer } from '@mcp-rune/mcp-rune/server'
import { DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
import { STRATEGY_TOOL_CLASSES } from '@mcp-rune/mcp-rune/prompts'
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { Book } from './models/book.js'
import { BookPrompt } from './prompts/book-prompt.js'

// Model and prompt registries
const MODEL_CLASSES = { book: Book }

const promptRegistry = {
  getDefinitions() {
    return [{ name: 'book', description: Book.description, required: true }]
  },
  getPrompt(name: string) {
    if (name === 'book') return new BookPrompt()
    return null
  }
}

// Tool registry — registers CRUD + strategy tools
const toolRegistry = {
  serverContext: {
    name: 'Bookshelf',
    namespace: 'bookshelf'
  },

  registerTools(mcpServer: unknown) {
    const deps = {
      logger: console,
      models: MODEL_CLASSES,
      promptRegistry,
      serverContext: this.serverContext
    }

    // Register data tools (require auth — work when API backend is available)
    for (const [, ToolClass] of Object.entries(DATA_TOOL_CLASSES)) {
      const tool = new ToolClass(deps)
      ;(mcpServer as { tool: Function }).tool(
        tool.name,
        tool.baseDescription,
        tool.inputSchema,
        tool.annotations,
        async (args: Record<string, unknown>) => {
          // Inject a DataLayer adapter here. The default `ModelService`
          // adapter wraps an `ApiClient`; alternatives (in-memory stub,
          // third-party library) implement the same `DataLayer` interface.
          // Production servers should configure this on `ToolRegistry`
          // via the `dataLayer` factory option — this raw registration
          // path is shown for illustration only.
          tool.dataLayer = undefined
          return tool.execute(args)
        }
      )
    }

    // Register strategy tools (no auth needed — work immediately)
    for (const [, ToolClass] of Object.entries(STRATEGY_TOOL_CLASSES)) {
      const tool = new ToolClass(deps)
      ;(mcpServer as { tool: Function }).tool(
        tool.name,
        tool.baseDescription,
        tool.inputSchema,
        tool.annotations,
        async (args: Record<string, unknown>) => tool.execute(args)
      )
    }
  }
}

// MCP Apps — interactive UI widgets (list, detail, form, multi-select, search,
// autocomplete-picker). One call wires all six.
const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookshelf'
  // Per-deployment theming and custom-kind formatters slot in here.
  // Everything is declarative — the same descriptors drive iframe rendering,
  // the form HTML input type, prompt docs, and `validate_form` errors:
  //   themeOverrides: { cssVariables: { '--color-accent': '#0a84ff' } },
  //   formatters: {
  //     date: { display: { locale: 'en-GB' } },
  //     'string:isbn': {
  //       label: 'ISBN',
  //       htmlInputType: 'text',
  //       validation: { pattern: '^[0-9-]+$', minLength: 10, maxLength: 17 },
  //       display: { template: 'ISBN: {value}' }
  //     }
  //   }
})

/** Create MCP server instance for this bookshelf server */
export const mcpConfig = {
  name: 'bookshelf-mcp',

  createServer({
    sessionId,
    transport,
    getAccessToken
  }: {
    sessionId: string
    transport: string
    getAccessToken: () => Promise<string>
  }) {
    return createServer({
      name: 'bookshelf-mcp',
      version: '1.0.0',
      sessionId,
      transport,
      toolRegistry,
      promptRegistry,
      appRegistry,
      getAccessToken
    })
  }
}
