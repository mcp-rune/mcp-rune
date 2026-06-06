import { humanize } from './helpers.js'
import type { KindDescriptor } from './registry.js'

export const enumKind: Partial<KindDescriptor> = {
  label: 'Choice',
  promptType: 'enum',
  describe: (v) => (v === null || v === undefined ? '' : humanize(String(v)))
}
