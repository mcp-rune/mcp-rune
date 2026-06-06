import { describe, expect, it } from 'vitest'

import { closestMatch, levenshtein } from '../../../src/core/suggestions.js'

describe('lib/core/suggestions', () => {
  describe('levenshtein', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshtein('datetime', 'datetime')).toBe(0)
    })

    it('is case-insensitive', () => {
      expect(levenshtein('DateTime', 'datetime')).toBe(0)
    })

    it('counts single substitution as 1', () => {
      expect(levenshtein('datetime', 'datetimx')).toBe(1)
    })

    it('counts insertion + substitution', () => {
      expect(levenshtein('datetimme', 'datetime')).toBe(1)
    })
  })

  describe('closestMatch', () => {
    it('finds the obvious typo', () => {
      const match = closestMatch('datetimme', ['datetime', 'date', 'time', 'integer'])
      expect(match).toBe('datetime')
    })

    it('returns null when nothing is within maxDistance', () => {
      expect(closestMatch('completely_unrelated', ['datetime', 'date'])).toBeNull()
    })

    it('respects custom maxDistance', () => {
      // edit distance from "data" → "date" is 1 (substitution); with
      // maxDistance=0 it should not match, with maxDistance=1 it should.
      expect(closestMatch('data', ['date'], 0)).toBeNull()
      expect(closestMatch('data', ['date'], 1)).toBe('date')
    })
  })
})
