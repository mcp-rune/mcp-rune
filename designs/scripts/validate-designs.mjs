import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv from 'ajv'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const designsDir = resolve(scriptDir, '..')
const repoRoot = resolve(designsDir, '..')
const appsDir = join(repoRoot, 'src', 'mcp', 'apps')

// Subdirectories of designs/ that are tooling, not design exports.
const RESERVED_DESIGN_DIRS = new Set(['scripts'])
// Subdirectories of src/mcp/apps/ that are shared code or build output, not apps.
const NON_APP_DIRS = new Set(['dist', 'shared', 'lib', 'scripts'])

function listDirs(dir, exclude) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !exclude.has(entry.name))
    .map((entry) => entry.name)
}

// Parse and schema-validate manifest.json. Pushes any schema violation into
// errors and returns the parsed object (or an empty manifest on failure).
function loadManifest(errors) {
  const manifest = JSON.parse(readFileSync(join(designsDir, 'manifest.json'), 'utf8'))
  const schema = JSON.parse(readFileSync(join(designsDir, 'manifest.schema.json'), 'utf8'))
  const validate = new Ajv({ allErrors: true }).compile(schema)
  if (!validate(manifest)) {
    for (const err of validate.errors ?? []) {
      errors.push(`manifest.json${err.instancePath || ''} ${err.message}`)
    }
    return { designs: [] }
  }
  return manifest
}

// Assert folder <-> manifest <-> src/mcp/apps consistency so a committed export
// can never drift from its registry entry.
function checkConsistency(manifest, errors) {
  const entries = manifest.designs ?? []
  const manifestSlugs = new Set(entries.map((entry) => entry.slug))
  const folderSlugs = new Set(listDirs(designsDir, RESERVED_DESIGN_DIRS))
  const appSlugs = new Set(listDirs(appsDir, NON_APP_DIRS))

  for (const slug of folderSlugs) {
    if (!manifestSlugs.has(slug)) {
      errors.push(`designs/${slug}/ exists on disk but has no manifest entry`)
    }
  }

  for (const entry of entries) {
    if (!folderSlugs.has(entry.slug)) {
      errors.push(`manifest entry "${entry.slug}" has no designs/${entry.slug}/ folder`)
    }
    for (const file of entry.files ?? []) {
      if (!existsSync(join(designsDir, entry.slug, file))) {
        errors.push(`designs/${entry.slug}/${file} is listed in the manifest but missing on disk`)
      }
    }
    for (const app of entry.implements ?? []) {
      if (!appSlugs.has(app)) {
        errors.push(
          `manifest entry "${entry.slug}" targets app "${app}" which is not under src/mcp/apps/`
        )
      }
    }
  }
}

function main() {
  const errors = []
  const manifest = loadManifest(errors)
  if (errors.length === 0) checkConsistency(manifest, errors)

  if (errors.length > 0) {
    console.error('designs:check failed:')
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }

  const count = (manifest.designs ?? []).length
  console.log(`designs:check passed — ${count} design${count === 1 ? '' : 's'} registered.`)
}

main()
