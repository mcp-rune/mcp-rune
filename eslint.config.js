import js from '@eslint/js'
import globals from 'globals'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unicorn from 'eslint-plugin-unicorn'
import n from 'eslint-plugin-n'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

// Shared no-restricted-imports pattern groups for the projection-layer guards.
// The `**/` prefix matches both the `#src/...` subpath-import form and relative
// `../../` forms; a leading `#` (gitignore comment syntax) would silently match
// nothing. Regression-tested by `__tests__/lint/layer-guard.spec.ts`.
const MODEL_LAYER_GUARD = {
  group: [
    '**/model-layer/derived-fields*',
    '**/model-layer/field-names*',
    '**/model-layer/schema-derivation*',
    '**/model-layer/validators*'
  ],
  message:
    'Use the modelLayer factory (deps.modelLayer / context.modelLayer) instead of importing model-layer helpers directly.'
}
const ANALYSIS_LAYER_GUARD = {
  group: [
    '**/analysis-layer/edge-extraction*',
    '**/analysis-layer/graph-stratifiers*',
    '**/analysis-layer/multi-hop-fetch*'
  ],
  message:
    'Use the analysisLayer factory (deps.analysisLayer / context.analysisLayer) instead of importing analysis-layer helpers directly.'
}
// DataLayer adapter internals. Conventions (`BaseConvention`, `defaultConvention`)
// are deliberately NOT restricted — they are shared wire-format vocabulary, not
// adapters. Applied to pure projection code (apps/tools/prompts), not the
// data-layer's own api-extensions, which ARE seam implementations.
const DATA_LAYER_ADAPTER_GUARD = {
  group: ['**/data-layer/model-service/*', '**/api-extensions/search/search-service*'],
  message:
    'Reach the backend through the DataLayer seam (this.dataLayer / context.dataLayer), not the concrete ModelService / EndpointResolver / SearchService adapter. Conventions are the exception — import them from api-conventions.'
}

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
      'unicorn/filename-case': ['error', { case: 'kebabCase', ignore: [/^__tests__$/] }]
    }
  },
  // Test files — relax strict typing for mocks
  {
    files: ['**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  // Projection-layer abstraction guard — pure projection code (apps, tools,
  // prompts). Reaches model config, analysis, and the backend only through the
  // injected `modelLayer` / `analysisLayer` factories and the `DataLayer` seam.
  // Each eslint config sets `no-restricted-imports` wholesale (options replace,
  // they don't merge across matching blocks), so both scopes list every group
  // they need; the data-layer adapter guard applies here but NOT to the
  // api-extensions seam implementations below.
  {
    files: ['src/mcp/apps/**/*.ts', 'src/mcp/tools/**/*.ts', 'src/mcp/prompts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [MODEL_LAYER_GUARD, ANALYSIS_LAYER_GUARD, DATA_LAYER_ADAPTER_GUARD] }
      ]
    }
  },
  // The data-layer's own api-extensions ARE seam implementations — they may
  // compose the concrete adapters, so they get the model-layer / analysis-layer
  // guards but not the adapter guard.
  {
    files: ['src/mcp/data-layer/api-extensions/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [MODEL_LAYER_GUARD, ANALYSIS_LAYER_GUARD] }]
    }
  },
  // Boot-time validators run before any layer factory is constructed, and the
  // two registry composition roots legitimately construct the default
  // `ModelService` adapter — both are exempt from the abstraction guards.
  {
    files: [
      'src/mcp/apps/lib/app-form-validator.ts',
      'src/mcp/prompts/prompt-validator.ts',
      'src/mcp/tools/tool-registry.ts',
      'src/mcp/apps/lib/registry.ts'
    ],
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
