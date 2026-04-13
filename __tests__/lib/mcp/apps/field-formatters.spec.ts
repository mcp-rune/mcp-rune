import { FIELD_FORMATTERS } from '../../../../src/mcp/apps/model-form-ui/field-formatters.js'

describe('lib/mcp/apps/field-formatters', () => {
  describe('datetime-local', () => {
    const fmt = FIELD_FORMATTERS['datetime-local']

    describe('toDisplay', () => {
      it('converts ISO 8601 with Z to datetime-local format', () => {
        expect(fmt.toDisplay('2026-02-23T14:00:00Z')).toBe('2026-02-23T14:00')
      })

      it('converts ISO 8601 with positive offset to UTC', () => {
        // 14:00+01:00 = 13:00 UTC
        expect(fmt.toDisplay('2026-02-23T14:00:00+01:00')).toBe('2026-02-23T13:00')
      })

      it('converts ISO 8601 with negative offset to UTC', () => {
        // 10:00-05:00 = 15:00 UTC
        expect(fmt.toDisplay('2026-02-23T10:00:00-05:00')).toBe('2026-02-23T15:00')
      })

      it('handles date boundary crossing when converting to UTC', () => {
        // 01:00+03:00 = 22:00 UTC on previous day
        expect(fmt.toDisplay('2026-02-23T01:00:00+03:00')).toBe('2026-02-22T22:00')
      })

      it('handles ISO 8601 with milliseconds', () => {
        expect(fmt.toDisplay('2026-02-23T14:30:45.123Z')).toBe('2026-02-23T14:30')
      })

      it('returns empty string for empty input', () => {
        expect(fmt.toDisplay('')).toBe('')
      })

      it('returns empty string for null', () => {
        expect(fmt.toDisplay(null)).toBe('')
      })

      it('returns empty string for undefined', () => {
        expect(fmt.toDisplay(undefined)).toBe('')
      })

      it('returns original value for unparseable input', () => {
        expect(fmt.toDisplay('not-a-date')).toBe('not-a-date')
      })
    })

    describe('toValue', () => {
      it('converts datetime-local to ISO 8601 UTC', () => {
        expect(fmt.toValue('2026-02-23T14:00')).toBe('2026-02-23T14:00:00Z')
      })

      it('returns empty string for empty input', () => {
        expect(fmt.toValue('')).toBe('')
      })

      it('returns empty string for null', () => {
        expect(fmt.toValue(null)).toBe('')
      })

      it('returns empty string for undefined', () => {
        expect(fmt.toValue(undefined)).toBe('')
      })
    })
  })

  describe('time', () => {
    const fmt = FIELD_FORMATTERS.time

    describe('toDisplay', () => {
      it('truncates seconds from time value', () => {
        expect(fmt.toDisplay('14:30:00')).toBe('14:30')
      })

      it('passes through HH:mm format unchanged', () => {
        expect(fmt.toDisplay('14:30')).toBe('14:30')
      })

      it('returns empty string for empty input', () => {
        expect(fmt.toDisplay('')).toBe('')
      })

      it('returns empty string for null', () => {
        expect(fmt.toDisplay(null)).toBe('')
      })
    })

    describe('toValue', () => {
      it('passes through time value', () => {
        expect(fmt.toValue('14:30')).toBe('14:30')
      })

      it('returns empty string for empty input', () => {
        expect(fmt.toValue('')).toBe('')
      })

      it('returns empty string for null', () => {
        expect(fmt.toValue(null)).toBe('')
      })
    })
  })
})
