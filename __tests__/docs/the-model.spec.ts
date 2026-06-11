import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  editFile,
  installLinkedAndBuild,
  jsonOf,
  runeAdd,
  scaffold,
  textOf,
  withMcpClient
} from './lib/tutorial-harness'

// Chapter II "## Try it" sections. Each assertion mirrors a documented command
// or expected output; a drift in either the guide or the framework fails the
// matching `it`, naming the stale page. Pages that only read the base scaffold
// share one installed fixture; pages that hand-edit the model build their own.

type Row = Record<string, unknown>

// --- documented model edits (applied the way each guide tells the reader) ---

// associations.md step 2: add the convention + belongsTo to the generated Book.
const applyBelongsToAuthor = (src: string): string => {
  const withImport =
    "import { jsonApiConvention } from '@mcp-rune/mcp-rune/api-conventions'\n" + src
  const apiOld = "static override api = { endpoint: 'books' }"
  const apiNew =
    "static override api = { endpoint: 'books', convention: jsonApiConvention }\n\n" +
    '  static override associations = {\n' +
    "    belongsTo: { author: { target_model: 'author' as const, required: true } }\n" +
    '  }'
  return withImport.replace(apiOld, apiNew)
}

// validation-and-defaults.md setup: extend the attributes block.
const applyStatusRating = (src: string): string => {
  const open = 'static override attributes: Record<string, AttributeDefinition> = {'
  const inserted =
    open +
    '\n    status: {\n' +
    "      type: 'enum',\n" +
    "      enumValues: ['unread', 'reading', 'finished'],\n" +
    "      default: 'unread',\n" +
    "      description: 'Reading state'\n" +
    '    },\n' +
    '    rating: {\n' +
    "      type: 'integer',\n" +
    '      validation: { min: 1, max: 5 },\n' +
    "      description: '1-to-5 personal rating'\n" +
    '    },'
  return src.replace(open, inserted)
}

// The derived guide renders attribute names in backticks; match the row's
// substance (name/type/required) tolerant of backticks and column padding.
const tableRow = (attr: string, type: string, required: string) =>
  new RegExp('\\|\\s*`?' + attr + '`?\\s*\\|\\s*' + type + '\\s*\\|\\s*' + required + '\\s*\\|')

// Read-only pages share one base Book scaffold.
let plain: string

beforeAll(() => {
  plain = scaffold({ name: 'bookshelf-tour', models: 'Book' }).dir
  installLinkedAndBuild(plain)
})

describe('docs/guides/02-the-model/attributes-and-kinds.md', () => {
  it('list_models reports the wire shape (name/attributes/required)', async () => {
    await withMcpClient(plain, async (client) => {
      const [book] = jsonOf(await client.callTool({ name: 'list_models', arguments: {} })) as Row[]
      expect(book).toMatchObject({
        name: 'book',
        attributes: ['name', 'description'],
        required_attributes: ['name']
      })
    })
  })

  it('validate_form on an empty form returns the documented errors', async () => {
    await withMcpClient(plain, async (client) => {
      const out = await client.callTool({
        name: 'validate_form',
        arguments: { model: 'book', fields: {} }
      })
      expect(jsonOf(out)).toEqual({
        valid: false,
        ready_to_submit: false,
        errors: [{ field: 'name', message: 'Name is required' }],
        warnings: [],
        computed: {},
        fields: {}
      })
    })
  })

  it('get_prompt_guide renders the derived attribute table', async () => {
    await withMcpClient(plain, async (client) => {
      const text = textOf(
        await client.callTool({ name: 'get_prompt_guide', arguments: { guide_name: 'book' } })
      )
      expect(text).toMatch(tableRow('name', 'string', 'Yes'))
      expect(text).toMatch(tableRow('description', 'text', 'No'))
    })
  })
})

describe('docs/guides/02-the-model/derivation-overview.md', () => {
  it('list_models is fully derived from the Book class', async () => {
    await withMcpClient(plain, async (client) => {
      expect(jsonOf(await client.callTool({ name: 'list_models', arguments: {} }))).toEqual([
        {
          name: 'book',
          endpoint: 'books',
          description: 'A Book record',
          attributes: ['name', 'description'],
          required_attributes: ['name'],
          read_only: false
        }
      ])
    })
  })

  it('get_prompt_guide derives the attribute reference table', async () => {
    await withMcpClient(plain, async (client) => {
      const text = textOf(
        await client.callTool({ name: 'get_prompt_guide', arguments: { guide_name: 'book' } })
      )
      expect(text).toMatch(tableRow('name', 'string', 'Yes'))
      expect(text).toMatch(tableRow('description', 'text', 'No'))
    })
  })
})

describe('docs/guides/02-the-model/definition-vs-consumption.md', () => {
  const fw = () => join(plain, 'node_modules', '@mcp-rune', 'mcp-rune', 'dist', 'mcp')

  it('ships declarations (models/) separate from consumers (model-layer/, data-layer/)', () => {
    const models = readdirSync(fw() + '/models')
    expect(models).toContain('base-model.js')
    expect(models).toContain('kinds')
    expect(existsSync(join(fw(), 'model-layer'))).toBe(true)
    expect(existsSync(join(fw(), 'data-layer'))).toBe(true)
  })

  it('the simple-preset scaffold ships no eslint config of its own', () => {
    for (const f of [
      'eslint.config.js',
      'eslint.config.mjs',
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.json'
    ]) {
      expect(existsSync(join(plain, f))).toBe(false)
    }
  })
})

