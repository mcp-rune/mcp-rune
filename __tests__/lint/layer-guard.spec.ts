import { ESLint } from 'eslint'

/**
 * Regression test for the ModelLayer/AnalysisLayer abstraction guard in
 * eslint.config.js. The guard once shipped with `#src/...` patterns that
 * gitignore-style matching silently parsed as comments, so it enforced
 * nothing. This suite lints known-bad and known-good fixture imports through
 * the real project config and fails if the guard ever goes inert again.
 */
describe('lint/layer-guard', () => {
  const eslint = new ESLint({ cwd: process.cwd() })

  async function guardHits(code: string, filePath: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath, warnIgnored: true })
    return (result?.messages ?? [])
      .filter((m) => m.ruleId === 'no-restricted-imports')
      .map((m) => m.message)
  }

  const restricted = [
    ['#src/mcp/model-layer/derived-fields.js', 'src/mcp/tools/guard-fixture.ts'],
    ['#src/mcp/model-layer/field-names.js', 'src/mcp/apps/lib/guard-fixture.ts'],
    ['#src/mcp/model-layer/schema-derivation.js', 'src/mcp/prompts/guard-fixture.ts'],
    ['#src/mcp/model-layer/validators.js', 'src/mcp/tools/data/guard-fixture.ts'],
    ['#src/mcp/analysis-layer/edge-extraction.js', 'src/mcp/tools/analysis/guard-fixture.ts'],
    ['#src/mcp/analysis-layer/graph-stratifiers.js', 'src/mcp/tools/guard-fixture.ts'],
    [
      '#src/mcp/analysis-layer/multi-hop-fetch.js',
      'src/mcp/data-layer/api-extensions/search/guard-fixture.ts'
    ],
    ['../../model-layer/validators.js', 'src/mcp/tools/data/guard-fixture.ts'],
    ['../analysis-layer/multi-hop-fetch.js', 'src/mcp/apps/guard-fixture.ts'],
    // DataLayer adapter internals — projection code must use the seam.
    ['#src/mcp/data-layer/model-service/model-service.js', 'src/mcp/tools/data/guard-fixture.ts'],
    ['#src/mcp/data-layer/model-service/compound-id.js', 'src/mcp/tools/analysis/guard-fixture.ts'],
    ['#src/mcp/data-layer/model-service/endpoint-resolver.js', 'src/mcp/apps/lib/guard-fixture.ts'],
    [
      '#src/mcp/data-layer/api-extensions/search/search-service.js',
      'src/mcp/tools/guard-fixture.ts'
    ]
  ] as const

  it.each(restricted)('rejects %s from projection code', async (specifier, filePath) => {
    const hits = await guardHits(`import { x } from '${specifier}'\nexport const y = x`, filePath)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('rejects type-only imports of restricted helpers', async () => {
    const hits = await guardHits(
      "import type { HopFollow } from '#src/mcp/analysis-layer/edge-extraction.js'\nexport type F = HopFollow",
      'src/mcp/tools/analysis/guard-fixture.ts'
    )
    expect(hits.length).toBeGreaterThan(0)
  })

  const allowed = [
    ['#src/mcp/analysis-layer/analysis-layer.js', 'src/mcp/tools/analysis/guard-fixture.ts'],
    ['#src/mcp/model-layer/model-layer.js', 'src/mcp/apps/guard-fixture.ts'],
    // Boot-time validators run before any layer factory exists — exempt.
    ['#src/mcp/model-layer/validators.js', 'src/mcp/apps/lib/app-form-validator.ts'],
    ['#src/mcp/model-layer/validators.js', 'src/mcp/prompts/prompt-validator.ts'],
    // Non-projection code (the layers' own internals) is out of scope.
    ['#src/mcp/model-layer/validators.js', 'src/mcp/model-layer/model-layer.ts'],
    // The two composition roots legitimately construct the default adapter.
    ['#src/mcp/data-layer/model-service/model-service.js', 'src/mcp/tools/tool-registry.ts'],
    ['#src/mcp/data-layer/model-service/model-service.js', 'src/mcp/apps/lib/registry.ts'],
    // The search extension IS the seam implementation — not projection code.
    [
      '#src/mcp/data-layer/model-service/model-service.js',
      'src/mcp/data-layer/api-extensions/custom-actions/guard-fixture.ts'
    ],
    // Conventions are shared vocabulary, never restricted.
    ['#src/mcp/data-layer/api-conventions/index.js', 'src/mcp/apps/lib/guard-fixture.ts']
  ] as const

  it.each(allowed)('allows %s at %s', async (specifier, filePath) => {
    const hits = await guardHits(`import { x } from '${specifier}'\nexport const y = x`, filePath)
    expect(hits).toEqual([])
  })
})
