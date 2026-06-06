import { humanize } from './helpers.js'
import type { KindDescriptor } from './registry.js'

export const array: Partial<KindDescriptor> = {
  label: 'List',
  promptType: 'array',
  parse: (v) => (Array.isArray(v) ? v : v == null ? [] : [v]),
  serialize: (v) => (Array.isArray(v) ? v : []),
  describe: (v) => (Array.isArray(v) ? v.map((x) => humanize(String(x))).join(', ') : ''),
  toInput: (v) => (Array.isArray(v) ? v.join(',') : ''),
  fromInput: (v) =>
    v
      ? String(v)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    return Array.isArray(v) ? null : 'must be an array'
  }
}
