import { describe, it, expect } from 'vitest'
import {
  sanitizeObject,
  sanitizeHeaders,
  sanitizeToolArgs,
  beforeSendSanitizer
} from '../../../../../src/services/vendor/sentry/sanitizers.js'

describe('lib/services/vendor/sentry/sanitizers', () => {
  describe('sanitizeObject', () => {
    it('should redact sensitive fields', () => {
      const obj = {
        name: 'test',
        password: 'secret123',
        token: 'abc123',
        data: 'visible'
      }

      const result = sanitizeObject(obj)

      expect(result.name).toBe('test')
      expect(result.password).toBe('[REDACTED]')
      expect(result.token).toBe('[REDACTED]')
      expect(result.data).toBe('visible')
    })

    it('should handle nested objects', () => {
      const obj = {
        user: {
          name: 'John',
          credentials: {
            password: 'secret',
            apiKey: 'key123'
          }
        }
      }

      const result = sanitizeObject(obj)

      expect(result.user.name).toBe('John')
      expect(result.user.credentials.password).toBe('[REDACTED]')
      expect(result.user.credentials.apiKey).toBe('[REDACTED]')
    })

    it('should handle arrays', () => {
      const obj = {
        users: [
          { name: 'John', password: 'secret' },
          { name: 'Jane', password: 'hidden' }
        ]
      }

      const result = sanitizeObject(obj)

      expect(result.users[0].name).toBe('John')
      expect(result.users[0].password).toBe('[REDACTED]')
      expect(result.users[1].name).toBe('Jane')
      expect(result.users[1].password).toBe('[REDACTED]')
    })

    it('should handle null and undefined', () => {
      expect(sanitizeObject(null)).toBe(null)
      expect(sanitizeObject(undefined)).toBe(undefined)
    })

    it('should respect max depth', () => {
      const deepObj = { a: { b: { c: { d: { e: { f: 'deep' } } } } } }
      const result = sanitizeObject(deepObj, 0, 3)

      // Should stop recursing at depth 3
      expect(result.a.b.c.d).toEqual({ e: { f: 'deep' } })
    })

    it('should handle case-insensitive field matching', () => {
      const obj = {
        PASSWORD: 'secret',
        AccessToken: 'token',
        API_KEY: 'key'
      }

      const result = sanitizeObject(obj)

      expect(result.PASSWORD).toBe('[REDACTED]')
      expect(result.AccessToken).toBe('[REDACTED]')
      expect(result.API_KEY).toBe('[REDACTED]')
    })
  })

  describe('sanitizeHeaders', () => {
    it('should redact authorization header', () => {
      const headers = {
        authorization: 'Bearer token123',
        'content-type': 'application/json'
      }

      const result = sanitizeHeaders(headers)

      expect(result.authorization).toBe('[REDACTED]')
      expect(result['content-type']).toBe('application/json')
    })

    it('should redact cookie header', () => {
      const headers = {
        cookie: 'session=abc123',
        accept: 'application/json'
      }

      const result = sanitizeHeaders(headers)

      expect(result.cookie).toBe('[REDACTED]')
      expect(result.accept).toBe('application/json')
    })

    it('should redact x-api-key header', () => {
      const headers = {
        'x-api-key': 'secret-key',
        'x-request-id': 'req-123'
      }

      const result = sanitizeHeaders(headers)

      expect(result['x-api-key']).toBe('[REDACTED]')
      expect(result['x-request-id']).toBe('req-123')
    })

    it('should handle null headers', () => {
      expect(sanitizeHeaders(null)).toBe(null)
      expect(sanitizeHeaders(undefined)).toBe(undefined)
    })
  })

  describe('sanitizeToolArgs', () => {
    it('should sanitize sensitive fields', () => {
      const args = {
        model: 'book',
        attributes: {
          title: 'Test',
          password: 'secret'
        }
      }

      const result = sanitizeToolArgs(args)

      expect(result.model).toBe('book')
      expect(result.attributes.title).toBe('Test')
      expect(result.attributes.password).toBe('[REDACTED]')
    })

    it('should truncate large string values', () => {
      const longString = 'x'.repeat(2000)
      const args = {
        description: longString
      }

      const result = sanitizeToolArgs(args)

      expect(result.description.length).toBeLessThan(2000)
      expect(result.description).toContain('[truncated]')
    })

    it('should handle empty args', () => {
      expect(sanitizeToolArgs(null)).toEqual({})
      expect(sanitizeToolArgs(undefined)).toEqual({})
      expect(sanitizeToolArgs({})).toEqual({})
    })
  })

  describe('beforeSendSanitizer', () => {
    it('should sanitize request headers', () => {
      const event = {
        request: {
          headers: {
            authorization: 'Bearer token'
          }
        }
      }

      const result = beforeSendSanitizer(event)

      expect(result.request.headers.authorization).toBe('[REDACTED]')
    })

    it('should sanitize request data', () => {
      const event = {
        request: {
          data: {
            username: 'john',
            password: 'secret'
          }
        }
      }

      const result = beforeSendSanitizer(event)

      expect(result.request.data.username).toBe('john')
      expect(result.request.data.password).toBe('[REDACTED]')
    })

    it('should sanitize breadcrumbs', () => {
      const event = {
        breadcrumbs: [
          {
            category: 'http',
            data: {
              url: '/api/users',
              token: 'secret'
            }
          }
        ]
      }

      const result = beforeSendSanitizer(event)

      expect(result.breadcrumbs[0].data.url).toBe('/api/users')
      expect(result.breadcrumbs[0].data.token).toBe('[REDACTED]')
    })

    it('should sanitize extra context', () => {
      const event = {
        extra: {
          userId: '123',
          apiKey: 'secret'
        }
      }

      const result = beforeSendSanitizer(event)

      expect(result.extra.userId).toBe('123')
      expect(result.extra.apiKey).toBe('[REDACTED]')
    })

    it('should return event unchanged if no sensitive data', () => {
      const event = {
        message: 'Test error',
        level: 'error'
      }

      const result = beforeSendSanitizer(event)

      expect(result).toEqual(event)
    })
  })
})
