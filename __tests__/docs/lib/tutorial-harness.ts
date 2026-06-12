import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Drives the getting-started tutorials end-to-end the way a reader would,
// against the single pinned toolchain in docs/verified-with.json. Each helper
// maps to one documented step; the spec asserts the documented outputs.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'docs', 'verified-with.json'), 'utf8'))
const RUNE_CLI: string = MANIFEST.runeCli

function frameworkTarball(): string {
  const outDir = join(ROOT, '.docs-verify')
  const tgz = readdirSync(outDir).find((f) => f.endsWith('.tgz'))
  if (!tgz)
    throw new Error('framework tarball missing — did global-setup run? (npm run docs:verify)')
  return join(outDir, tgz)
}

export interface Scaffold {
  dir: string
  stdout: string
}

// `rune new <name> --preset simple` from a clean dir, against the pinned CLI.
export function scaffold({ name, models = 'Book' }: { name: string; models?: string }): Scaffold {
  const parent = mkdtempSync(join(tmpdir(), 'mcp-rune-docs-'))
  const stdout = execFileSync(
    'npx',
    [
      '--yes',
      `@mcp-rune/create@${RUNE_CLI}`,
      'new',
      name,
      '--preset',
      'simple',
      '--models',
      models,
      '--yes',
      '--skip-mascot',
      '--no-install',
      '--no-git'
    ],
    { cwd: parent, encoding: 'utf8' }
  )
  return { dir: join(parent, name), stdout }
}

// Install the scaffold's deps, then override @mcp-rune/mcp-rune with the
// locally-packed working tree, then typecheck. Throws (failing the test) on a
// non-zero exit from any step.
export function installLinkedAndBuild(dir: string): void {
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' })
  execFileSync('npm', ['install', '--no-audit', '--no-fund', frameworkTarball()], {
    cwd: dir,
    stdio: 'inherit'
  })
  execFileSync('npm', ['run', 'typecheck'], { cwd: dir, stdio: 'inherit' })
}

export function runScript(dir: string, script: string): string {
  return execFileSync('npm', ['run', script], { cwd: dir, encoding: 'utf8' })
}

// `rune add model <Name> --attrs ...` against an existing scaffold (no install
// needed — it only generates and patches src files).
export function runeAdd(dir: string, model: string, attrs: string): string {
  return execFileSync(
    'npx',
    ['--yes', `@mcp-rune/create@${RUNE_CLI}`, 'add', 'model', model, '--attrs', attrs],
    { cwd: dir, encoding: 'utf8' }
  )
}

// Apply a documented hand-edit to a scaffolded file (e.g. adding an
// association or attribute to a model), the way the guide tells the reader to.
export function editFile(path: string, transform: (src: string) => string): void {
  writeFileSync(path, transform(readFileSync(path, 'utf8')), 'utf8')
}

// Launch the scaffolded stdio server and drive it with a real MCP client —
// exactly what the Inspector does in the tutorial, minus the browser.
export async function withMcpClient<T>(
  dir: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const transport = new StdioClientTransport({
    command: join(dir, 'node_modules', '.bin', 'tsx'),
    args: ['src/server.ts'],
    cwd: dir,
    env: { ...process.env, ACCESS_TOKEN: 'demo-token' }
  })
  const client = new Client({ name: 'docs-verify', version: '0.0.0' }, { capabilities: {} })
  await client.connect(transport)
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

interface ToolResult {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
}

export function textOf(result: ToolResult): string {
  return (result.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
}

export function jsonOf(result: ToolResult): unknown {
  return JSON.parse(textOf(result))
}
