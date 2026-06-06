import type { KindDescriptor } from './registry.js'

export const url: Partial<KindDescriptor> = {
  label: 'URL',
  htmlInputType: 'url',
  promptType: 'string',
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'string') return 'must be a URL string'
    try {
      new URL(v)
      return null
    } catch {
      return 'must be a valid URL'
    }
  }
}
