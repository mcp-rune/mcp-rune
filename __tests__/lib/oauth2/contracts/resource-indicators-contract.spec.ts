/**
 * Resource Indicators Contract Tests
 *
 * Validates that authorization request parameters constructed by OAuthService
 * conform to the combined contract of RFC 6749, RFC 7636 (PKCE), and
 * RFC 8707 (Resource Indicators). Ensures the MCP server constructs
 * valid authorization requests for Identity.
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

describe('Authorization Request Parameters Contract (RFC 6749 + RFC 7636 + RFC 8707)', () => {
  let validate

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
    validate = ajv.compile(loadSchema('authorization-request-params.schema.json'))
  })

  it('should validate a complete authorization request with resource indicator', () => {
    const params = {
      redirect_uri: 'https://mcp.example.com/oauth/callback',
      scope: 'read write',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      state: 'xyzABC123',
      resource: 'https://mcp.example.com/mcp'
    }

    const valid = validate(params)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it('should validate authorization request without resource indicator', () => {
    const params = {
      redirect_uri: 'http://localhost:3456/callback',
      scope: 'read write',
      code_challenge: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      code_challenge_method: 'S256',
      state: 'abc123'
    }

    const valid = validate(params)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it('should reject request missing required code_challenge (PKCE)', () => {
    const params = {
      redirect_uri: 'http://localhost:3456/callback',
      scope: 'read write',
      code_challenge_method: 'S256',
      state: 'abc123'
    }

    const valid = validate(params)
    expect(valid).toBe(false)
    expect(validate.errors).toContainEqual(
      expect.objectContaining({
        params: expect.objectContaining({ missingProperty: 'code_challenge' })
      })
    )
  })

  it('should reject request missing required state', () => {
    const params = {
      redirect_uri: 'http://localhost:3456/callback',
      scope: 'read write',
      code_challenge: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      code_challenge_method: 'S256'
    }

    const valid = validate(params)
    expect(valid).toBe(false)
    expect(validate.errors).toContainEqual(
      expect.objectContaining({
        params: expect.objectContaining({ missingProperty: 'state' })
      })
    )
  })

  it('should reject request with wrong code_challenge_method', () => {
    const params = {
      redirect_uri: 'http://localhost:3456/callback',
      scope: 'read write',
      code_challenge: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      code_challenge_method: 'plain',
      state: 'abc123'
    }

    const valid = validate(params)
    expect(valid).toBe(false)
  })

  it('should reject request with invalid code_challenge format', () => {
    const params = {
      redirect_uri: 'http://localhost:3456/callback',
      scope: 'read write',
      code_challenge: 'too-short',
      code_challenge_method: 'S256',
      state: 'abc123'
    }

    const valid = validate(params)
    expect(valid).toBe(false)
  })

  it('should reject request with empty scope', () => {
    const params = {
      redirect_uri: 'http://localhost:3456/callback',
      scope: '',
      code_challenge: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      code_challenge_method: 'S256',
      state: 'abc123'
    }

    const valid = validate(params)
    expect(valid).toBe(false)
  })

  it('should reject unknown additional properties (strict contract)', () => {
    const params = {
      redirect_uri: 'http://localhost:3456/callback',
      scope: 'read write',
      code_challenge: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      code_challenge_method: 'S256',
      state: 'abc123',
      unknown_param: 'should-fail'
    }

    const valid = validate(params)
    expect(valid).toBe(false)
  })

  it('should validate request matching actual OAuthService output', () => {
    // Matches the shape produced by OAuthService.buildAuthorizationUrl()
    const params = {
      redirect_uri: 'https://dsaenz.dev/engineer-mcp/oauth/callback',
      scope: 'read write',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      state: 'Kz~C4Wd-V.wHf~MbyRsL9ZrAk.1E06b1',
      resource: 'https://dsaenz.dev/engineer-mcp'
    }

    const valid = validate(params)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })
})
