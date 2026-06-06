import type { KindDescriptor } from './registry.js'

export const boolean: Partial<KindDescriptor> = {
  label: 'Yes/No',
  htmlInputType: 'checkbox',
  promptType: 'boolean',
  parse: (v) => v === true || v === 'true' || v === 1 || v === '1',
  serialize: (v) => Boolean(v),
  describe: (v) => (v ? 'Yes' : 'No'),
  toInput: (v) => (v ? 'true' : 'false'),
  fromInput: (v) => v === 'true' || v === 'on',
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'boolean') return null
    return 'must be a boolean'
  }
}
