import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'

const isDevelopment = process.env.NODE_ENV === 'development'

// Build target: 'model-form' (default) or any generic app
const target = process.env.BUILD_TARGET || 'model-form'

const configs = {
  'model-form': {
    root: 'model-form/ui',
    outFile: 'model-form.html'
  },
  'list-model-app': {
    root: 'list-model-app/ui',
    outFile: 'list-model-app.html'
  },
  'show-model-app': {
    root: 'show-model-app/ui',
    outFile: 'show-model-app.html'
  },
  'search-model-app': {
    root: 'search-model-app/ui',
    outFile: 'search-model-app.html'
  },
  'pick-model-app': {
    root: 'pick-model-app/ui',
    outFile: 'pick-model-app.html'
  },
  'multi-pick-model-app': {
    root: 'multi-pick-model-app/ui',
    outFile: 'multi-pick-model-app.html'
  }
}

const config = configs[target]

export default defineConfig({
  root: path.resolve(import.meta.dirname, config.root),
  plugins: [
    viteSingleFile(),
    // Rename index.html → target-specific filename after singlefile inlining
    {
      name: 'rename-output',
      enforce: 'post',
      generateBundle(_, bundle) {
        if (config.outFile !== 'index.html' && bundle['index.html']) {
          bundle['index.html'].fileName = config.outFile
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
    emptyOutDir: process.env.SKIP_CLEAN !== '1' && target === 'model-form'
  }
})
