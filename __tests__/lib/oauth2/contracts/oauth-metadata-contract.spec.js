/**
 * OAuth Metadata Contract Tests
 *
 * Validates that OAuth metadata responses from Identity conform to the
 * shared JSON Schema contract (RFC 8414). This ensures the MCP server's
 * oauth-router proxy can safely parse and rewrite Identity responses.
 */

import { describe, it, expect, beforeAll } from 'vitest'
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

describe('OAuth Metadata Contract (RFC 8414)', () => {
  let validate

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    validate = ajv.compile(loadSchema('oauth-metadata-response.schema.json'))
  })

  it('should validate a complete authorization server metadata response', () => {
    const metadata = {
      issuer: 'https://identity.example.com',
      authorization_endpoint: 'https://identity.example.com/oauth/authorize',
      token_endpoint: 'https://identity.example.com/oauth/token',
      response_types_supported: ['code'],
      registration_endpoint: 'https://identity.example.com/oauth/register',
      revocation_endpoint: 'https://identity.example.com/oauth/revoke',
      introspection_endpoint: 'https://identity.example.com/oauth/introspect',
      scopes_supported: ['read', 'write', 'openid'],
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256']
    }

    const valid = validate(metadata)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it('should validate a minimal authorization server metadata response', () => {
    const metadata = {
      issuer: 'https://identity.example.com',
      authorization_endpoint: 'https://identity.example.com/oauth/authorize',
      token_endpoint: 'https://identity.example.com/oauth/token',
      response_types_supported: ['code']
    }

    const valid = validate(metadata)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it('should reject metadata missing required issuer', () => {
    const metadata = {
      authorization_endpoint: 'https://identity.example.com/oauth/authorize',
      token_endpoint: 'https://identity.example.com/oauth/token',
      response_types_supported: ['code']
    }

    const valid = validate(metadata)
    expect(valid).toBe(false)
    expect(validate.errors).toContainEqual(
      expect.objectContaining({ params: expect.objectContaining({ missingProperty: 'issuer' }) })
    )
  })

  it('should reject metadata missing required token_endpoint', () => {
    const metadata = {
      issuer: 'https://identity.example.com',
      authorization_endpoint: 'https://identity.example.com/oauth/authorize',
      response_types_supported: ['code']
    }

    const valid = validate(metadata)
    expect(valid).toBe(false)
    expect(validate.errors).toContainEqual(
      expect.objectContaining({
        params: expect.objectContaining({ missingProperty: 'token_endpoint' })
      })
    )
  })

  it('should reject metadata with empty response_types_supported', () => {
    const metadata = {
      issuer: 'https://identity.example.com',
      authorization_endpoint: 'https://identity.example.com/oauth/authorize',
      token_endpoint: 'https://identity.example.com/oauth/token',
      response_types_supported: []
    }

    const valid = validate(metadata)
    expect(valid).toBe(false)
  })

  it('should allow additional properties (forward-compatible)', () => {
    const metadata = {
      issuer: 'https://identity.example.com',
      authorization_endpoint: 'https://identity.example.com/oauth/authorize',
      token_endpoint: 'https://identity.example.com/oauth/token',
      response_types_supported: ['code'],
      custom_extension: 'custom-value'
    }

    const valid = validate(metadata)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it('should validate metadata after MCP server URL rewriting', () => {
    // Simulates what oauth-router does: rewrite endpoints to point to MCP
    const metadata = {
      issuer: 'https://identity.example.com',
      authorization_endpoint: 'https://mcp.example.com/oauth/authorize',
      token_endpoint: 'https://mcp.example.com/oauth/token',
      registration_endpoint: 'https://mcp.example.com/oauth/register',
      response_types_supported: ['code'],
      revocation_endpoint: 'https://identity.example.com/oauth/revoke',
      introspection_endpoint: 'https://identity.example.com/oauth/introspect'
    }

    const valid = validate(metadata)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })
})
