import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  installLinkedAndBuild,
  jsonOf,
  runScript,
  scaffold,
  textOf,
  withMcpClient
} from './lib/tutorial-harness'

// Each assertion below mirrors an exact command/output in its tutorial. A
// wording or behaviour change in either the docs or the framework fails the
// matching `it`, naming the stale page.

function walk(root: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(root, rel))
    else out.push(rel)
  }
  return out
}

describe('docs/guides/01-getting-started/project-structure.md', () => {
  let dir: string
  let stdout: string

  beforeAll(() => {
    ;({ dir, stdout } = scaffold({ name: 'bookshelf-tour', models: 'Book' }))
  })

  it('prints the documented "Wrote files / Next steps" output (step 1)', () => {
    expect(stdout).toContain('Scaffolding bookshelf-tour (simple)')
    expect(stdout).toContain('Wrote files to')
    expect(stdout).toMatch(/bookshelf-tour/)
    expect(stdout).toContain('Next steps')
    expect(stdout).toContain('npm install')
    expect(stdout).toContain('rune inspect')
  })

  it('produces the documented file tree (step 2)', () => {
    const files = walk(dir)
    expect(files).toEqual(
      expect.arrayContaining([
        'package.json',
        'README.md',
        'tsconfig.json',
        'src/config.ts',
        'src/server.ts',
        'test/smoke.test.ts'
      ])
    )
    // The simple preset is deliberately minimal — no tools/ or domain/ folder.
    expect(files.some((f) => f.startsWith('src/tools/'))).toBe(false)
    expect(files.some((f) => f.startsWith('src/domain/'))).toBe(false)
  })

  it('aggregates one declaration + one index per folder (step 3)', () => {
    expect(readdirSync(join(dir, 'src/models')).sort()).toEqual(['book.ts', 'index.ts'])
    expect(readdirSync(join(dir, 'src/prompts')).sort()).toEqual(['book-prompt.ts', 'index.ts'])
  })

  it('typechecks and the bundled smoke test passes against the local framework (step 4)', () => {
    installLinkedAndBuild(dir)
    expect(runScript(dir, 'test')).toMatch(/1 passed/)
  })
})

describe('docs/guides/01-getting-started/quickstart.md', () => {
  let dir: string

  beforeAll(() => {
    ;({ dir } = scaffold({ name: 'my-server', models: 'Book' }))
    installLinkedAndBuild(dir)
  })

  it('registers the nine polymorphic tools', async () => {
    await withMcpClient(dir, async (client) => {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'list_models',
          'find_records',
          'create_model',
          'update_model',
          'delete_model',
          'bulk_action_models',
          'get_prompt_guide',
          'validate_form',
          'get_form_summary'
        ])
      )
    })
  })

  it('list_models returns the documented book schema', async () => {
    await withMcpClient(dir, async (client) => {
      const result = await client.callTool({ name: 'list_models', arguments: {} })
      expect(jsonOf(result)).toEqual([
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

  it('get_prompt_guide(book) returns a non-empty guide derived from the model', async () => {
    await withMcpClient(dir, async (client) => {
      const result = await client.callTool({
        name: 'get_prompt_guide',
        arguments: { guide_name: 'book' }
      })
      const text = textOf(result)
      expect(text.length).toBeGreaterThan(0)
      expect(text.toLowerCase()).toContain('book')
    })
  })

  it('validate_form flags the empty form, then accepts a name', async () => {
    await withMcpClient(dir, async (client) => {
      const empty = await client.callTool({
        name: 'validate_form',
        arguments: { model: 'book', fields: {} }
      })
      expect(jsonOf(empty)).toEqual({
        valid: false,
        ready_to_submit: false,
        errors: [{ field: 'name', message: 'Name is required' }],
        warnings: [],
        computed: {},
        fields: {}
      })

      const filled = await client.callTool({
        name: 'validate_form',
        arguments: { model: 'book', fields: { name: 'Dune' } }
      })
      const out = jsonOf(filled) as { valid: boolean; ready_to_submit: boolean }
      expect(out.valid).toBe(true)
      expect(out.ready_to_submit).toBe(true)
    })
  })

  it('find_records surfaces the stub ApiClient seam error', async () => {
    await withMcpClient(dir, async (client) => {
      const result = await client.callTool({ name: 'find_records', arguments: { model: 'book' } })
      expect(textOf(result)).toContain('No ApiClient configured')
    })
  })
})
