import { errorMeta } from '../../../../src/mcp/apps/lib/helpers.js'

describe('errorMeta', () => {
  it('extracts basic error fields', () => {
    const err = new Error('something broke')
    const meta = errorMeta(err)

    expect(meta.errorType).toBe('Error')
    expect(meta.error).toBe('something broke')
  })

  it('includes httpStatus from response', () => {
    const err = new Error('Not Found')
    err.response = { status: 404 }
    const meta = errorMeta(err)

    expect(meta.httpStatus).toBe(404)
  })

  it('excludes httpStatus when response has no status', () => {
    const err = new Error('fail')
    err.response = {}
    const meta = errorMeta(err)

    expect(meta).not.toHaveProperty('httpStatus')
  })

  it('includes code when present', () => {
    const err = new Error('connect failed')
    err.code = 'ECONNREFUSED'
    const meta = errorMeta(err)

    expect(meta.code).toBe('ECONNREFUSED')
  })

  it('excludes code when not present', () => {
    const err = new Error('plain')
    const meta = errorMeta(err)

    expect(meta).not.toHaveProperty('code')
  })

  it('includes cause message when present', () => {
    const cause = new Error('root cause')
    const err = new Error('wrapper', { cause })
    const meta = errorMeta(err)

    expect(meta.cause).toBe('root cause')
  })

  it('excludes cause when not present', () => {
    const err = new Error('no cause')
    const meta = errorMeta(err)

    expect(meta).not.toHaveProperty('cause')
  })

  it('preserves custom error constructor name', () => {
    class ApiError extends Error {
      constructor(message) {
        super(message)
        this.name = 'ApiError'
      }
    }
    const err = new ApiError('api broke')
    const meta = errorMeta(err)

    expect(meta.errorType).toBe('ApiError')
  })

  it('includes all optional fields when present', () => {
    const err = new Error('full error', { cause: new Error('root') })
    err.response = { status: 500 }
    err.code = 'ERR_HTTP'
    const meta = errorMeta(err)

    expect(meta).toEqual({
      errorType: 'Error',
      error: 'full error',
      httpStatus: 500,
      code: 'ERR_HTTP',
      cause: 'root'
    })
  })
})
