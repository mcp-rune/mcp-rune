/**
 * Field Formatters Registry
 *
 * Converts values between API format and HTML input display format.
 * Each entry provides `toDisplay(apiValue)` and `toValue(displayValue)`.
 *
 * To add a new transformed field type, add an entry here and wire the
 * corresponding field type in form-schema.js TYPE_MAP.
 */

export const FIELD_FORMATTERS = {
  'datetime-local': {
    /**
     * Convert ISO 8601 datetime to datetime-local input format (UTC).
     * "2026-02-23T14:00:00Z" → "2026-02-23T14:00"
     * "2026-02-23T14:00:00+01:00" → "2026-02-23T13:00" (converted to UTC)
     */
    toDisplay(apiValue) {
      if (!apiValue) return ''
      const d = new Date(apiValue)
      if (isNaN(d.getTime())) return apiValue
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    },

    /**
     * Convert datetime-local input value back to ISO 8601 UTC.
     * "2026-02-23T14:00" → "2026-02-23T14:00:00Z"
     */
    toValue(displayValue) {
      if (!displayValue) return ''
      return displayValue + ':00Z'
    }
  },

  time: {
    /**
     * Truncate seconds from time value for HTML time input.
     * "14:30:00" → "14:30"
     */
    toDisplay(apiValue) {
      if (!apiValue) return ''
      return apiValue.substring(0, 5)
    },

    /**
     * Pass through time value (API expects HH:MM).
     * "14:30" → "14:30"
     */
    toValue(displayValue) {
      if (!displayValue) return ''
      return displayValue
    }
  }
}
