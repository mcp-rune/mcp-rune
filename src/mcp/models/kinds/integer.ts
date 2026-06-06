import type { KindDescriptor } from './registry.js'

export const integer: Partial<KindDescriptor> = {
  label: 'Integer',
  htmlInputType: 'number',
  promptType: 'integer',
  parse: (v) => (v === null || v === undefined || v === '' ? null : Number(v)),
  serialize: (v) => v,
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : Number(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'number' && Number.isInteger(v)) return null
    return 'must be an integer'
  }
}
