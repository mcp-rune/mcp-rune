/**
 * Bundle-coverage smoke test.
 *
 * The server-side form schema (`buildField` in `form-schema.ts` + every kind
 * registered in `kind-metadata.ts` via `registerKind(_, { htmlInputType })`)
 * emits a closed set of `field.type` values. Each form-app bundle has a
 * `switch (field.type)` arm for each one — and *must* keep matching, or new
 * types silently degrade to `<input type="text">` (the `default:` arm).
 * That's the exact failure mode that shipped as `chips` in 0.60.0 with a
 * bundle predating the source.
 *
 * We check both `new-model-app.html` and `edit-model-app.html` even though
 * they both wrap the same `shared/model-form/main.js` — a future change
 * could legitimately fork the bundles, and the cost of two regex scans is
 * negligible. This spec deliberately doesn't jsdom-execute the bundles — a
 * textual check is enough to catch drift and stays robust to minifier output
 * differences.
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { KIND_REGISTRY } from '../../../../src/core/kind-metadata.js'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const BUNDLE_PATHS = {
  'new-model-app': path.join(REPO_ROOT, 'dist/mcp/apps/dist/new-model-app.html'),
  'edit-model-app': path.join(REPO_ROOT, 'dist/mcp/apps/dist/edit-model-app.html')
} as const

// Field types `buildField` emits as hardcoded string literals (not via
// `getKind(...).htmlInputType`). Kept in sync with the if/else chain in
// `src/mcp/apps/lib/form-schema.ts buildField()`.
const HARDCODED_EMIT_TYPES = ['select', 'number', 'multiselect', 'checkbox_group'] as const

// Field types that `buildField` can emit via `getKind(...).htmlInputType` —
// derived dynamically so adding a new registered kind to kind-metadata.ts
// auto-extends the coverage requirement. Filters out kind:format narrowings.
function htmlInputTypesFromRegistry(): string[] {
  const seen = new Set<string>()
  for (const [key, descriptor] of KIND_REGISTRY) {
    if (key.includes(':')) continue // skip format narrowings
    if (descriptor.htmlInputType) seen.add(descriptor.htmlInputType)
  }
  return [...seen]
}

function bundleSource(bundlePath: string): string {
  if (!fs.existsSync(bundlePath)) {
    throw new Error(
      `Bundle not built. Run \`npm run build:full\` before this spec. Expected at: ${bundlePath}`
    )
  }
  return fs.readFileSync(bundlePath, 'utf-8')
}

function bundleHandlesCase(source: string, caseValue: string): boolean {
  // Match `case 'x':`, `case "x":`, and minified `case"x":` — all bundler
  // emissions we've observed.
  const pattern = new RegExp(`case\\s*['"]${escapeRegex(caseValue)}['"]`)
  return pattern.test(source)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('bundle coverage', () => {
  for (const [appName, bundlePath] of Object.entries(BUNDLE_PATHS)) {
    describe(`${appName}.html`, () => {
      it(`the bundle exists (build:full must run before this spec)`, () => {
        expect(fs.existsSync(bundlePath)).toBe(true)
      })

      describe('renderField switch handles every server-emitted field.type', () => {
        const source = bundleSource(bundlePath)
        const expectedTypes = [...HARDCODED_EMIT_TYPES, ...htmlInputTypesFromRegistry()]

        for (const fieldType of expectedTypes) {
          it(`handles "${fieldType}"`, () => {
            if (bundleHandlesCase(source, fieldType)) return
            throw new Error(
              `field.type "${fieldType}" is emitted by the server (kind-metadata.ts or form-schema.ts) ` +
                `but has no \`case "${fieldType}":\` arm in the bundled ${appName}.html. ` +
                `It will silently fall back to <input type="text">. Add a case to renderField() ` +
                `in src/mcp/apps/shared/model-form/main.js and rebuild.`
            )
          })
        }
      })

      it('the default fallback warns (no silent text input)', () => {
        const source = bundleSource(bundlePath)
        // Cheap robustness check: the bundled JS should contain the substring
        // we use in the warn message. This catches a regression where someone
        // restores the silent fallback.
        expect(source).toMatch(/Unknown field\.type/)
      })
    })
  }
})
