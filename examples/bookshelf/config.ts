import { createServer } from 'mcp-kit/server'
import { DATA_TOOL_CLASSES } from 'mcp-kit/tools'
import { STRATEGY_TOOL_CLASSES } from 'mcp-kit/prompts'
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
    namespace: 'bookshelf',
    description: 'personal book library'
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
          const apiClient = { /* inject your API client here */ }
          tool.apiClient = apiClient as never
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

/** Create MCP server instance for this bookshelf server */
export const mcpConfig = {
  name: 'bookshelf-mcp',

  createServer({ getAccessToken }: { sessionId?: string; getAccessToken: () => Promise<string> }) {
    return createServer({
      name: 'bookshelf-mcp',
      version: '1.0.0',
      toolRegistry,
      promptRegistry,
      getAccessToken
    })
  }
}
