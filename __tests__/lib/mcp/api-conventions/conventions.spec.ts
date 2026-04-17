import { BaseConvention } from '../../../../src/mcp/api-conventions/base-convention.js'
import { halConvention } from '../../../../src/mcp/api-conventions/hal.js'
import { jsonApiConvention } from '../../../../src/mcp/api-conventions/json-api.js'

describe('lib/mcp/api-conventions', () => {
  describe('BaseConvention', () => {
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
  })

  describe('HalConvention', () => {
    describe('flattenExpandedResources', () => {
      // Sample HAL records with expanded title and platform
      const halRecords = [
        {
          id: 63,
          put_up: '2026-08-06T23:00:00+02:00',
          metadata_status: 'invalid',
          title: {
            resource_type: 'title',
            id: 58,
            name: 'Pilot',
            title: 'E01: Pilot',
            title_type: 'episode',
            self_link: 'http://localhost:4001/api/titles/58',
            series_link: 'http://localhost:4001/api/title_groups/16'
          },
          platform: {
            resource_type: 'platform',
            id: 151,
            name: 'Spain > AVOD > Website',
            self_link: 'http://localhost:4001/api/platforms/151',
            schedule_link: 'http://localhost:4001/api/platforms/151/schedule'
          },
          title_link: 'http://localhost:4001/api/titles/58',
          platform_link: 'http://localhost:4001/api/platforms/151'
        }
      ]

      const associations = {
        belongsTo: {
          title: { target_model: 'title' },
          platform: { target_model: 'platform' },
          asset: { target_model: 'asset' } // not expanded in response
        }
      }

      it('flattens expanded associations with requested fields', () => {
        const result = halConvention.flattenExpandedResources(halRecords, associations, [
          'title_name',
          'platform_name',
          'metadata_status',
          'put_up'
        ])

        expect(result).toHaveLength(1)
        expect(result[0].title_name).toBe('Pilot')
        expect(result[0].platform_name).toBe('Spain > AVOD > Website')
        // Regular fields pass through
        expect(result[0].metadata_status).toBe('invalid')
        expect(result[0].put_up).toBe('2026-08-06T23:00:00+02:00')
        // Original nested objects are removed
        expect(result[0].title).toBeUndefined()
        expect(result[0].platform).toBeUndefined()
      })

      it('always includes {assoc}_id even when not in requestedFields', () => {
        const result = halConvention.flattenExpandedResources(halRecords, associations, [
          'title_name'
        ])

        expect(result[0].title_name).toBe('Pilot')
        expect(result[0].title_id).toBe(58)
        // platform_id also included since platform is expanded
        expect(result[0].platform_id).toBe(151)
      })

      it('flattens all scalar child fields when no requestedFields', () => {
        const result = halConvention.flattenExpandedResources(halRecords, associations)

        expect(result[0].title_id).toBe(58)
        expect(result[0].title_name).toBe('Pilot')
        expect(result[0].title_title).toBe('E01: Pilot')
        expect(result[0].title_title_type).toBe('episode')
        expect(result[0].platform_id).toBe(151)
        expect(result[0].platform_name).toBe('Spain > AVOD > Website')
        // Protocol fields are excluded
        expect(result[0].title_resource_type).toBeUndefined()
        expect(result[0].title_self_link).toBeUndefined()
        expect(result[0].title_series_link).toBeUndefined()
        expect(result[0].platform_schedule_link).toBeUndefined()
      })

      it('skips associations not expanded in the response', () => {
        const result = halConvention.flattenExpandedResources(halRecords, associations, [
          'asset_name'
        ])

        // asset is in belongsTo but not present as an object in the record
        expect(result[0].asset_name).toBeUndefined()
        // Other fields still pass through
        expect(result[0].id).toBe(63)
      })

      it('handles null expanded objects gracefully', () => {
        const recordsWithNull = [{ ...halRecords[0], title: null }]
        // title is null but still a belongsTo key — flattened fields should be null
        const result = halConvention.flattenExpandedResources(recordsWithNull, associations, [
          'platform_name'
        ])

        // platform still works
        expect(result[0].platform_name).toBe('Spain > AVOD > Website')
        // title was null so not detected as expanded (not an object)
        expect(result[0].title_name).toBeUndefined()
      })

      it('falls back to resource_type heuristic without associations config', () => {
        const result = halConvention.flattenExpandedResources(halRecords, undefined, [
          'title_name',
          'platform_name'
        ])

        expect(result[0].title_name).toBe('Pilot')
        expect(result[0].platform_name).toBe('Spain > AVOD > Website')
        expect(result[0].title_id).toBe(58)
      })

      it('returns records unchanged when no expanded objects found', () => {
        const flatRecords = [{ id: 1, name: 'Test', status: 'active' }]
        const result = halConvention.flattenExpandedResources(flatRecords, associations)
        expect(result).toEqual(flatRecords)
      })

      it('returns empty array unchanged', () => {
        expect(halConvention.flattenExpandedResources([], associations)).toEqual([])
      })

      it('does not mutate input records', () => {
        const original = JSON.parse(JSON.stringify(halRecords))
        halConvention.flattenExpandedResources(halRecords, associations, ['title_name'])
        expect(halRecords).toEqual(original)
      })

      it('handles multiple records consistently', () => {
        const records = [
          {
            id: 1,
            title: { resource_type: 'title', id: 10, name: 'Episode 1', self_link: '/titles/10' }
          },
          {
            id: 2,
            title: { resource_type: 'title', id: 20, name: 'Episode 2', self_link: '/titles/20' }
          }
        ]
        const result = halConvention.flattenExpandedResources(
          records,
          { belongsTo: { title: { target_model: 'title' } } },
          ['title_name']
        )

        expect(result[0].title_name).toBe('Episode 1')
        expect(result[0].title_id).toBe(10)
        expect(result[1].title_name).toBe('Episode 2')
        expect(result[1].title_id).toBe(20)
      })
    })
  })
})
