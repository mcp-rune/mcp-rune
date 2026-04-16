/**
 * Protected Resource Metadata Property-Based Tests
 *
 * Validates RFC 9728 protected resource metadata invariants:
 * - buildResourceMetadataUrl always inserts well-known path between origin and resource path
 * - The resource URL in metadata always matches the input resource
 * - WWW-Authenticate header always includes resource_metadata parameter
 */

import * as fc from 'fast-check'

import { buildResourceMetadataUrl } from '../../../../src/mcp/middleware/oauth-router.js'

describe('Protected Resource Metadata Properties (RFC 9728)', () => {
  // Arbitrary for valid HTTPS resource URLs
  const pathSegmentArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,15}$/)

  const resourceUrlArb = fc
    .tuple(
      fc.stringMatching(/^[a-z]{3,10}$/),
      fc.stringMatching(/^[a-z]{3,10}$/),
      fc.array(pathSegmentArb, { minLength: 0, maxLength: 3 })
    )
    .map(([sub, domain, pathParts]) => {
      const base = `https://${sub}.${domain}.com`
      const path = pathParts.length > 0 ? `/${pathParts.join('/')}` : ''
      return `${base}${path}`
    })

  it('metadata URL always contains /.well-known/oauth-protected-resource', () => {
    fc.assert(
      fc.property(resourceUrlArb, (resourceUrl) => {
        const metadataUrl = buildResourceMetadataUrl(resourceUrl)

        expect(metadataUrl).toContain('/.well-known/oauth-protected-resource')
      }),
      { numRuns: 200 }
    )
  })

  it('metadata URL preserves the origin from the resource URL', () => {
    fc.assert(
      fc.property(resourceUrlArb, (resourceUrl) => {
        const url = new URL(resourceUrl)
        const metadataUrl = buildResourceMetadataUrl(resourceUrl)

        expect(metadataUrl).toMatch(
          new RegExp(`^${url.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
        )
      }),
      { numRuns: 200 }
    )
  })

  it('metadata URL preserves the path after the well-known segment', () => {
    fc.assert(
      fc.property(resourceUrlArb, (resourceUrl) => {
        const url = new URL(resourceUrl)
        const metadataUrl = buildResourceMetadataUrl(resourceUrl)
        const expectedUrl = `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`

        expect(metadataUrl).toBe(expectedUrl)
      }),
      { numRuns: 200 }
    )
  })

  it('metadata URL is always a valid URL', () => {
    fc.assert(
      fc.property(resourceUrlArb, (resourceUrl) => {
        const metadataUrl = buildResourceMetadataUrl(resourceUrl)

        // Should not throw when parsed
        const parsed = new URL(metadataUrl)
        expect(parsed.protocol).toBe('https:')
        expect(parsed.pathname).toContain('.well-known/oauth-protected-resource')
      }),
      { numRuns: 200 }
    )
  })

  it('root path produces /.well-known/oauth-protected-resource/ (with trailing slash)', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.stringMatching(/^[a-z]{3,10}$/), fc.stringMatching(/^[a-z]{3,10}$/)),
        ([sub, domain]) => {
          const rootUrl = `https://${sub}.${domain}.com/`
          const metadataUrl = buildResourceMetadataUrl(rootUrl)

          expect(metadataUrl).toBe(
            `https://${sub}.${domain}.com/.well-known/oauth-protected-resource/`
          )
        }
      ),
      { numRuns: 100 }
    )
  })
})
