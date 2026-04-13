import { loadConfig } from '#src/core/config.js'

describe('lib/core/config', () => {
  const savedEnv = {}

  function setEnv(key, value) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }

  function clearEnv(key) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  describe('loadConfig()', () => {
    it('should resolve string types from env vars', () => {
      setEnv('TEST_CFG_NAME', 'my-server')
      const config = loadConfig({
        name: { env: 'TEST_CFG_NAME' }
      })
      expect(config.name).toBe('my-server')
    })

    it('should resolve integer types', () => {
      setEnv('TEST_CFG_PORT', '4200')
      const config = loadConfig({
        port: { env: 'TEST_CFG_PORT', type: 'integer' }
      })
      expect(config.port).toBe(4200)
    })

    it('should resolve boolean types', () => {
      setEnv('TEST_CFG_ENABLED', 'true')
      const config = loadConfig({
        enabled: { env: 'TEST_CFG_ENABLED', type: 'boolean' }
      })
      expect(config.enabled).toBe(true)
    })

    it('should resolve boolean "1" as true', () => {
      setEnv('TEST_CFG_ENABLED', '1')
      const config = loadConfig({
        enabled: { env: 'TEST_CFG_ENABLED', type: 'boolean' }
      })
      expect(config.enabled).toBe(true)
    })

    it('should resolve boolean "false" as false', () => {
      setEnv('TEST_CFG_ENABLED', 'false')
      const config = loadConfig({
        enabled: { env: 'TEST_CFG_ENABLED', type: 'boolean' }
      })
      expect(config.enabled).toBe(false)
    })

    it('should apply defaults when env var is absent', () => {
      clearEnv('TEST_CFG_MISSING')
      const config = loadConfig({
        name: { env: 'TEST_CFG_MISSING', default: 'fallback' }
      })
      expect(config.name).toBe('fallback')
    })

    it('should apply defaults when env var is empty string', () => {
      setEnv('TEST_CFG_EMPTY', '')
      const config = loadConfig({
        name: { env: 'TEST_CFG_EMPTY', default: 'fallback' }
      })
      expect(config.name).toBe('fallback')
    })

    it('should return undefined for optional fields without defaults', () => {
      clearEnv('TEST_CFG_OPTIONAL')
      const config = loadConfig({
        value: { env: 'TEST_CFG_OPTIONAL' }
      })
      expect(config.value).toBeUndefined()
    })

    it('should handle nested schemas', () => {
      setEnv('TEST_CFG_DB_HOST', 'localhost')
      setEnv('TEST_CFG_DB_PORT', '5432')
      const config = loadConfig({
        database: {
          host: { env: 'TEST_CFG_DB_HOST' },
          port: { env: 'TEST_CFG_DB_PORT', type: 'integer' }
        }
      })
      expect(config.database.host).toBe('localhost')
      expect(config.database.port).toBe(5432)
    })

    it('should handle deeply nested schemas', () => {
      setEnv('TEST_CFG_DEEP', 'deep-value')
      const config = loadConfig({
        level1: {
          level2: {
            level3: { env: 'TEST_CFG_DEEP' }
          }
        }
      })
      expect(config.level1.level2.level3).toBe('deep-value')
    })
  })

  describe('required validation', () => {
    it('should throw with aggregated errors for missing required vars', () => {
      clearEnv('TEST_CFG_REQ_A')
      clearEnv('TEST_CFG_REQ_B')
      expect(() =>
        loadConfig({
          a: { env: 'TEST_CFG_REQ_A', required: true },
          b: { env: 'TEST_CFG_REQ_B', required: true }
        })
      ).toThrow(/Configuration errors \(2\)/)
    })

    it('should include all missing vars in the error message', () => {
      clearEnv('TEST_CFG_REQ_A')
      clearEnv('TEST_CFG_REQ_B')
      try {
        loadConfig({
          a: { env: 'TEST_CFG_REQ_A', required: true, doc: 'Field A' },
          b: { env: 'TEST_CFG_REQ_B', required: true }
        })
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e.message).toContain('TEST_CFG_REQ_A')
        expect(e.message).toContain('TEST_CFG_REQ_B')
        expect(e.message).toContain('Field A')
      }
    })

    it('should not throw for required vars that have values', () => {
      setEnv('TEST_CFG_REQ_OK', 'present')
      const config = loadConfig({
        a: { env: 'TEST_CFG_REQ_OK', required: true }
      })
      expect(config.a).toBe('present')
    })
  })

  describe('format/enum validation', () => {
    it('should accept valid enum values', () => {
      setEnv('TEST_CFG_TIER', 'advanced')
      const config = loadConfig({
        tier: { env: 'TEST_CFG_TIER', format: ['essential', 'advanced', 'complete'] }
      })
      expect(config.tier).toBe('advanced')
    })

    it('should throw on invalid enum value', () => {
      setEnv('TEST_CFG_TIER', 'bogus')
      expect(() =>
        loadConfig({
          tier: { env: 'TEST_CFG_TIER', format: ['essential', 'advanced', 'complete'] }
        })
      ).toThrow(/must be one of/)
    })

    it('should throw on invalid integer', () => {
      setEnv('TEST_CFG_INT', 'not-a-number')
      expect(() =>
        loadConfig({
          port: { env: 'TEST_CFG_INT', type: 'integer' }
        })
      ).toThrow(/must be an integer/)
    })
  })

  describe('frozen output', () => {
    it('should return a deeply frozen object', () => {
      setEnv('TEST_CFG_FREEZE', 'value')
      const config = loadConfig({
        nested: {
          field: { env: 'TEST_CFG_FREEZE' }
        }
      })
      expect(Object.isFrozen(config)).toBe(true)
      expect(Object.isFrozen(config.nested)).toBe(true)
    })

    it('should throw when trying to modify frozen config', () => {
      setEnv('TEST_CFG_FREEZE2', 'value')
      const config = loadConfig({
        name: { env: 'TEST_CFG_FREEZE2' }
      })
      expect(() => {
        config.name = 'changed'
      }).toThrow()
    })
  })

  describe('toString()', () => {
    it('should mask sensitive fields with ***', () => {
      setEnv('TEST_CFG_SECRET', 'super-secret')
      setEnv('TEST_CFG_PUBLIC', 'visible')
      const config = loadConfig({
        secret: { env: 'TEST_CFG_SECRET', sensitive: true },
        public: { env: 'TEST_CFG_PUBLIC' }
      })
      const output = config.toString()
      expect(output).toContain('***')
      expect(output).not.toContain('super-secret')
      expect(output).toContain('visible')
    })

    it('should annotate default values', () => {
      clearEnv('TEST_CFG_DEFAULTED')
      const config = loadConfig({
        name: { env: 'TEST_CFG_DEFAULTED', default: 'my-default' }
      })
      const output = config.toString()
      expect(output).toContain('my-default')
      expect(output).toContain('(default)')
    })

    it('should show (not set) for undefined optional fields', () => {
      clearEnv('TEST_CFG_NOTSET')
      const config = loadConfig({
        optional: { env: 'TEST_CFG_NOTSET' }
      })
      const output = config.toString()
      expect(output).toContain('(not set)')
    })

    it('should include Configuration header', () => {
      const config = loadConfig({
        name: { env: 'TEST_CFG_NOTSET_HDR', default: 'x' }
      })
      expect(config.toString()).toMatch(/^Configuration:/)
    })
  })
})
