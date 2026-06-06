import type { KindDescriptor } from './registry.js'

export const text: Partial<KindDescriptor> = {
  label: 'Long text',
  htmlInputType: 'textarea',
  promptType: 'text'
}
