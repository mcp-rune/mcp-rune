import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { createInMemoryDataLayer, loadFixturesFromJson } from '@mcp-rune/mcp-rune/core'
import { createDefaultAppRegistry } from '@mcp-rune/mcp-rune/apps'
import { BasePromptRegistry, STRATEGY_TOOL_CLASSES } from '@mcp-rune/mcp-rune/prompts'
import { createServer } from '@mcp-rune/mcp-rune/server'
import { DATA_TOOL_CLASSES, ToolRegistry } from '@mcp-rune/mcp-rune/tools'
import type { ApiClient, StubFixtures } from '@mcp-rune/mcp-rune/core'

import { generateBookFixtures, generateGraphFixtures } from './fixtures/generate-books.js'
import { Author } from './models/author.js'
import { Book } from './models/book.js'
import { Genre } from './models/genre.js'
import { BookPrompt } from './prompts/book-prompt.js'

const MODEL_CLASSES = { book: Book, author: Author, genre: Genre }

const promptRegistry = new BasePromptRegistry()
promptRegistry.register('book', BookPrompt, {
  description: Book.description,
  required: true,
  model: 'book'
})

// In-memory DataLayer with a seed dataset so list/find/search return
// something interesting on first run. The dataset shape is selectable
// via `BOOKSHELF_DATASET`:
//
//   unset    → 3 hand-picked seed books (the default 10-minute quickstart).
//   "large"  → 5,000 procedurally-generated books with deliberate signal
//              for each summary strategy (distribution / coverage /
//              anomaly / temporal / entity-extraction). See
//              docs/guides/analysis-quickstart-guide.md.
//   "json"   → the same 5,000-book dataset loaded from
//              fixtures/books.5000.json, demonstrating
//              `loadFixturesFromJson`.
//   "graph"  → 500 books + author + genre collections with proper FKs
//              (author_id, genre_id). Exercises analysis_ingest hop_depth
//              + record embeddings + relationship-coverage strategy.
//
// To wire a real backend, replace `createInMemoryDataLayer` with the
// default ModelService + ApiClient path — see
// docs/guides/data-layer-guide.md ("Swapping the Adapter").
const STARTER_FIXTURES: StubFixtures = {
  book: {
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
}

function resolveFixtures(): StubFixtures {
  const mode = (process.env.BOOKSHELF_DATASET ?? '').toLowerCase()
  if (mode === 'large') return generateBookFixtures(5000)
  if (mode === 'graph') return generateGraphFixtures(500)
  if (mode === 'json') {
    const here = dirname(fileURLToPath(import.meta.url))
    return loadFixturesFromJson(resolve(here, 'fixtures/books.5000.json'))
  }
  return STARTER_FIXTURES
}

const fixtures = resolveFixtures()
// idGenerator starts after the seeded record count so newly-created
// books don't overwrite pre-seeded ones (default generator starts at 1).
let nextBookId = Object.keys(fixtures.book ?? {}).length
const dataLayer = createInMemoryDataLayer({
  fixtures,
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

// MCP Apps — interactive UI widgets (list, detail, form, multi-pick-model-app, search,
// pick-model-app). One call wires all six.
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
