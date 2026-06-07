import fs from 'node:fs'
import path from 'node:path'

import { viteSingleFile } from 'vite-plugin-singlefile'
import { defineConfig } from 'vite'

const isDevelopment = process.env.NODE_ENV === 'development'

// Build target maps directly to a sibling app directory: every app under
// src/mcp/apps/ ships its iframe entry at <app>/ui/index.html and bundles
// to dist/<app>.html. No per-app config map — adding a new app is a
// filesystem-only change.
const target = process.env.BUILD_TARGET || 'new-model-app'
const targetRoot = path.resolve(import.meta.dirname, target, 'ui')
const targetIndex = path.join(targetRoot, 'index.html')
if (!fs.existsSync(targetIndex)) {
  const relative = path.relative(process.cwd(), targetIndex)
  throw new Error(
    `vite-apps: BUILD_TARGET="${target}" but ${relative} does not exist. ` +
      `Each app must ship its iframe entry at src/mcp/apps/<name>/ui/index.html.`
  )
}
const outFile = `${target}.html`

export default defineConfig({
  root: targetRoot,
  plugins: [
    viteSingleFile(),
    // Rename index.html → target-specific filename after singlefile inlining
    {
      name: 'rename-output',
      enforce: 'post',
      generateBundle(_, bundle) {
        if (bundle['index.html']) {
          bundle['index.html'].fileName = outFile
        }
      }
    }
  ],
  resolve: {
    alias: {
      '#src': path.resolve(import.meta.dirname, '../../..', 'src')
    }
  },
  build: {
    sourcemap: isDevelopment ? 'inline' : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: process.env.SKIP_CLEAN !== '1'
  }
})
