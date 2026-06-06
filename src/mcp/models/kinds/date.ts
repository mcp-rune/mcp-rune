import { dateToISO, parseDate } from './helpers.js'
import type { KindDescriptor } from './registry.js'

export const date: Partial<KindDescriptor> = {
  label: 'Date',
  htmlInputType: 'date',
  promptType: 'date',
  parse: parseDate,
  describe: (v) => {
    const d = parseDate(v)
    return d ? dateToISO(d) : ''
  },
  toInput: (v) => {
    const d = v instanceof Date ? v : parseDate(v)
    return d ? dateToISO(d) : ''
  },
  fromInput: (v) => (v ? new Date(`${v}T00:00:00Z`) : null),
  serialize: (v) => {
    const d = v instanceof Date ? v : parseDate(v)
    return d ? dateToISO(d) : null
  },
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    return parseDate(v) ? null : 'must be a valid date'
  }
}
