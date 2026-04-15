/**
 * Token Introspection Contract Tests
 *
 * Validates that token introspection responses conform to the shared
 * JSON Schema contracts (RFC 7662). Also validates DCR request/response
 * contracts (RFC 7591). These contracts ensure compatibility between
 * the MCP server and Identity server.
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

describe('Token Introspection Contract (RFC 7662)', () => {
  let validateActive
  let validateInactive

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
    validateActive = ajv.compile(loadSchema('introspect-active-response.schema.json'))
    validateInactive = ajv.compile(loadSchema('introspect-inactive-response.schema.json'))
  })

  describe('active token response', () => {
    it('should validate a complete active introspection response', () => {
      const response = {
        active: true,
        scope: 'read write',
        client_id: 'test-client',
        token_type: 'Bearer',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        sub: 'user-123',
        username: 'testuser',
        name: 'Test User',
        admin: false,
        locale: 'en',
        aud: 'https://mcp.example.com'
      }

      const valid = validateActive(response)
      expect(validateActive.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate a minimal active introspection response', () => {
      const response = {
        active: true
      }

      const valid = validateActive(response)
      expect(validateActive.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should reject response with active: false for active schema', () => {
      const response = {
        active: false
      }

      const valid = validateActive(response)
      expect(valid).toBe(false)
    })

    it('should allow additional properties (forward-compatible)', () => {
      const response = {
        active: true,
        sub: 'user-123',
        custom_claim: 'custom-value'
      }

      const valid = validateActive(response)
      expect(validateActive.errors).toBeNull()
      expect(valid).toBe(true)
    })
  })

  describe('inactive token response', () => {
    it('should validate an inactive introspection response', () => {
      const response = {
        active: false
      }

      const valid = validateInactive(response)
      expect(validateInactive.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should reject response with active: true for inactive schema', () => {
      const response = {
        active: true
      }

      const valid = validateInactive(response)
      expect(valid).toBe(false)
    })

    it('should allow additional properties on inactive response', () => {
      const response = {
        active: false,
        extra_info: 'token expired'
      }

      const valid = validateInactive(response)
      expect(validateInactive.errors).toBeNull()
      expect(valid).toBe(true)
    })
  })
})

describe('Dynamic Client Registration Contract (RFC 7591)', () => {
  let validateRequest
  let validateResponse

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
    validateRequest = ajv.compile(loadSchema('dcr-request.schema.json'))
    validateResponse = ajv.compile(loadSchema('dcr-response.schema.json'))
  })

  describe('DCR request', () => {
    it('should validate a complete DCR request', () => {
      const request = {
        redirect_uris: ['https://app.example.com/callback'],
        client_name: 'My MCP Client',
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'read write'
      }

      const valid = validateRequest(request)
      expect(validateRequest.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate a minimal DCR request', () => {
      const request = {
        redirect_uris: ['https://app.example.com/callback']
      }

      const valid = validateRequest(request)
      expect(validateRequest.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should reject DCR request without redirect_uris', () => {
      const request = {
        client_name: 'My App'
      }

      const valid = validateRequest(request)
      expect(valid).toBe(false)
      expect(validateRequest.errors).toContainEqual(
        expect.objectContaining({
          params: expect.objectContaining({ missingProperty: 'redirect_uris' })
        })
      )
    })

    it('should reject DCR request with empty redirect_uris', () => {
      const request = {
        redirect_uris: []
      }

      const valid = validateRequest(request)
      expect(valid).toBe(false)
    })
  })

  describe('DCR response', () => {
    it('should validate a complete DCR response', () => {
      const response = {
        client_id: 'generated-client-id',
        client_secret: 'generated-client-secret',
        redirect_uris: ['https://app.example.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'client_secret_basic',
        client_id_issued_at: Math.floor(Date.now() / 1000)
      }

      const valid = validateResponse(response)
      expect(validateResponse.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate a minimal DCR response', () => {
      const response = {
        client_id: 'generated-client-id'
      }

      const valid = validateResponse(response)
      expect(validateResponse.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should reject DCR response without client_id', () => {
      const response = {
        client_secret: 'some-secret'
      }

      const valid = validateResponse(response)
      expect(valid).toBe(false)
      expect(validateResponse.errors).toContainEqual(
        expect.objectContaining({
          params: expect.objectContaining({ missingProperty: 'client_id' })
        })
      )
    })
  })
})
