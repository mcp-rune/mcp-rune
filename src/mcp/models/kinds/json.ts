import type { KindDescriptor } from './registry.js'

export const json: Partial<KindDescriptor> = {
  label: 'JSON',
  htmlInputType: 'textarea',
  promptType: 'object',
  describe: (v) => {
    if (v === null || v === undefined) return ''
    return typeof v === 'string' ? v : JSON.stringify(v)
  },
  toInput: (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2)),
  fromInput: (v) => {
    if (!v) return null
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  },
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'string') return null
    try {
      JSON.parse(v)
      return null
    } catch {
      return 'must be valid JSON'
    }
  }
}
