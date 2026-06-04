import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detectTransport } from '#src/cli/inspect.js'

function scaffold(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'mcprune-inspect-'))
  for (const [rel, content] of Object.entries(layout)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

describe('mcp-rune CLI · detectTransport', () => {
  it('prefers http when src/servers/remote.js exists', () => {
    const root = scaffold({ 'src/servers/remote.js': '', 'src/servers/local.js': '' })
    try {
      expect(detectTransport(root, {})).toEqual({
        kind: 'http',
        url: 'http://localhost:4100/mcp'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to stdio with src/servers/local.js', () => {
    const root = scaffold({ 'src/servers/local.js': '' })
    try {
      expect(detectTransport(root, {})).toEqual({
        kind: 'stdio',
        serverPath: join(root, 'src/servers/local.js')
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to src/server.js for the simple preset', () => {
    const root = scaffold({ 'src/server.js': '' })
    try {
      expect(detectTransport(root, {})).toEqual({
        kind: 'stdio',
        serverPath: join(root, 'src/server.js')
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws when no server entry is found', () => {
    const root = scaffold({ 'README.md': '' })
    try {
      expect(() => detectTransport(root, {})).toThrow(/Could not detect/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('--url forces http and overrides default URL', () => {
    const root = scaffold({ 'src/servers/local.js': '' })
    try {
      expect(detectTransport(root, { url: 'http://example.test/mcp' })).toEqual({
        kind: 'http',
        url: 'http://example.test/mcp'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('--transport http + --port composes the URL', () => {
    const root = scaffold({ 'src/server.js': '' })
    try {
      expect(detectTransport(root, { transport: 'http', port: '9999' })).toEqual({
        kind: 'http',
        url: 'http://localhost:9999/mcp'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('--transport stdio overrides remote.js detection', () => {
    const root = scaffold({ 'src/servers/remote.js': '', 'src/servers/local.js': '' })
    try {
      expect(detectTransport(root, { transport: 'stdio' })).toEqual({
        kind: 'stdio',
        serverPath: join(root, 'src/servers/local.js')
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('--server <path> forces stdio at that path', () => {
    const root = scaffold({ 'custom/entry.js': '' })
    try {
      expect(detectTransport(root, { server: 'custom/entry.js' })).toEqual({
        kind: 'stdio',
        serverPath: join(root, 'custom/entry.js')
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('--server with a missing path throws', () => {
    const root = scaffold({ 'README.md': '' })
    try {
      expect(() => detectTransport(root, { server: 'nope.js' })).toThrow(/Server entry not found/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
