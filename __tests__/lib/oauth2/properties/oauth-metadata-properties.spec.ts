/**
 * OAuth Metadata Property-Based Tests
 *
 * Validates OAuth metadata rewriting invariants:
 * - Rewritten metadata always preserves issuer (never rewritten)
 * - authorization_endpoint, token_endpoint, registration_endpoint always point to MCP server
 * - revocation_endpoint and introspection_endpoint always point to Identity server
 * - Rewritten metadata still conforms to RFC 8414 required fields
 */

import * as fc from 'fast-check'

/**
 * Simulates the metadata rewriting logic from oauth-router.js
 *
 * Input:  Identity's raw metadata
 * Output: Rewritten metadata with MCP server endpoints
 */
function rewriteMetadata(identityMetadata, mcpBaseUrl, identityUrl) {
  const metadata = { ...identityMetadata }
  const mcpOAuthBase = `${mcpBaseUrl}/oauth`

  metadata.authorization_endpoint = `${mcpOAuthBase}/authorize`
  metadata.token_endpoint = `${mcpOAuthBase}/token`
  metadata.registration_endpoint = `${mcpOAuthBase}/register`

  if (metadata.revocation_endpoint) {
    metadata.revocation_endpoint = `${identityUrl}/oauth/revoke`
  }
  if (metadata.introspection_endpoint) {
    metadata.introspection_endpoint = `${identityUrl}/oauth/introspect`
  }

  return metadata
}

describe('OAuth Metadata Rewriting Properties (RFC 8414)', () => {
  // Arbitrary for HTTPS URLs
  const httpsOriginArb = fc
    .tuple(fc.stringMatching(/^[a-z]{3,10}$/), fc.stringMatching(/^[a-z]{3,10}$/))
    .map(([sub, domain]) => `https://${sub}.${domain}.com`)

  // Arbitrary for Identity metadata (minimal valid RFC 8414)
  const identityMetadataArb = httpsOriginArb.chain((identityOrigin) =>
    fc.record({
      issuer: fc.constant(identityOrigin),
      authorization_endpoint: fc.constant(`${identityOrigin}/oauth/authorize`),
      token_endpoint: fc.constant(`${identityOrigin}/oauth/token`),
      response_types_supported: fc.constant(['code']),
      registration_endpoint: fc.constant(`${identityOrigin}/oauth/register`),
      revocation_endpoint: fc.constant(`${identityOrigin}/oauth/revoke`),
      introspection_endpoint: fc.constant(`${identityOrigin}/oauth/introspect`),
      scopes_supported: fc.constantFrom(['read', 'write'], ['read', 'write', 'openid'], ['read']),
      grant_types_supported: fc.constantFrom(
        ['authorization_code', 'refresh_token'],
        ['authorization_code', 'client_credentials', 'refresh_token']
      ),
      code_challenge_methods_supported: fc.constant(['S256'])
    })
  )

  it('issuer is never rewritten (always points to Identity)', () => {
    fc.assert(
      fc.property(identityMetadataArb, httpsOriginArb, (identityMetadata, mcpBaseUrl) => {
        const rewritten = rewriteMetadata(identityMetadata, mcpBaseUrl, identityMetadata.issuer)

        expect(rewritten.issuer).toBe(identityMetadata.issuer)
      }),
      { numRuns: 100 }
    )
  })

  it('authorization_endpoint always points to MCP server after rewriting', () => {
    fc.assert(
      fc.property(identityMetadataArb, httpsOriginArb, (identityMetadata, mcpBaseUrl) => {
        const rewritten = rewriteMetadata(identityMetadata, mcpBaseUrl, identityMetadata.issuer)

        expect(rewritten.authorization_endpoint).toBe(`${mcpBaseUrl}/oauth/authorize`)
        expect(rewritten.authorization_endpoint).not.toContain(identityMetadata.issuer)
      }),
      { numRuns: 100 }
    )
  })

  it('token_endpoint always points to MCP server after rewriting', () => {
    fc.assert(
      fc.property(identityMetadataArb, httpsOriginArb, (identityMetadata, mcpBaseUrl) => {
        const rewritten = rewriteMetadata(identityMetadata, mcpBaseUrl, identityMetadata.issuer)

        expect(rewritten.token_endpoint).toBe(`${mcpBaseUrl}/oauth/token`)
      }),
      { numRuns: 100 }
    )
  })

  it('registration_endpoint always points to MCP server after rewriting', () => {
    fc.assert(
      fc.property(identityMetadataArb, httpsOriginArb, (identityMetadata, mcpBaseUrl) => {
        const rewritten = rewriteMetadata(identityMetadata, mcpBaseUrl, identityMetadata.issuer)

        expect(rewritten.registration_endpoint).toBe(`${mcpBaseUrl}/oauth/register`)
      }),
      { numRuns: 100 }
    )
  })

  it('revocation_endpoint always points to Identity server (never rewritten to MCP)', () => {
    fc.assert(
      fc.property(identityMetadataArb, httpsOriginArb, (identityMetadata, mcpBaseUrl) => {
        const rewritten = rewriteMetadata(identityMetadata, mcpBaseUrl, identityMetadata.issuer)

        expect(rewritten.revocation_endpoint).toBe(`${identityMetadata.issuer}/oauth/revoke`)
        expect(rewritten.revocation_endpoint).not.toContain(mcpBaseUrl)
      }),
      { numRuns: 100 }
    )
  })

  it('introspection_endpoint always points to Identity server (never rewritten to MCP)', () => {
    fc.assert(
      fc.property(identityMetadataArb, httpsOriginArb, (identityMetadata, mcpBaseUrl) => {
        const rewritten = rewriteMetadata(identityMetadata, mcpBaseUrl, identityMetadata.issuer)

        expect(rewritten.introspection_endpoint).toBe(`${identityMetadata.issuer}/oauth/introspect`)
        expect(rewritten.introspection_endpoint).not.toContain(mcpBaseUrl)
      }),
      { numRuns: 100 }
    )
  })

  it('required RFC 8414 fields are always preserved after rewriting', () => {
    fc.assert(
      fc.property(identityMetadataArb, httpsOriginArb, (identityMetadata, mcpBaseUrl) => {
        const rewritten = rewriteMetadata(identityMetadata, mcpBaseUrl, identityMetadata.issuer)

        // RFC 8414 required fields
        expect(rewritten.issuer).toBeDefined()
        expect(rewritten.authorization_endpoint).toBeDefined()
        expect(rewritten.token_endpoint).toBeDefined()
        expect(rewritten.response_types_supported).toBeDefined()
        expect(rewritten.response_types_supported.length).toBeGreaterThan(0)
      }),
      { numRuns: 100 }
    )
  })

  it('optional metadata fields are preserved unchanged after rewriting', () => {
    fc.assert(
      fc.property(identityMetadataArb, httpsOriginArb, (identityMetadata, mcpBaseUrl) => {
        const rewritten = rewriteMetadata(identityMetadata, mcpBaseUrl, identityMetadata.issuer)

        // These fields should pass through unchanged
        expect(rewritten.scopes_supported).toEqual(identityMetadata.scopes_supported)
        expect(rewritten.grant_types_supported).toEqual(identityMetadata.grant_types_supported)
        expect(rewritten.code_challenge_methods_supported).toEqual(
          identityMetadata.code_challenge_methods_supported
        )
      }),
      { numRuns: 100 }
    )
  })
})
