import { createInMemoryDataLayer } from '@mcp-rune/mcp-rune/core'
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { BasePromptRegistry, STRATEGY_TOOL_CLASSES } from '@mcp-rune/mcp-rune/prompts'
import { createServer } from '@mcp-rune/mcp-rune/server'
import { DATA_TOOL_CLASSES, ToolRegistry } from '@mcp-rune/mcp-rune/tools'
import type { ApiClient } from '@mcp-rune/mcp-rune/core'

import { Book } from './models/book.js'
import { BookPrompt } from './prompts/book-prompt.js'

const MODEL_CLASSES = { book: Book }

const promptRegistry = new BasePromptRegistry()
promptRegistry.register('book', BookPrompt, {
  description: Book.description,
  required: true,
  model: 'book'
})

// In-memory DataLayer with a few seed books so list/find/search return
// something interesting on first run. To wire a real backend, replace
// `createInMemoryDataLayer` with the default ModelService + ApiClient
// path — see docs/guides/data-layer-guide.md ("Swapping the Adapter").
const BOOK_FIXTURES = {
  '1': {
    id: '1',
    title: 'Clean Code',
    author: 'Robert C. Martin',
    status: 'completed',
    rating: 5
  },
  '2': {
    id: '2',
    title: 'The Pragmatic Programmer',
    author: 'Andrew Hunt and David Thomas',
    status: 'reading'
  },
  '3': {
    id: '3',
    title: 'Design Patterns',
    author: 'Erich Gamma et al.',
    status: 'unread'
  }
}

// idGenerator starts after the seed fixtures so newly-created books don't
// overwrite the pre-seeded ones (default generator starts at 1).
let nextBookId = Object.keys(BOOK_FIXTURES).length
const dataLayer = createInMemoryDataLayer({
  fixtures: { book: BOOK_FIXTURES },
  idGenerator: () => String(++nextBookId)
})

// The in-memory adapter never touches an ApiClient, but ToolRegistry still
// requires a factory for auth-gated tools. The Proxy surfaces a clear error
// if anything accidentally tries to make an HTTP call.
const stubApiClient = new Proxy({} as ApiClient, {
  get() {
    throw new Error('In-memory DataLayer is active; HTTP ApiClient should not be invoked.')
  }
})

const toolRegistry = new ToolRegistry({
  toolClasses: { ...DATA_TOOL_CLASSES, ...STRATEGY_TOOL_CLASSES },
  models: MODEL_CLASSES,
  serverContext: { name: 'Bookshelf' },
  namespace: 'bookshelf',
  promptRegistry,
  createApiClient: () => stubApiClient,
  dataLayer
})

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
