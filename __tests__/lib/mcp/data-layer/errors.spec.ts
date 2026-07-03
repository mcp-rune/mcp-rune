import { jsonApiConvention } from '../../../../src/mcp/data-layer/api-conventions/index.js'
import {
  ApiRequestError,
  RecordNotFoundError,
  translateApiError
} from '../../../../src/mcp/data-layer/errors.js'

describe('lib/mcp/data-layer/errors', () => {
  const convention = jsonApiConvention

  function httpError(status: number, data?: unknown): Error {
    return Object.assign(new Error('API Error'), { response: { status, data } })
  }

  describe('translateApiError', () => {
    it('passes rejections without a response through untouched', () => {
      const err = new Error('Connection timeout')
      expect(translateApiError(err, { convention })).toBe(err)
    })

    it('translates a record-scoped 404 into RecordNotFoundError with the cause attached', () => {
      const raw = httpError(404, { error: 'Record not found' })
      const out = translateApiError(raw, { convention, model: 'book', recordId: '999' })
      expect(out).toBeInstanceOf(RecordNotFoundError)
      const nf = out as RecordNotFoundError
      expect(nf.message).toBe('No book found with id "999"')
      expect(nf.model).toBe('book')
      expect(nf.recordId).toBe('999')
      expect(nf.cause).toBe(raw)
    })

    it('translates a collection-level 404 into ApiRequestError (no record semantics)', () => {
      const out = translateApiError(httpError(404, { error: 'Not found' }), {
        convention,
        model: 'book'
      })
      expect(out).toBeInstanceOf(ApiRequestError)
      expect((out as ApiRequestError).status).toBe(404)
    })

    it('parses a Rails validation hash through the convention', () => {
      const out = translateApiError(
        httpError(422, {
          errors: { title: ["can't be blank"], status: ['is not included in the list'] }
        }),
        { convention, model: 'book' }
      ) as ApiRequestError
      expect(out.message).toBe("title: can't be blank; status: is not included in the list (422)")
      expect(out.messages).toEqual(["title: can't be blank", 'status: is not included in the list'])
    })

    it('parses an error array through the convention', () => {
      const out = translateApiError(
        httpError(422, { errors: ['Title is required', 'Status must be valid'] }),
        { convention }
      ) as ApiRequestError
      expect(out.message).toBe('Title is required; Status must be valid (422)')
    })

    it('parses a plain-string body through the convention', () => {
      const out = translateApiError(httpError(500, 'Internal Server Error'), {
        convention
      }) as ApiRequestError
      expect(out.message).toBe('Internal Server Error (500)')
    })

    it('renders Unknown error when the response carries no data', () => {
      const out = translateApiError(httpError(504), { convention }) as ApiRequestError
      expect(out.message).toBe('Unknown error (504)')
    })
  })
})
