import type { KindDescriptor } from './registry.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const uuid: Partial<KindDescriptor> = {
  label: 'UUID',
  promptType: 'uuid',
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'string' && UUID_RE.test(v)) return null
    return 'must be a valid UUID'
  }
}
