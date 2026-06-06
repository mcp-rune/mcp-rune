import type { KindDescriptor } from './registry.js'

export const decimal: Partial<KindDescriptor> = {
  label: 'Decimal',
  htmlInputType: 'number',
  promptType: 'number',
  parse: (v) => (v === null || v === undefined || v === '' ? null : Number(v)),
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : Number(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'number' && Number.isFinite(v)) return null
    return 'must be a number'
  }
}
