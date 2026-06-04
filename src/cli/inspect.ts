import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface InspectCommandOptions {
  transport?: 'stdio' | 'http'
  url?: string
  port?: string
  server?: string
}

export type DetectedTransport =
  | { kind: 'stdio'; serverPath: string }
  | { kind: 'http'; url: string }

const DEFAULT_PORT = 4100
const DEFAULT_PATH_PREFIX = '/mcp'
const INSPECTOR_PKG = '@modelcontextprotocol/inspector'

const STDIO_CANDIDATES = ['src/servers/local.js', 'src/server.js']
const HTTP_SERVER_PATH = 'src/servers/remote.js'

export function detectTransport(cwd: string, opts: InspectCommandOptions): DetectedTransport {
  if (opts.transport === 'http' || opts.url) {
    return { kind: 'http', url: opts.url ?? defaultHttpUrl(opts.port) }
  }

  if (opts.transport === 'stdio' || opts.server) {
    const rel = opts.server ?? firstExisting(cwd, STDIO_CANDIDATES)
    if (!rel) {
      throw new Error(
        'No stdio server entry found. Pass --server <path> or run from a scaffolded project.'
      )
    }
    const abs = resolve(cwd, rel)
    if (!existsSync(abs)) {
      throw new Error(`Server entry not found: ${abs}`)
    }
    return { kind: 'stdio', serverPath: abs }
  }

  if (existsSync(resolve(cwd, HTTP_SERVER_PATH))) {
    return { kind: 'http', url: defaultHttpUrl(opts.port) }
  }
  const stdio = firstExisting(cwd, STDIO_CANDIDATES)
  if (stdio) {
    return { kind: 'stdio', serverPath: resolve(cwd, stdio) }
  }

  throw new Error(
    'Could not detect an MCP server. Run `mcp-rune inspect` from a scaffolded project, or pass --server <path> / --url <url>.'
  )
}

function defaultHttpUrl(port?: string): string {
  const p = port ?? String(DEFAULT_PORT)
  return `http://localhost:${p}${DEFAULT_PATH_PREFIX}`
}

function firstExisting(cwd: string, candidates: readonly string[]): string | undefined {
  return candidates.find((rel) => existsSync(resolve(cwd, rel)))
}

export async function inspectCommand(opts: InspectCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const detected = detectTransport(cwd, opts)

  const args =
    detected.kind === 'stdio'
      ? [INSPECTOR_PKG, 'node', detected.serverPath]
      : [INSPECTOR_PKG, '--url', detected.url]

  if (detected.kind === 'stdio') {
    process.stdout.write(`  launching inspector against ${detected.serverPath}\n`)
  } else {
    process.stdout.write(`  connecting inspector to ${detected.url}\n`)
    process.stdout.write(`  the server must be running — start it with npm run start:remote\n`)
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('npx', args, { cwd, stdio: 'inherit' })
    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (code === 0 || code === null) return resolvePromise()
      if (signal === 'SIGINT' || code === 130) return resolvePromise()
      rejectPromise(new Error(`inspector exited with code ${code}`))
    })
  })
}
