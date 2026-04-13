/**
 * Implementation Interchangeability Contract Tests
 *
 * Validates that both OAuth2 implementations (production OAuthService
 * and reference OAuth2ReferenceService) conform to the shared interface
 * contract schema. This ensures any implementation can be swapped in
 * without breaking the MCP server.
 */

import { describe, it, expect, beforeAll } from 'vitest'
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

const mockConfig = {
  identityUrl: 'http://localhost:4000',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:3456/callback',
  scopes: 'read write'
}

const requiredMethods = [
  'getValidAccessToken',
  'startLocalAuthFlow',
  'getAuthorizationUrlForRemote',
  'handleRemoteCallback',
  'getUserInfo',
  'refreshAccessToken'
]

describe('OAuthService Interface Contract', () => {
  let validate

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    validate = ajv.compile(loadSchema('oauth-service-interface.schema.json'))
  })

  describe('production implementation (OAuthService)', () => {
    let service

    beforeAll(async () => {
      const module = await import('../../../../lib/oauth2/service.js')
      service = new module.OAuthService(mockConfig)
    })

    it('should conform to interface schema for required properties', () => {
      const props = {
        identityUrl: service.identityUrl,
        clientId: service.clientId,
        clientSecret: service.clientSecret,
        redirectUri: service.redirectUri,
        scopes: service.scopes,
        resourceUri: service.resourceUri
      }

      const valid = validate(props)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should expose all required methods', () => {
      for (const method of requiredMethods) {
        expect(typeof service[method]).toBe('function')
      }
    })

    it('should conform to interface schema with resourceUri configured', async () => {
      const mod = await import('../../../../lib/oauth2/service.js')
      const serviceWithResource = new mod.OAuthService({
        ...mockConfig,
        resourceUri: 'https://mcp.example.com'
      })

      const props = {
        identityUrl: serviceWithResource.identityUrl,
        clientId: serviceWithResource.clientId,
        clientSecret: serviceWithResource.clientSecret,
        redirectUri: serviceWithResource.redirectUri,
        scopes: serviceWithResource.scopes,
        resourceUri: serviceWithResource.resourceUri
      }

      const valid = validate(props)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })
  })

  describe('reference implementation (OAuth2ReferenceService)', () => {
    let service

    beforeAll(async () => {
      const module = await import('#lib/oauth2-ref/index.js')
      service = new module.OAuth2ReferenceService(mockConfig)
    })

    it('should conform to interface schema for required properties', () => {
      const props = {
        identityUrl: service.identityUrl,
        clientId: service.clientId,
        clientSecret: service.clientSecret,
        redirectUri: service.redirectUri,
        scopes: service.scopes,
        resourceUri: service.resourceUri
      }

      const valid = validate(props)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should expose all required methods', () => {
      for (const method of requiredMethods) {
        expect(typeof service[method]).toBe('function')
      }
    })

    it('should conform to interface schema with resourceUri configured', async () => {
      const mod = await import('#lib/oauth2-ref/index.js')
      const serviceWithResource = new mod.OAuth2ReferenceService({
        ...mockConfig,
        resourceUri: 'https://mcp.example.com'
      })

      const props = {
        identityUrl: serviceWithResource.identityUrl,
        clientId: serviceWithResource.clientId,
        clientSecret: serviceWithResource.clientSecret,
        redirectUri: serviceWithResource.redirectUri,
        scopes: serviceWithResource.scopes,
        resourceUri: serviceWithResource.resourceUri
      }

      const valid = validate(props)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })
  })

  describe('cross-implementation compatibility', () => {
    it('both implementations produce schema-valid instances with same config', async () => {
      const prodModule = await import('../../../../lib/oauth2/service.js')
      const refModule = await import('#lib/oauth2-ref/index.js')

      const prodService = new prodModule.OAuthService(mockConfig)
      const refService = new refModule.OAuth2ReferenceService(mockConfig)

      const prodProps = {
        identityUrl: prodService.identityUrl,
        clientId: prodService.clientId,
        clientSecret: prodService.clientSecret,
        redirectUri: prodService.redirectUri,
        scopes: prodService.scopes,
        resourceUri: prodService.resourceUri
      }

      const refProps = {
        identityUrl: refService.identityUrl,
        clientId: refService.clientId,
        clientSecret: refService.clientSecret,
        redirectUri: refService.redirectUri,
        scopes: refService.scopes,
        resourceUri: refService.resourceUri
      }

      expect(validate(prodProps)).toBe(true)
      expect(validate(refProps)).toBe(true)

      // Both should have identical property values for same config
      expect(prodProps.identityUrl).toBe(refProps.identityUrl)
      expect(prodProps.clientId).toBe(refProps.clientId)
      expect(prodProps.scopes).toBe(refProps.scopes)
    })

    it('both implementations expose the same method set', async () => {
      const prodModule = await import('../../../../lib/oauth2/service.js')
      const refModule = await import('#lib/oauth2-ref/index.js')

      const prodService = new prodModule.OAuthService(mockConfig)
      const refService = new refModule.OAuth2ReferenceService(mockConfig)

      for (const method of requiredMethods) {
        expect(typeof prodService[method]).toBe('function')
        expect(typeof refService[method]).toBe('function')
        expect(prodService[method].length).toBe(refService[method].length)
      }
    })
  })
})
