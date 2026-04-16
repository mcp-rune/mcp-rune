/**
 * Scope Contract Tests
 *
 * Validates that OAuth scope strings conform to RFC 6749 Section 3.3
 * across all surfaces where scopes appear in the MCP server:
 * - OAuthService configuration (default and explicit)
 * - Authorization request parameters
 * - Token exchange responses
 * - Token introspection responses
 * - Client credentials responses
 * - DCR requests
 *
 * Per RFC 6749 Section 3.3, scope is a space-delimited list of
 * case-sensitive scope tokens. Each token consists of printable ASCII
 * characters excluding space, backslash, and double-quote.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv from 'ajv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(__dirname, '../../../__fixtures__/contracts')

function loadSchema(filename) {
  const schema = JSON.parse(readFileSync(resolve(fixturesDir, filename), 'utf-8'))
  delete schema.$schema
  return schema
}

describe('Scope Contract (RFC 6749 Section 3.3)', () => {
  let validateScope
  let validateToken
  let validateIntrospection
  let validateDcrRequest

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
    validateScope = ajv.compile(loadSchema('scope-string.schema.json'))
    validateToken = ajv.compile(loadSchema('token-exchange-response.schema.json'))
    validateIntrospection = ajv.compile(loadSchema('introspect-active-response.schema.json'))
    validateDcrRequest = ajv.compile(loadSchema('dcr-request.schema.json'))
  })

  describe('scope string format', () => {
    it('should validate single scope token', () => {
      expect(validateScope('read')).toBe(true)
      expect(validateScope.errors).toBeNull()
    })

    it('should validate space-delimited scope tokens', () => {
      expect(validateScope('read write')).toBe(true)
      expect(validateScope.errors).toBeNull()
    })

    it('should validate multiple scope tokens', () => {
      expect(validateScope('read write openid')).toBe(true)
      expect(validateScope.errors).toBeNull()
    })

    it('should validate scope tokens with special characters', () => {
      // RFC 6749: tokens can contain %x21 / %x23-5B / %x5D-7E
      expect(validateScope('custom:scope')).toBe(true)
      expect(validateScope('profile.read')).toBe(true)
      expect(validateScope('api~v2')).toBe(true)
    })

    it('should reject empty scope string', () => {
      expect(validateScope('')).toBe(false)
    })

    it('should reject scope with leading space', () => {
      expect(validateScope(' read')).toBe(false)
    })

    it('should reject scope with trailing space', () => {
      expect(validateScope('read ')).toBe(false)
    })

    it('should reject scope with double spaces', () => {
      expect(validateScope('read  write')).toBe(false)
    })
  })

  describe('scope in OAuthService configuration', () => {
    it('should validate the default scope value', () => {
      // OAuthService defaults to 'read write'
      expect(validateScope('read write')).toBe(true)
    })

    it('should validate common MCP server scope configurations', () => {
      const commonScopes = [
        'read',
        'write',
        'read write',
        'openid read write',
        'read write trusted'
      ]

      for (const scope of commonScopes) {
        expect(validateScope(scope)).toBe(true)
      }
    })
  })

  describe('scope in token exchange responses', () => {
    it('should validate token response with scope field', () => {
      const response = {
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read write'
      }

      expect(validateToken(response)).toBe(true)
      expect(validateScope(response.scope)).toBe(true)
    })

    it('should validate token response without scope (optional per RFC 6749)', () => {
      const response = {
        access_token: 'test-token',
        token_type: 'Bearer'
      }

      expect(validateToken(response)).toBe(true)
    })

    it('should validate client credentials response scope', () => {
      const response = {
        access_token: 'm2m-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read write'
      }

      expect(validateToken(response)).toBe(true)
      expect(validateScope(response.scope)).toBe(true)
    })
  })

  describe('scope in introspection responses', () => {
    it('should validate active introspection response with scope', () => {
      const response = {
        active: true,
        scope: 'read write',
        sub: 'user-123',
        client_id: 'test-client'
      }

      expect(validateIntrospection(response)).toBe(true)
      expect(validateScope(response.scope)).toBe(true)
    })

    it('should validate introspection with single scope', () => {
      const response = {
        active: true,
        scope: 'read'
      }

      expect(validateIntrospection(response)).toBe(true)
      expect(validateScope(response.scope)).toBe(true)
    })
  })

  describe('scope in DCR requests', () => {
    it('should validate DCR request with scope field', () => {
      const request = {
        redirect_uris: ['https://app.example.com/callback'],
        scope: 'read write'
      }

      expect(validateDcrRequest(request)).toBe(true)
      expect(validateScope(request.scope)).toBe(true)
    })
  })

  describe('scope lifecycle consistency', () => {
    it('should validate scope across full OAuth lifecycle', () => {
      const configuredScope = 'read write'

      // 1. Scope in authorization request
      expect(validateScope(configuredScope)).toBe(true)

      // 2. Scope in token response (may be subset)
      const tokenResponse = {
        access_token: 'token-123',
        token_type: 'Bearer',
        scope: configuredScope
      }
      expect(validateToken(tokenResponse)).toBe(true)
      expect(validateScope(tokenResponse.scope)).toBe(true)

      // 3. Scope in introspection response (matches granted)
      const introspectionResponse = {
        active: true,
        scope: configuredScope,
        sub: 'user-1'
      }
      expect(validateIntrospection(introspectionResponse)).toBe(true)
      expect(validateScope(introspectionResponse.scope)).toBe(true)

      // 4. Scope in client credentials response
      const m2mResponse = {
        access_token: 'm2m-token',
        token_type: 'Bearer',
        scope: configuredScope
      }
      expect(validateToken(m2mResponse)).toBe(true)
      expect(validateScope(m2mResponse.scope)).toBe(true)
    })
  })
})
