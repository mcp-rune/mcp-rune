import type { KindDescriptor } from './registry.js'

export const base64: Partial<KindDescriptor> = {
  label: 'Binary (base64)',
  promptType: 'string',
  describe: () => '(binary)'
}
