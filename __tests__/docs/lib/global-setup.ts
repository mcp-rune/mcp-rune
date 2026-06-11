import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Build the publishable artifact and pack the working tree ONCE, so every
// tutorial scaffold can `npm install` the local framework on top of whatever
// the registry would have given it. This is what makes the doctest exercise
// THIS branch rather than the last published release. The tarball lands at a
// deterministic path the harness reconstructs (see tutorial-harness.ts).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUT_DIR = join(ROOT, '.docs-verify')

export default function setup() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  execFileSync('npm', ['run', 'build:full'], { cwd: ROOT, stdio: 'inherit' })
  execFileSync('npm', ['pack', '--pack-destination', OUT_DIR], { cwd: ROOT, stdio: 'inherit' })

  const tgz = readdirSync(OUT_DIR).find((f) => f.endsWith('.tgz'))
  if (!tgz) throw new Error('npm pack produced no tarball in .docs-verify/')

  return () => rmSync(OUT_DIR, { recursive: true, force: true })
}
