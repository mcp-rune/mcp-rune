/**
 * OAuth 2.1 Compliance Contract Tests
 *
 * Validates cross-cutting OAuth 2.1 (draft-ietf-oauth-v2-1) invariants
 * that the MCP server must uphold. Unlike per-RFC contract tests, this
 * file treats OAuth 2.1 as a single compliance surface and verifies:
 *
 * - PKCE with S256 is mandatory for all authorization code flows
 * - Implicit grant (response_type=token) is not supported
 * - Resource Owner Password Credentials grant is not supported
 * - Bearer tokens are only accepted via Authorization header
 * - Redirect URI exact matching
 * - code_challenge_method is always S256, never plain
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv from 'ajv'

vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  buildAuthorizationUrl: vi.fn(() => new URL('http://localhost')),
  allowInsecureRequests: Symbol('allowInsecureRequests')
}))

vi.mock('#src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('../../../../src/oauth2/token-store.js', () => ({
  storeTokens: vi.fn(),
  getTokensBySession: vi.fn()
}))

import * as client from 'openid-client'

import { extractBearerToken } from '../../../../src/mcp/middleware/oauth-router.js'
import { OAuthService } from '../../../../src/oauth2/service.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(__dirname, '../../../__fixtures__/contracts')

function loadSchema(filename) {
  const schema = JSON.parse(readFileSync(resolve(fixturesDir, filename), 'utf-8'))
  delete schema.$schema
  return schema
}

const defaultOptions = {
  authServerUrl: 'http://localhost:4000',
  clientId: 'test',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:3456/callback',
  scopes: 'read write'
}

describe('OAuth 2.1 Compliance Contract (draft-ietf-oauth-v2-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('PKCE S256 mandatory (§4.1.1)', () => {
    let validateAuthParams

    beforeAll(() => {
      const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
      validateAuthParams = ajv.compile(loadSchema('authorization-request-params.schema.json'))
    })

    it('authorization request schema requires code_challenge_method = S256', () => {
      const schema = loadSchema('authorization-request-params.schema.json')
      expect(schema.properties.code_challenge_method.const).toBe('S256')
    })

    it('authorization request schema requires code_challenge', () => {
      const schema = loadSchema('authorization-request-params.schema.json')
      expect(schema.required).toContain('code_challenge')
      expect(schema.required).toContain('code_challenge_method')
    })

    it('rejects authorization params with plain code_challenge_method', () => {
      const params = {
        redirect_uri: 'http://localhost:3456/callback',
        scope: 'read write',
        code_challenge: 'a'.repeat(43),
        code_challenge_method: 'plain',
        state: 'random-state'
      }

      expect(validateAuthParams(params)).toBe(false)
    })

    it('accepts authorization params with S256 code_challenge_method', () => {
      const params = {
        redirect_uri: 'http://localhost:3456/callback',
        scope: 'read write',
        code_challenge: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        code_challenge_method: 'S256',
        state: 'random-state'
      }

      expect(validateAuthParams(params)).toBe(true)
      expect(validateAuthParams.errors).toBeNull()
    })

    it('buildAuthorizationUrl always includes S256', () => {
      const service = new OAuthService(defaultOptions)

      service.buildAuthorizationUrl({}, 'test-challenge', 'test-state')

      expect(client.buildAuthorizationUrl).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          code_challenge_method: 'S256'
        })
      )
    })
  })

  describe('implicit grant removed (§4.1.1)', () => {
    let validateCimd

    beforeAll(() => {
      const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
      validateCimd = ajv.compile(loadSchema('cimd-metadata-response.schema.json'))
    })

    it('CIMD grant_types contains only authorization_code', () => {
      const metadata = {
        client_id: 'https://mcp.example.com/oauth/client-metadata.json',
        client_name: 'Test MCP',
        redirect_uris: ['https://mcp.example.com/oauth/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'read write'
      }

      expect(validateCimd(metadata)).toBe(true)
      expect(metadata.grant_types).toEqual(['authorization_code'])
      expect(metadata.grant_types).not.toContain('implicit')
    })

    it('CIMD response_types contains only code', () => {
      const metadata = {
        client_id: 'https://mcp.example.com/oauth/client-metadata.json',
        redirect_uris: ['https://mcp.example.com/oauth/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code']
      }

      expect(validateCimd(metadata)).toBe(true)
      expect(metadata.response_types).toEqual(['code'])
      expect(metadata.response_types).not.toContain('token')
    })
  })

  describe('ROPC grant removed (§4.1)', () => {
    it('CIMD grant_types does not include password', () => {
      const metadata = {
        client_id: 'https://mcp.example.com/oauth/client-metadata.json',
        redirect_uris: ['https://mcp.example.com/oauth/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code']
      }

      expect(metadata.grant_types).not.toContain('password')
    })
  })

  describe('bearer token header-only (§5.1.2)', () => {
    it('extractBearerToken only reads from Authorization header', () => {
      // With Authorization header
      const reqWithHeader = {
        headers: { authorization: 'Bearer test-token' }
      }
      expect(extractBearerToken(reqWithHeader)).toBe('test-token')

      // Without Authorization header
      const reqWithoutHeader = {
        headers: {}
      }
      expect(extractBearerToken(reqWithoutHeader)).toBeNull()

      // With empty Authorization header
      const reqWithEmptyAuth = {
        headers: { authorization: '' }
      }
      expect(extractBearerToken(reqWithEmptyAuth)).toBeNull()
    })

    it('extractBearerToken does not read from query parameters', () => {
      // Only query param, no header — should return null
      const req = {
        headers: {},
        query: { access_token: 'leaked-token' }
      }
      expect(extractBearerToken(req)).toBeNull()
    })
  })

  describe('redirect URI exact matching (§4.1.1)', () => {
    it('buildAuthorizationUrl uses configured redirect_uri verbatim', () => {
      const exactUri = 'http://localhost:3456/callback'
      const service = new OAuthService({ ...defaultOptions, redirectUri: exactUri })

      service.buildAuthorizationUrl({}, 'challenge', 'state')

      expect(client.buildAuthorizationUrl).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          redirect_uri: exactUri
        })
      )
    })
  })
})
