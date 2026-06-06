import { BaseConvention } from '../../../../../src/mcp/data-layer/api-conventions/base-convention.js'
import { jsonApiConvention } from '../../../../../src/mcp/data-layer/api-conventions/json-api.js'

describe('lib/mcp/api-conventions', () => {
  describe('BaseConvention', () => {
    describe('parseErrorResponse', () => {
      it('returns string data as single-element array', () => {
        const base = new BaseConvention()
        // Proxy/nginx returning plain text body
        expect(base.parseErrorResponse({ status: 502, data: 'Bad Gateway' })).toEqual([
          'Bad Gateway'
        ])
      })

      it('returns JSON dump for unrecognized objects', () => {
        const base = new BaseConvention()
        // Non-standard API error format
        const data = { code: 'RATE_LIMITED', retry_after: 30 }
        expect(base.parseErrorResponse({ status: 429, data })).toEqual([
          JSON.stringify(data, null, 2)
        ])
      })

      it('returns empty array when response has no data', () => {
        const base = new BaseConvention()
        expect(base.parseErrorResponse({ status: 504 })).toEqual([])
        expect(base.parseErrorResponse({ status: 502, data: null })).toEqual([])
      })
    })

    it('cleanResponse is a no-op by default', () => {
      const base = new BaseConvention()
      const data = { id: 1, _links: { self: {} } }
      expect(base.cleanResponse(data)).toBe(data)
    })

    it('flattenExpandedResources is a no-op by default', () => {
      const base = new BaseConvention()
      const records = [{ id: 1, title: { resource_type: 'title', id: 58, name: 'Pilot' } }]
      expect(base.flattenExpandedResources(records)).toBe(records)
    })

    it('extractNestedRecords falls back to data/records keys by default', () => {
      const base = new BaseConvention()
      const records = [{ id: 1, message: 'error' }]
      expect(base.extractNestedRecords({ data: records })).toEqual(records)
      expect(base.extractNestedRecords({ records })).toEqual(records)
      expect(base.extractNestedRecords(records)).toEqual(records)
      // Unknown key returns empty
      expect(base.extractNestedRecords({ entries: records })).toEqual([])
    })
  })

  describe('JsonApiConvention', () => {
    describe('cleanResponse', () => {
      it('strips _links from a single record', () => {
        const record = { id: 1, name: 'Test', _links: { self: { href: '/test/1' } } }
        expect(jsonApiConvention.cleanResponse(record)).toEqual({ id: 1, name: 'Test' })
      })

      it('strips _links from an array of records', () => {
        const records = [
          { id: 1, name: 'A', _links: { self: { href: '/a/1' } } },
          { id: 2, name: 'B', _links: { self: { href: '/b/2' } } }
        ]
        expect(jsonApiConvention.cleanResponse(records)).toEqual([
          { id: 1, name: 'A' },
          { id: 2, name: 'B' }
        ])
      })

      it('strips _links recursively from expanded associations', () => {
        const record = {
          id: 1,
          title: {
            id: 456,
            name: 'Breaking Bad',
            _links: { self: { href: '/titles/456' } }
          },
          _links: { self: { href: '/schedulings/1' } }
        }
        expect(jsonApiConvention.cleanResponse(record)).toEqual({
          id: 1,
          title: { id: 456, name: 'Breaking Bad' }
        })
      })

      it('strips _links from envelope objects', () => {
        const envelope = {
          data: [{ id: 1, _links: { self: { href: '/x/1' } } }],
          meta: { page: 1 },
          _links: { next: { href: '/x?page=2' } }
        }
        const result = jsonApiConvention.cleanResponse(envelope)
        expect(result.data).toEqual([{ id: 1 }])
        expect(result.meta).toEqual({ page: 1 })
        expect(result._links).toBeUndefined()
      })

      it('returns primitives unchanged', () => {
        expect(jsonApiConvention.cleanResponse(null)).toBe(null)
        expect(jsonApiConvention.cleanResponse(42)).toBe(42)
        expect(jsonApiConvention.cleanResponse('text')).toBe('text')
      })

      it('does not mutate input', () => {
        const record = { id: 1, _links: { self: { href: '/x' } } }
        jsonApiConvention.cleanResponse(record)
        expect(record._links).toBeDefined()
      })
    })

    it('flattenExpandedResources is a no-op', () => {
      const records = [{ id: 1, title: { id: 58, name: 'Pilot' } }]
      expect(jsonApiConvention.flattenExpandedResources(records)).toBe(records)
    })

    describe('parseErrorResponse', () => {
      it('parses Rails validation hash with field-level errors', () => {
        // Rails 422 response: POST /api/titles with missing required fields
        const response = {
          status: 422,
          data: {
            errors: {
              title: ["can't be blank"],
              status: ['is not included in the list'],
              release_date: ['must be a valid date', 'must be in the future']
            }
          }
        }
        expect(jsonApiConvention.parseErrorResponse(response)).toEqual([
          "title: can't be blank",
          'status: is not included in the list',
          'release_date: must be a valid date, must be in the future'
        ])
      })

      it('parses single error object', () => {
        // Rails 404 response: GET /api/titles/999
        const response = { status: 404, data: { error: 'Record not found' } }
        expect(jsonApiConvention.parseErrorResponse(response)).toEqual(['Record not found'])
      })

      it('parses array of error strings', () => {
        // Rails 422 response: bulk validation
        const response = {
          status: 422,
          data: { errors: ['Title is required', 'Status must be valid'] }
        }
        expect(jsonApiConvention.parseErrorResponse(response)).toEqual([
          'Title is required',
          'Status must be valid'
        ])
      })

      it('parses Rails base-level errors (no field association)', () => {
        // Rails model-level error: not tied to a specific field
        const response = {
          status: 422,
          data: { errors: { base: ['Record is locked for editing'] } }
        }
        expect(jsonApiConvention.parseErrorResponse(response)).toEqual([
          'base: Record is locked for editing'
        ])
      })

      it('returns string body as-is', () => {
        // Proxy/nginx 502 response: plain text body
        expect(jsonApiConvention.parseErrorResponse({ status: 502, data: 'Bad Gateway' })).toEqual([
          'Bad Gateway'
        ])
      })

      it('falls back to JSON for unknown object shapes', () => {
        // Non-standard API error format
        const data = { code: 'UNAUTHORIZED', message: 'Token expired' }
        expect(jsonApiConvention.parseErrorResponse({ status: 401, data })).toEqual([
          JSON.stringify(data, null, 2)
        ])
      })

      it('handles validation hash with string messages (non-array)', () => {
        // Some APIs return single strings instead of arrays
        const response = { status: 422, data: { errors: { email: 'is already taken' } } }
        expect(jsonApiConvention.parseErrorResponse(response)).toEqual(['email: is already taken'])
      })

      it('returns empty array when response has no data', () => {
        expect(jsonApiConvention.parseErrorResponse({ status: 500 })).toEqual([])
      })
    })
  })
})
