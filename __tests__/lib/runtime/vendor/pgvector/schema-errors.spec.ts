import { withSchemaHint } from '../../../../../src/runtime/vendor/pgvector/schema-errors.js'

describe('pgvector/schema-errors — withSchemaHint', () => {
  it('returns the operation result when it succeeds', async () => {
    await expect(withSchemaHint(() => Promise.resolve(42))).resolves.toBe(42)
  })

  it.each(['42703', '42P01'])('appends remediation to schema error %s', async (code) => {
    const op = () =>
      Promise.reject(Object.assign(new Error('column "embedding" does not exist'), { code }))
    const err = await withSchemaHint(op).catch((e) => e)
    expect(err.message).toContain('column "embedding" does not exist')
    expect(err.message).toContain('npm run db:migrate')
    expect(err.code).toBe(code)
  })

  it('passes non-schema errors through untouched', async () => {
    const original = Object.assign(new Error('deadlock'), { code: '40P01' })
    const err = await withSchemaHint(() => Promise.reject(original)).catch((e) => e)
    expect(err).toBe(original)
    expect(err.message).toBe('deadlock')
  })
})