describe('docs/guides/02-the-model/defining-a-model.md', () => {
  let dir: string
  let addOut: string

  beforeAll(() => {
    dir = scaffold({ name: 'bookshelf-tour', models: 'Book' }).dir
    addOut = runeAdd(dir, 'Tag', 'name:string,color:string')
    installLinkedAndBuild(dir)
  })

  it('rune add model patches the registry and writes two files', () => {
    expect(addOut).toContain('added model Tag')
    expect(addOut).toContain('src/models/tag.ts')
    expect(addOut).toContain('src/prompts/tag-prompt.ts')
    expect(addOut).toContain('src/models/index.ts')
    expect(addOut).toContain('src/prompts/index.ts')
  })

  it('generates a Tag model with safe defaults from --attrs', () => {
    const tag = readFileSync(join(dir, 'src/models/tag.ts'), 'utf8')
    expect(tag).toContain('export class Tag extends BaseModel')
    expect(tag).toContain("description = 'A Tag record'")
    expect(tag).toContain("endpoint: 'tags'")
    expect(tag).toMatch(/name:\s*\{[\s\S]*?type:\s*'string'/)
    expect(tag).toMatch(/color:\s*\{[\s\S]*?type:\s*'string'/)
  })

  it('the framework adopts Tag with no manual wiring', async () => {
    await withMcpClient(dir, async (client) => {
      const rows = jsonOf(await client.callTool({ name: 'list_models', arguments: {} })) as Row[]
      expect(rows.find((r) => r.name === 'tag')).toEqual({
        name: 'tag',
        endpoint: 'tags',
        description: 'A Tag record',
        attributes: ['name', 'color'],
        required_attributes: [],
        read_only: false
      })
      const guide = textOf(
        await client.callTool({ name: 'get_prompt_guide', arguments: { guide_name: 'tag' } })
      )
      expect(guide.length).toBeGreaterThan(0)
    })
  })
})

describe('docs/guides/02-the-model/associations.md', () => {
  let dir: string
  let addOut: string

  beforeAll(() => {
    dir = scaffold({ name: 'bookshelf-tour', models: 'Book' }).dir
    addOut = runeAdd(dir, 'Author', 'name:string,bio:text')
    editFile(join(dir, 'src/models/book.ts'), applyBelongsToAuthor)
    installLinkedAndBuild(dir)
  })

  it('rune add model Author scaffolds the second model', () => {
    expect(addOut).toContain('added model Author')
  })

  it('list_models exposes the derived belongs_to slot', async () => {
    await withMcpClient(dir, async (client) => {
      const rows = jsonOf(await client.callTool({ name: 'list_models', arguments: {} })) as Row[]
      expect(rows.find((r) => r.name === 'book')).toMatchObject({
        name: 'book',
        belongs_to: ['author']
      })
    })
  })

  it('validate_form requires the synthesized author_id FK', async () => {
    await withMcpClient(dir, async (client) => {
      const out = await client.callTool({
        name: 'validate_form',
        arguments: { model: 'book', fields: { name: 'Dune' } }
      })
      expect(jsonOf(out)).toEqual({
        valid: false,
        ready_to_submit: false,
        errors: [{ field: 'author_id', message: 'ID of the author is required' }],
        warnings: [],
        computed: {},
        fields: { name: 'Dune' }
      })
    })
  })
})

describe('docs/guides/02-the-model/validation-and-defaults.md', () => {
  let dir: string

  beforeAll(() => {
    dir = scaffold({ name: 'bookshelf-tour', models: 'Book' }).dir
    runeAdd(dir, 'Author', 'name:string,bio:text')
    editFile(join(dir, 'src/models/book.ts'), (s) => applyStatusRating(applyBelongsToAuthor(s)))
    installLinkedAndBuild(dir)
  })

  const validate = (client: Parameters<Parameters<typeof withMcpClient>[1]>[0], fields: Row) =>
    client.callTool({ name: 'validate_form', arguments: { model: 'book', fields } })

  it('required blocks an empty submission (both required fields + the status default)', async () => {
    await withMcpClient(dir, async (client) => {
      expect(jsonOf(await validate(client, {}))).toEqual({
        valid: false,
        ready_to_submit: false,
        errors: [
          { field: 'name', message: 'Name is required' },
          { field: 'author_id', message: 'ID of the author is required' }
        ],
        warnings: ['Using default for status: unread'],
        computed: { status: 'unread' },
        fields: { status: 'unread' }
      })
    })
  })

  it('default is substituted and reported as a warning', async () => {
    await withMcpClient(dir, async (client) => {
      expect(jsonOf(await validate(client, { name: 'Dune', author_id: 1 }))).toEqual({
        valid: true,
        ready_to_submit: true,
        errors: [],
        warnings: ['Using default for status: unread'],
        computed: { status: 'unread' },
        fields: { status: 'unread', name: 'Dune', author_id: 1 }
      })
    })
  })

  it('enumValues rejects an out-of-set value', async () => {
    await withMcpClient(dir, async (client) => {
      expect(
        jsonOf(await validate(client, { name: 'Dune', author_id: 1, status: 'bogus' }))
      ).toEqual({
        valid: false,
        ready_to_submit: false,
        errors: [
          {
            field: 'status',
            message: 'Invalid value "bogus". Valid options: unread, reading, finished'
          }
        ],
        warnings: [],
        computed: {},
        fields: { name: 'Dune', author_id: 1, status: 'bogus' }
      })
    })
  })

  it('numeric min/max is NOT enforced at form time (documented gap)', async () => {
    await withMcpClient(dir, async (client) => {
      const out = jsonOf(await validate(client, { name: 'Dune', author_id: 1, rating: 99 })) as Row
      expect(out.valid).toBe(true)
      expect((out.fields as Row).rating).toBe(99)
    })
  })
})
