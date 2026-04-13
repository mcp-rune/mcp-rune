import { BaseConvention } from '../../../../src/mcp/api-conventions/base-convention.js'
import { jsonApiConvention } from '../../../../src/mcp/api-conventions/json-api.js'

describe('lib/mcp/api-conventions', () => {
  describe('BaseConvention', () => {
    it('cleanResponse is a no-op by default', () => {
      const base = new BaseConvention()
      const data = { id: 1, _links: { self: {} } }
      expect(base.cleanResponse(data)).toBe(data)
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
  })
})
