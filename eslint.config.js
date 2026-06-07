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
  // ModelLayer / AnalysisLayer abstraction guard.
  //
  // The projection layer (apps, tools, prompts, ApiExtensions) must reach the
  // model-config and analysis helpers only through `modelLayer(name)` /
  // `analysisLayer(name)` injected via `ToolDependencies` or app handler
  // context. Direct imports of the underlying helpers bypass the seam and
  // mirror the "Respect the DataLayer abstraction" rule. See plan
  // `if-you-look-at-snappy-babbage.md` and memory
  // `feedback_separate_definition_from_consumption`.
  {
    files: [
      'src/mcp/apps/**/*.ts',
      'src/mcp/tools/**/*.ts',
      'src/mcp/prompt-layer/**/*.ts',
      'src/mcp/data-layer/api-extensions/**/*.ts'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '#src/mcp/model-layer/derived-fields*',
                '#src/mcp/model-layer/field-names*',
                '#src/mcp/model-layer/schema-derivation*',
                '#src/mcp/model-layer/validators*'
              ],
              message:
                'Use the modelLayer factory (deps.modelLayer / context.modelLayer) instead of importing model-layer helpers directly. See plan `if-you-look-at-snappy-babbage.md`.'
            },
            {
              group: [
                '#src/mcp/analysis-layer/edge-extraction*',
                '#src/mcp/analysis-layer/graph-stratifiers*',
                '#src/mcp/analysis-layer/multi-hop-fetch*'
              ],
              message:
                'Use the analysisLayer factory (deps.analysisLayer / context.analysisLayer) instead of importing analysis-layer helpers directly.'
            }
          ]
        }
      ]
    }
  },
  // Boot-time validators run before any layer factory is constructed, so
  // they're exempt from the abstraction guard.
  {
    files: ['src/mcp/apps/lib/form-validator.ts', 'src/mcp/prompt-layer/prompt-validator.ts'],
    rules: {
      'no-restricted-imports': 'off'
    }
  },
  // Browser UI files (MCP Apps)
  {
    files: ['**/apps/*/ui/**/*.js', '**/apps/shared/**/*.js'],
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
