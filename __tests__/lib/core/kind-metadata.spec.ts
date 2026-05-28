import { describe, expect, it } from 'vitest'

import { getKind, KIND_REGISTRY, registerKind } from '../../../src/core/kind-metadata.js'

describe('lib/core/kind-metadata', () => {
  describe('getKind', () => {
    it('returns the string passthrough when kind is unknown', () => {
      const kind = getKind('nonexistent')
      expect(kind.htmlInputType).toBe('text')
      expect(kind.promptType).toBe('string')
    })

    it('returns the string passthrough when kind is undefined', () => {
      const kind = getKind(undefined)
      expect(kind.promptType).toBe('string')
    })

    it('lowercases kind argument (fixes URL/url casing bug)', () => {
      expect(getKind('URL').htmlInputType).toBe('url')
      expect(getKind('Email').htmlInputType).toBe('email')
    })

    it('lowercases format argument', () => {
      registerKind('string', { label: 'ISBN', htmlInputType: 'text' }, { format: 'isbn' })
      expect(getKind('string', 'ISBN').label).toBe('ISBN')
      KIND_REGISTRY.delete('string:isbn')
    })

    it('falls back to base kind when format is unknown', () => {
      expect(getKind('string', 'nonexistent').label).toBe('Text')
    })
  })

  describe('string', () => {
    const k = getKind('string')
    it('htmlInputType is text, promptType is string', () => {
      expect(k.htmlInputType).toBe('text')
      expect(k.promptType).toBe('string')
    })
    it('describe returns the value', () => {
      expect(k.describe('hello')).toBe('hello')
      expect(k.describe(null)).toBe('')
    })
    it('round-trips through input', () => {
      expect(k.toInput('hello')).toBe('hello')
      expect(k.fromInput('hello')).toBe('hello')
      expect(k.fromInput('')).toBe(null)
    })
    it('validate accepts anything', () => {
      expect(k.validate('hello')).toBe(null)
    })
  })

  describe('text', () => {
    const k = getKind('text')
    it('htmlInputType is textarea', () => {
      expect(k.htmlInputType).toBe('textarea')
      expect(k.promptType).toBe('text')
    })
  })

  describe('integer', () => {
    const k = getKind('integer')
    it('htmlInputType is number, promptType is integer', () => {
      expect(k.htmlInputType).toBe('number')
      expect(k.promptType).toBe('integer')
    })
    it('parses string to number, round-trips', () => {
      expect(k.parse('42')).toBe(42)
      expect(k.parse('')).toBe(null)
      expect(k.parse(null)).toBe(null)
      expect(k.toInput(42)).toBe('42')
      expect(k.fromInput('42')).toBe(42)
      expect(k.fromInput('')).toBe(null)
      expect(k.serialize(42)).toBe(42)
    })
    it('describe returns string representation', () => {
      expect(k.describe(42)).toBe('42')
      expect(k.describe(null)).toBe('')
    })
    it('validate rejects non-integers', () => {
      expect(k.validate(42)).toBe(null)
      expect(k.validate(3.14)).toBe('must be an integer')
      expect(k.validate('42')).toBe('must be an integer')
      expect(k.validate(null)).toBe(null)
    })
  })

  describe('decimal', () => {
    const k = getKind('decimal')
    it('htmlInputType is number, promptType is number', () => {
      expect(k.htmlInputType).toBe('number')
      expect(k.promptType).toBe('number')
    })
    it('parses and serializes', () => {
      expect(k.parse('3.14')).toBe(3.14)
      expect(k.fromInput('3.14')).toBe(3.14)
      expect(k.toInput(3.14)).toBe('3.14')
    })
    it('validate accepts finite numbers', () => {
      expect(k.validate(3.14)).toBe(null)
      expect(k.validate(NaN)).toBe('must be a number')
      expect(k.validate('3.14')).toBe('must be a number')
    })
  })

  describe('boolean', () => {
    const k = getKind('boolean')
    it('htmlInputType is checkbox', () => {
      expect(k.htmlInputType).toBe('checkbox')
      expect(k.promptType).toBe('boolean')
    })
    it('parses truthy variants', () => {
      expect(k.parse(true)).toBe(true)
      expect(k.parse('true')).toBe(true)
      expect(k.parse(1)).toBe(true)
      expect(k.parse('1')).toBe(true)
      expect(k.parse('false')).toBe(false)
      expect(k.parse(0)).toBe(false)
    })
    it('describe returns Yes/No', () => {
      expect(k.describe(true)).toBe('Yes')
      expect(k.describe(false)).toBe('No')
    })
    it('round-trips through input', () => {
      expect(k.toInput(true)).toBe('true')
      expect(k.toInput(false)).toBe('false')
      expect(k.fromInput('on')).toBe(true)
      expect(k.fromInput('true')).toBe(true)
      expect(k.fromInput('false')).toBe(false)
    })
    it('serializes to Boolean', () => {
      expect(k.serialize(1)).toBe(true)
      expect(k.serialize('')).toBe(false)
    })
    it('validate rejects non-booleans', () => {
      expect(k.validate(true)).toBe(null)
      expect(k.validate('true')).toBe('must be a boolean')
      expect(k.validate(null)).toBe(null)
    })
  })

  describe('date', () => {
    const k = getKind('date')
    it('htmlInputType is date', () => {
      expect(k.htmlInputType).toBe('date')
      expect(k.promptType).toBe('date')
    })
    it('parses ISO strings, returns null for invalid', () => {
      const d = k.parse('2026-05-28') as Date
      expect(d).toBeInstanceOf(Date)
      expect(k.parse('not-a-date')).toBe(null)
      expect(k.parse(null)).toBe(null)
    })
    it('round-trips ISO ⇄ input ⇄ Date', () => {
      const d = k.parse('2026-05-28') as Date
      expect(k.toInput(d)).toBe('2026-05-28')
      expect(k.serialize(d)).toBe('2026-05-28')
      const back = k.fromInput('2026-05-28') as Date
      expect(back).toBeInstanceOf(Date)
      expect(k.serialize(back)).toBe('2026-05-28')
    })
    it('describe returns ISO date', () => {
      expect(k.describe('2026-05-28')).toBe('2026-05-28')
      expect(k.describe(null)).toBe('')
    })
    it('validate rejects garbage', () => {
      expect(k.validate('2026-05-28')).toBe(null)
      expect(k.validate('not-a-date')).toBe('must be a valid date')
      expect(k.validate(null)).toBe(null)
    })
  })

  describe('datetime', () => {
    const k = getKind('datetime')
    it('htmlInputType is datetime-local', () => {
      expect(k.htmlInputType).toBe('datetime-local')
      expect(k.promptType).toBe('datetime')
    })
    it('parses and serializes ISO datetime', () => {
      const d = k.parse('2026-05-28T14:30:00Z') as Date
      expect(d).toBeInstanceOf(Date)
      expect(k.serialize(d)).toBe('2026-05-28T14:30:00.000Z')
      expect(k.toInput(d)).toBe('2026-05-28T14:30')
    })
    it('describe returns full ISO', () => {
      expect(k.describe('2026-05-28T14:30:00Z')).toBe('2026-05-28T14:30:00.000Z')
    })
    it('validate rejects garbage', () => {
      expect(k.validate('2026-05-28T14:30:00Z')).toBe(null)
      expect(k.validate('garbage')).toBe('must be a valid datetime')
    })
  })

  describe('time', () => {
    const k = getKind('time')
    it('htmlInputType is time', () => {
      expect(k.htmlInputType).toBe('time')
      expect(k.promptType).toBe('time')
    })
    it('truncates seconds in toInput and describe', () => {
      expect(k.toInput('14:30:00')).toBe('14:30')
      expect(k.describe('14:30:00')).toBe('14:30')
    })
    it('validate accepts HH:mm and HH:mm:ss', () => {
      expect(k.validate('14:30')).toBe(null)
      expect(k.validate('14:30:00')).toBe(null)
      expect(k.validate('25:00')).toBe('must be a valid time (HH:mm or HH:mm:ss)')
      expect(k.validate('garbage')).toBe('must be a valid time (HH:mm or HH:mm:ss)')
    })
  })

  describe('enum', () => {
    const k = getKind('enum')
    it('promptType is enum', () => {
      expect(k.promptType).toBe('enum')
    })
    it('describe humanizes the value', () => {
      expect(k.describe('currently_reading')).toBe('Currently Reading')
      expect(k.describe(null)).toBe('')
    })
  })

  describe('array', () => {
    const k = getKind('array')
    it('promptType is array', () => {
      expect(k.promptType).toBe('array')
    })
    it('parses to array, normalizes singles', () => {
      expect(k.parse(['a', 'b'])).toEqual(['a', 'b'])
      expect(k.parse('a')).toEqual(['a'])
      expect(k.parse(null)).toEqual([])
    })
    it('describe joins humanized items', () => {
      expect(k.describe(['physical', 'pdf'])).toBe('Physical, Pdf')
      expect(k.describe([])).toBe('')
    })
    it('round-trips through input', () => {
      expect(k.toInput(['a', 'b'])).toBe('a,b')
      expect(k.fromInput('a, b , c')).toEqual(['a', 'b', 'c'])
    })
    it('validate rejects non-arrays', () => {
      expect(k.validate(['a'])).toBe(null)
      expect(k.validate('a')).toBe('must be an array')
    })
  })

  describe('uuid', () => {
    const k = getKind('uuid')
    it('promptType is uuid', () => {
      expect(k.promptType).toBe('uuid')
      expect(k.htmlInputType).toBe('text')
    })
    it('validate accepts canonical UUIDs', () => {
      expect(k.validate('550e8400-e29b-41d4-a716-446655440000')).toBe(null)
      expect(k.validate('not-a-uuid')).toBe('must be a valid UUID')
    })
  })

  describe('json', () => {
    const k = getKind('json')
    it('htmlInputType is textarea, promptType is object', () => {
      expect(k.htmlInputType).toBe('textarea')
      expect(k.promptType).toBe('object')
    })
    it('toInput pretty-prints, fromInput parses', () => {
      expect(k.toInput({ a: 1 })).toBe('{\n  "a": 1\n}')
      expect(k.fromInput('{"a":1}')).toEqual({ a: 1 })
      expect(k.fromInput('not json')).toBe('not json')
    })
    it('validate accepts string JSON', () => {
      expect(k.validate('{"a":1}')).toBe(null)
      expect(k.validate('not json')).toBe('must be valid JSON')
      expect(k.validate({ a: 1 })).toBe(null)
    })
  })

  describe('color', () => {
    const k = getKind('color')
    it('htmlInputType is color', () => {
      expect(k.htmlInputType).toBe('color')
    })
    it('describe returns the value', () => {
      expect(k.describe('#ff00aa')).toBe('#ff00aa')
    })
  })

  describe('email', () => {
    const k = getKind('email')
    it('htmlInputType is email', () => {
      expect(k.htmlInputType).toBe('email')
    })
    it('validate accepts valid emails', () => {
      expect(k.validate('a@b.co')).toBe(null)
      expect(k.validate('not-an-email')).toBe('must be a valid email address')
    })
  })

  describe('url', () => {
    const k = getKind('url')
    it('htmlInputType is url', () => {
      expect(k.htmlInputType).toBe('url')
    })
    it('validate accepts parseable URLs', () => {
      expect(k.validate('https://example.com')).toBe(null)
      expect(k.validate('not-a-url')).toBe('must be a valid URL')
    })
  })

  describe('base64', () => {
    const k = getKind('base64')
    it('describe returns (binary) regardless of input', () => {
      expect(k.describe('aGVsbG8=')).toBe('(binary)')
      expect(k.describe(null)).toBe('(binary)')
    })
  })

  describe('rating', () => {
    const k = getKind('rating')
    it('htmlInputType is number, promptType is integer', () => {
      expect(k.htmlInputType).toBe('number')
      expect(k.promptType).toBe('integer')
    })
    it('describe formats as n/max', () => {
      expect(k.describe(3)).toBe('3/5')
      expect(k.describe(3, { max: 10 })).toBe('3/10')
      expect(k.describe(11, { max: 10 })).toBe('10/10')
      expect(k.describe(-1)).toBe('0/5')
    })
    it('validate enforces 0..max', () => {
      expect(k.validate(3)).toBe(null)
      expect(k.validate(6)).toBe('must be between 0 and 5')
      expect(k.validate(6, { max: 10 })).toBe(null)
      expect(k.validate(-1)).toBe('must be between 0 and 5')
      expect(k.validate('three')).toBe('must be a number')
    })
  })
})
