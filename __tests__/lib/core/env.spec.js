import { describe, it, expect, afterEach } from 'vitest'
import { requireEnv, optionalEnv, intEnv, boolEnv } from '#src/core/env.js'

describe('lib/core/env', () => {
  const TEST_VAR = 'TEST_ENV_UTIL_VAR'

  afterEach(() => {
    delete process.env[TEST_VAR]
  })

  describe('requireEnv', () => {
    it('should return the value when set', () => {
      process.env[TEST_VAR] = 'hello'
      expect(requireEnv(TEST_VAR)).toBe('hello')
    })

    it('should throw when variable is not set', () => {
      expect(() => requireEnv(TEST_VAR)).toThrow(
        `Missing required environment variable: ${TEST_VAR}`
      )
    })

    it('should throw when variable is empty string', () => {
      process.env[TEST_VAR] = ''
      expect(() => requireEnv(TEST_VAR)).toThrow(
        `Missing required environment variable: ${TEST_VAR}`
      )
    })

    it('should include context in error message', () => {
      expect(() => requireEnv(TEST_VAR, 'OAuth')).toThrow(
        `[OAuth] Missing required environment variable: ${TEST_VAR}`
      )
    })
  })

  describe('optionalEnv', () => {
    it('should return the value when set', () => {
      process.env[TEST_VAR] = 'world'
      expect(optionalEnv(TEST_VAR)).toBe('world')
    })

    it('should return default when not set', () => {
      expect(optionalEnv(TEST_VAR, 'fallback')).toBe('fallback')
    })

    it('should return empty string as default when not set and no default given', () => {
      expect(optionalEnv(TEST_VAR)).toBe('')
    })

    it('should return default when variable is empty string', () => {
      process.env[TEST_VAR] = ''
      expect(optionalEnv(TEST_VAR, 'fallback')).toBe('fallback')
    })
  })

  describe('intEnv', () => {
    it('should parse a valid integer', () => {
      process.env[TEST_VAR] = '4100'
      expect(intEnv(TEST_VAR, 3000)).toBe(4100)
    })

    it('should return default when not set', () => {
      expect(intEnv(TEST_VAR, 3000)).toBe(3000)
    })

    it('should return default when empty string', () => {
      process.env[TEST_VAR] = ''
      expect(intEnv(TEST_VAR, 3000)).toBe(3000)
    })

    it('should throw on non-numeric value', () => {
      process.env[TEST_VAR] = 'not-a-number'
      expect(() => intEnv(TEST_VAR, 3000)).toThrow(
        `Environment variable ${TEST_VAR} must be an integer, got: "not-a-number"`
      )
    })
  })

  describe('boolEnv', () => {
    it('should return true for "true"', () => {
      process.env[TEST_VAR] = 'true'
      expect(boolEnv(TEST_VAR)).toBe(true)
    })

    it('should return true for "1"', () => {
      process.env[TEST_VAR] = '1'
      expect(boolEnv(TEST_VAR)).toBe(true)
    })

    it('should return false for "false"', () => {
      process.env[TEST_VAR] = 'false'
      expect(boolEnv(TEST_VAR)).toBe(false)
    })

    it('should return false for any other string', () => {
      process.env[TEST_VAR] = 'yes'
      expect(boolEnv(TEST_VAR)).toBe(false)
    })

    it('should return default when not set', () => {
      expect(boolEnv(TEST_VAR)).toBe(false)
      expect(boolEnv(TEST_VAR, true)).toBe(true)
    })

    it('should return default when empty string', () => {
      process.env[TEST_VAR] = ''
      expect(boolEnv(TEST_VAR, true)).toBe(true)
    })
  })
})
