import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '#src': path.resolve(import.meta.dirname, 'src')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.spec.{js,ts}'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        '**/__tests__/**',
        'vitest.config.js',
        'src/mcp/stdio-server.ts',
        'src/services/vendor/sentry/index.ts',
        'src/oauth2/index.ts',
        'src/oauth2/adapters/base-adapter.ts',
        'src/mcp/tools/data/index.ts',
        'src/mcp/tools/domain/index.ts',
        'src/mcp/tools/memory/index.ts',
        'src/mcp/prompts/tools/index.ts',
        'src/oauth2-ref/**'
      ],
      thresholds: {
        statements: 92,
        branches: 85,
        functions: 93,
        lines: 92
      }
    }
  }
})
