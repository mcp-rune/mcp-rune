import { hintForError } from '#src/core/error-hints.js'

describe('lib/core/error-hints', () => {
  it('returns a hint for known POSIX codes', () => {
    expect(hintForError({ code: 'EADDRINUSE' })).toMatch(/another process is using that port/)
    expect(hintForError({ code: 'ECONNREFUSED' })).toMatch(/target service may be down/)
    expect(hintForError({ code: 'ENOTFOUND' })).toMatch(/DNS lookup failed/)
    expect(hintForError({ code: 'EACCES' })).toMatch(/permission denied/)
    expect(hintForError({ code: 'ETIMEDOUT' })).toMatch(/timed out/)
  })

  it('reads `code` from real Error instances', () => {
    const err = new Error('listen EADDRINUSE')
    ;(err as Error & { code?: string }).code = 'EADDRINUSE'
    expect(hintForError(err)).toMatch(/another process is using that port/)
  })

  it('returns undefined for unknown codes', () => {
    expect(hintForError({ code: 'EWHATEVER' })).toBeUndefined()
  })

  it('returns undefined for errors with no code', () => {
    expect(hintForError(new Error('boom'))).toBeUndefined()
  })

  it('returns undefined for null/undefined input', () => {
    expect(hintForError(null)).toBeUndefined()
    expect(hintForError(undefined)).toBeUndefined()
  })

  it('returns undefined when code is not a string', () => {
    expect(hintForError({ code: 42 })).toBeUndefined()
  })
})
