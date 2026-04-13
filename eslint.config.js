import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error'
    }
  },
  // TypeScript source files
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: ['src/**/*.ts']
  })),
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  // Test files - add vitest globals
  {
    files: ['**/__tests__/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        performance: 'readonly'
      }
    }
  },
  // Browser UI files (MCP Apps)
  {
    files: ['**/apps/*-ui/**/*.js', '**/apps/shared/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        ResizeObserver: 'readonly',
        requestAnimationFrame: 'readonly'
      }
    }
  },
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**', '*.config.js']
  }
]
