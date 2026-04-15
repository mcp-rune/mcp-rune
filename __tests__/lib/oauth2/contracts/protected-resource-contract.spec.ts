/**
 * Protected Resource Metadata Contract Tests
 *
 * Validates that protected resource metadata responses conform to the
 * JSON Schema contract (RFC 9728). Ensures the MCP server's oauth-router
 * returns a valid protected resource metadata document.
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

describe('Protected Resource Metadata Contract (RFC 9728)', () => {
  let validate

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
    validate = ajv.compile(loadSchema('protected-resource-metadata-response.schema.json'))
  })

  it('should validate a complete protected resource metadata response', () => {
    const response = {
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: ['https://identity.example.com'],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://docs.example.com/mcp'
    }

    const valid = validate(response)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it('should validate a minimal protected resource metadata response', () => {
    const response = {
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: ['https://identity.example.com']
    }

    const valid = validate(response)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it('should validate response with multiple authorization servers', () => {
    const response = {
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: ['https://identity.example.com', 'https://backup-identity.example.com']
    }

    const valid = validate(response)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it('should reject response missing required resource field', () => {
    const response = {
      authorization_servers: ['https://identity.example.com']
    }

    const valid = validate(response)
    expect(valid).toBe(false)
    expect(validate.errors).toContainEqual(
      expect.objectContaining({
        params: expect.objectContaining({ missingProperty: 'resource' })
      })
    )
  })

  it('should reject response missing required authorization_servers field', () => {
    const response = {
      resource: 'https://mcp.example.com/mcp'
    }

    const valid = validate(response)
    expect(valid).toBe(false)
    expect(validate.errors).toContainEqual(
      expect.objectContaining({
        params: expect.objectContaining({ missingProperty: 'authorization_servers' })
      })
    )
  })

  it('should reject response with empty authorization_servers array', () => {
    const response = {
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: []
    }

    const valid = validate(response)
    expect(valid).toBe(false)
  })

  it('should allow additional properties (forward-compatible)', () => {
    const response = {
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: ['https://identity.example.com'],
      custom_extension: 'custom-value'
    }

    const valid = validate(response)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it('should validate response matching actual oauth-router output', () => {
    // Matches the shape produced by oauth-router.js GET /.well-known/oauth-protected-resource
    const response = {
      resource: 'https://dsaenz.dev/engineer-mcp/mcp',
      authorization_servers: ['https://dsaenz.dev']
    }

    const valid = validate(response)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })
})
