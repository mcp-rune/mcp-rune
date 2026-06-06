import type { KindDescriptor } from './registry.js'

export const rating: Partial<KindDescriptor> = {
  label: 'Rating',
  htmlInputType: 'number',
  promptType: 'integer',
  parse: (v) => Number(v) || 0,
  describe: (v, opts) => {
    const max = opts?.max ?? 5
    const n = Math.max(0, Math.min(max, Number(v) || 0))
    return `${n}/${max}`
  },
  toInput: (v) => String(v ?? ''),
  fromInput: (v) => (v === '' ? null : Number(v)),
  validate: (v, opts) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number'
    const max = opts?.max ?? 5
    if (v < 0 || v > max) return `must be between 0 and ${max}`
    return null
  }
}
