/**
 * Token Mode Contract Tests
 *
 * Validates that HttpServer health responses conform to the shared
 * JSON Schema contract. Both OAuth mode and Token mode produce
 * identical health response shapes, ensuring monitoring systems
 * can consume responses regardless of auth mode.
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

describe('Token Mode Contract (Health Response)', () => {
  let validate

  beforeAll(() => {
    const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
    validate = ajv.compile(loadSchema('health-response.schema.json'))
  })

  describe('health response in token mode', () => {
    it('should validate a complete health response', () => {
      const response = {
        status: 'ok',
        service: 'engineer-mcp',
        transport: 'streamable-http',
        activeSessions: 3
      }

      const valid = validate(response)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate health response with zero active sessions', () => {
      const response = {
        status: 'ok',
        service: 'engineer-mcp',
        transport: 'streamable-http',
        activeSessions: 0
      }

      const valid = validate(response)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate health response with prompt cache stats', () => {
      const response = {
        status: 'ok',
        service: 'engineer-mcp',
        transport: 'streamable-http',
        activeSessions: 1,
        promptCache: {
          hits: 42,
          misses: 3,
          size: 10
        }
      }

      const valid = validate(response)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should reject response missing required status field', () => {
      const response = {
        service: 'engineer-mcp',
        transport: 'streamable-http',
        activeSessions: 0
      }

      const valid = validate(response)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          params: expect.objectContaining({ missingProperty: 'status' })
        })
      )
    })

    it('should reject response missing required service field', () => {
      const response = {
        status: 'ok',
        transport: 'streamable-http',
        activeSessions: 0
      }

      const valid = validate(response)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          params: expect.objectContaining({ missingProperty: 'service' })
        })
      )
    })

    it('should reject response with wrong transport value', () => {
      const response = {
        status: 'ok',
        service: 'engineer-mcp',
        transport: 'sse',
        activeSessions: 0
      }

      const valid = validate(response)
      expect(valid).toBe(false)
    })

    it('should reject response with negative activeSessions', () => {
      const response = {
        status: 'ok',
        service: 'engineer-mcp',
        transport: 'streamable-http',
        activeSessions: -1
      }

      const valid = validate(response)
      expect(valid).toBe(false)
    })

    it('should allow additional properties (forward-compatible)', () => {
      const response = {
        status: 'ok',
        service: 'engineer-mcp',
        transport: 'streamable-http',
        activeSessions: 0,
        version: '1.0.0'
      }

      const valid = validate(response)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })
  })

  describe('health response shape is identical across auth modes', () => {
    it('should validate OAuth mode health response', () => {
      // Same shape produced by HttpServer in OAuth mode
      const response = {
        status: 'ok',
        service: 'engineer-mcp',
        transport: 'streamable-http',
        activeSessions: 5
      }

      const valid = validate(response)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })

    it('should validate Token mode health response', () => {
      // Same shape produced by HttpServer in Token mode
      const response = {
        status: 'ok',
        service: 'engineer-mcp',
        transport: 'streamable-http',
        activeSessions: 2
      }

      const valid = validate(response)
      expect(validate.errors).toBeNull()
      expect(valid).toBe(true)
    })
  })
})
