import { dateToInputDateTime, parseDate } from './helpers.js'
import type { KindDescriptor } from './registry.js'

export const datetime: Partial<KindDescriptor> = {
  label: 'Date & time',
  htmlInputType: 'datetime-local',
  promptType: 'datetime',
  parse: parseDate,
  describe: (v) => {
    const d = parseDate(v)
    return d ? d.toISOString() : ''
  },
  toInput: (v) => {
    const d = v instanceof Date ? v : parseDate(v)
    return d ? dateToInputDateTime(d) : ''
  },
  fromInput: (v) => (v ? new Date(`${v}:00Z`) : null),
  serialize: (v) => {
    const d = v instanceof Date ? v : parseDate(v)
    return d ? d.toISOString() : null
  },
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    return parseDate(v) ? null : 'must be a valid datetime'
  }
}
