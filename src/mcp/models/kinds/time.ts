import type { KindDescriptor } from './registry.js'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

export const time: Partial<KindDescriptor> = {
  label: 'Time',
  htmlInputType: 'time',
  promptType: 'time',
  parse: (v) => (v ? String(v) : null),
  describe: (v) => (typeof v === 'string' ? v.substring(0, 5) : ''),
  toInput: (v) => (typeof v === 'string' ? v.substring(0, 5) : ''),
  fromInput: (v) => v || null,
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'string' && TIME_RE.test(v)) return null
    return 'must be a valid time (HH:mm or HH:mm:ss)'
  }
}
