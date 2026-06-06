import type { KindDescriptor } from './registry.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const email: Partial<KindDescriptor> = {
  label: 'Email address',
  htmlInputType: 'email',
  promptType: 'string',
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'string' && EMAIL_RE.test(v)) return null
    return 'must be a valid email address'
  }
}
