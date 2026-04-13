/**
 * Token Revocation Contract Tests
 *
 * Validates token revocation responses conform to RFC 7009 Section 2.1.
 *
 * Per RFC 7009:
 * - Success: HTTP 200 with empty body (the server responds with 200 for
 *   both successful and unsuccessful requests to prevent token scanning)
 * - Error: OAuth error response (RFC 6749 Section 5.2) for malformed
 *   requests or server errors
 *
 * The MCP server delegates revocation to Identity via openid-client's
 * tokenRevocation(). These tests validate the response shapes the MCP
 * server must handle.
 */

import Ajv from 'ajv'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(__dirname, '../../../__fixtures__/contracts')

function loadSchema(filename) {
  const schema = JSON.parse(readFileSync(resolve(fixturesDir, filename), 'utf-8'))
  delete schema.$schema
  return schema
}

describe('Token Revocation Contract (RFC 7009)', () => {
  let validateRevocation
  let validateError

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    validateRevocation = ajv.compile(loadSchema('token-revocation-response.schema.json'))
    validateError = ajv.compile(loadSchema('oauth-error-response.schema.json'))
  })

  describe('success response (RFC 7009 Section 2.1)', () => {
    it('should validate empty object response', () => {
      const response = {}

      const valid = validateRevocation(response)
      expect(validateRevocation.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate null response body', () => {
      const response = null

      const valid = validateRevocation(response)
      expect(validateRevocation.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should reject non-empty object response', () => {
      // RFC 7009 success response must be empty
      const response = { status: 'revoked' }

      const valid = validateRevocation(response)
      expect(valid).toBe(false)
    })

    it('should reject array response', () => {
      const valid = validateRevocation([])
      expect(valid).toBe(false)
    })

    it('should reject string response', () => {
      const valid = validateRevocation('ok')
      expect(valid).toBe(false)
    })
  })

  describe('error response (RFC 7009 Section 2.2.1)', () => {
    it('should validate unsupported_token_type error', () => {
      const response = {
        error: 'unsupported_token_type',
        error_description:
          'The authorization server does not support the revocation of the presented token type'
      }

      const valid = validateError(response)
      expect(validateError.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate invalid_token error', () => {
      const response = {
        error: 'invalid_token'
      }

      const valid = validateError(response)
      expect(validateError.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate invalid_client error (authentication failure)', () => {
      const response = {
        error: 'invalid_client',
        error_description: 'Client authentication failed'
      }

      const valid = validateError(response)
      expect(validateError.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate server_error', () => {
      const response = {
        error: 'server_error',
        error_description: 'The authorization server encountered an unexpected condition'
      }

      const valid = validateError(response)
      expect(validateError.errors).toBeNull()
      expect(valid).toBe(true)
    })
  })

  describe('revocation idempotency', () => {
    it('should validate response for already-revoked token (still empty per RFC 7009)', () => {
      // RFC 7009: server responds 200 even if the token was already revoked
      const response = {}

      const valid = validateRevocation(response)
      expect(validateRevocation.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate response for non-existent token (still empty per RFC 7009)', () => {
      // RFC 7009: server responds 200 even for invalid tokens to prevent scanning
      const response = {}

      const valid = validateRevocation(response)
      expect(validateRevocation.errors).toBeNull()
      expect(valid).toBe(true)
    })
  })
})
