/**
 * Token Exchange Contract Tests
 *
 * Validates that token exchange responses and OAuth error responses
 * conform to the shared JSON Schema contracts (RFC 6749).
 * Ensures the MCP server's oauth-router can safely proxy token
 * responses from Identity.
 */

import Ajv from 'ajv'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(__dirname, '../../../__fixtures__/contracts')

/**
 * Load and parse a JSON Schema file, stripping $schema for Ajv 8 compatibility
 */
function loadSchema(filename) {
  const schema = JSON.parse(readFileSync(resolve(fixturesDir, filename), 'utf-8'))
  delete schema.$schema
  return schema
}

describe('Token Exchange Contract (RFC 6749)', () => {
  let validateToken
  let validateError

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
    validateToken = ajv.compile(loadSchema('token-exchange-response.schema.json'))
    validateError = ajv.compile(loadSchema('oauth-error-response.schema.json'))
  })

  describe('token response', () => {
    it('should validate a complete token response', () => {
      const response = {
        access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4',
        scope: 'read write'
      }

      const valid = validateToken(response)
      expect(validateToken.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate a minimal token response', () => {
      const response = {
        access_token: 'test-access-token',
        token_type: 'Bearer'
      }

      const valid = validateToken(response)
      expect(validateToken.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate a client credentials token response', () => {
      const response = {
        access_token: 'm2m-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read write'
      }

      const valid = validateToken(response)
      expect(validateToken.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should reject token response missing access_token', () => {
      const response = {
        token_type: 'Bearer',
        expires_in: 3600
      }

      const valid = validateToken(response)
      expect(valid).toBe(false)
      expect(validateToken.errors).toContainEqual(
        expect.objectContaining({
          params: expect.objectContaining({ missingProperty: 'access_token' })
        })
      )
    })

    it('should reject token response missing token_type', () => {
      const response = {
        access_token: 'test-token',
        expires_in: 3600
      }

      const valid = validateToken(response)
      expect(valid).toBe(false)
      expect(validateToken.errors).toContainEqual(
        expect.objectContaining({
          params: expect.objectContaining({ missingProperty: 'token_type' })
        })
      )
    })

    it('should allow additional properties (forward-compatible)', () => {
      const response = {
        access_token: 'test-token',
        token_type: 'Bearer',
        id_token: 'eyJ...'
      }

      const valid = validateToken(response)
      expect(validateToken.errors).toBeNull()
      expect(valid).toBe(true)
    })
  })

  describe('error response', () => {
    it('should validate a complete error response', () => {
      const response = {
        error: 'invalid_grant',
        error_description: 'The authorization code has expired'
      }

      const valid = validateError(response)
      expect(validateError.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate a minimal error response', () => {
      const response = {
        error: 'server_error'
      }

      const valid = validateError(response)
      expect(validateError.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should reject error response missing error field', () => {
      const response = {
        error_description: 'Something went wrong'
      }

      const valid = validateError(response)
      expect(valid).toBe(false)
    })

    it('should validate common OAuth error codes', () => {
      const errorCodes = [
        'invalid_request',
        'invalid_client',
        'invalid_grant',
        'unauthorized_client',
        'unsupported_grant_type',
        'invalid_scope',
        'server_error'
      ]

      for (const code of errorCodes) {
        const response = { error: code }
        const valid = validateError(response)
        expect(validateError.errors).toBeNull()
        expect(valid).toBe(true)
      }
    })
  })
})
