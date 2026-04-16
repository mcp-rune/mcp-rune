import js from '@eslint/js'
import globals from 'globals'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unicorn from 'eslint-plugin-unicorn'
import n from 'eslint-plugin-n'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
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
  // TypeScript source and test files
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/**/*.ts', '**/__tests__/**/*.ts']
  })),
  {
    files: ['src/**/*.ts', '**/__tests__/**/*.ts'],
    plugins: {
      'simple-import-sort': simpleImportSort,
      unicorn,
      n
    },
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
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' }
      ],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'n/prefer-node-protocol': 'error',
      'unicorn/filename-case': ['error', { case: 'kebabCase' }]
    }
  },
  // Test files — relax strict typing for mocks
  {
    files: ['**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
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
  prettierConfig,
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**', 'src/oauth2-ref/**', '*.config.js']
  }
]
