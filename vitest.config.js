import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.spec.js'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js'],
      exclude: [
        '**/__tests__/**',
        'vitest.config.js',
        'lib/mcp/stdio-server.js',
        'lib/services/vendor/sentry/index.js',
        'lib/oauth2/index.js',
        'lib/oauth2/adapters/base-adapter.js',
        'lib/mcp/tools/crud/index.js',
        'lib/mcp/tools/domain/index.js',
        'lib/mcp/tools/memory/index.js',
        'lib/mcp/prompts/tools/index.js',
        'lib/oauth2-ref/**'
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
