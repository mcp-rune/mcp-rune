import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'

const isDevelopment = process.env.NODE_ENV === 'development'

// Build target: 'model-form' (default) or any generic app
const target = process.env.BUILD_TARGET || 'model-form'

const configs = {
  'model-form': {
    root: 'model-form-ui',
    outFile: 'model-form.html'
  },
  'list-view': {
    root: 'list-view-ui',
    outFile: 'list-view.html'
  },
  'record-detail': {
    root: 'record-detail-ui',
    outFile: 'record-detail.html'
  },
  'search-view': {
    root: 'search-view-ui',
    outFile: 'search-view.html'
  },
  'autocomplete-picker': {
    root: 'autocomplete-picker-ui',
    outFile: 'autocomplete-picker.html'
  },
  'multi-select': {
    root: 'multi-select-ui',
    outFile: 'multi-select.html'
  },
  'draft-view': {
    root: 'draft-view-ui',
    outFile: 'draft-view.html'
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
  build: {
    sourcemap: isDevelopment ? 'inline' : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: process.env.SKIP_CLEAN !== '1' && target === 'model-form'
  }
})
