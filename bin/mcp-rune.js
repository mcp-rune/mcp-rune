#!/usr/bin/env node
import { run } from '../dist/cli/index.js'

run(process.argv).catch((err) => {
  process.stderr.write(`${err?.stack ?? err}\n`)
  process.exit(1)
})
