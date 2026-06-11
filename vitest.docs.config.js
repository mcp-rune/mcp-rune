import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Executable-docs suite — isolated from the fast unit run because each spec
// scaffolds a project, hits the network for `npm install`, and spawns a real
// MCP server. global-setup builds + packs the working-tree framework once.
// Run via `npm run docs:verify`.
export default defineConfig({
  resolve: {
    alias: {
      '#src': path.resolve(import.meta.dirname, 'src')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/docs/**/*.spec.{js,ts}'],
    globalSetup: ['__tests__/docs/lib/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 300000,
    hookTimeout: 900000
  }
})
