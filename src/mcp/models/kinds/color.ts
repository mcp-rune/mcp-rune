import type { KindDescriptor } from './registry.js'

export const color: Partial<KindDescriptor> = {
  label: 'Color',
  htmlInputType: 'color',
  promptType: 'string',
  describe: (v) => (v === null || v === undefined ? '' : String(v))
}
