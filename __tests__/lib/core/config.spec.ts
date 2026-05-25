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

    it('should resolve array types with default CSV separator', () => {
      setEnv('TEST_CFG_LIST', 'a,b,c')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST', type: 'array' }
      })
      expect(config.list).toEqual(['a', 'b', 'c'])
    })

    it('should trim whitespace around array items', () => {
      setEnv('TEST_CFG_LIST', 'a, b , c')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST', type: 'array' }
      })
      expect(config.list).toEqual(['a', 'b', 'c'])
    })

    it('should resolve array with custom separator', () => {
      setEnv('TEST_CFG_LIST', 'a|b|c')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST', type: 'array', separator: '|' }
      })
      expect(config.list).toEqual(['a', 'b', 'c'])
    })

    it('should resolve only-separator value as empty array', () => {
      setEnv('TEST_CFG_LIST', ',,')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST', type: 'array' }
      })
      expect(config.list).toEqual([])
    })

    it('should apply array default when env var is absent', () => {
      clearEnv('TEST_CFG_LIST_MISSING')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST_MISSING', type: 'array', default: ['x', 'y'] }
      })
      expect(config.list).toEqual(['x', 'y'])
    })

    it('should return undefined for optional array without default', () => {
      clearEnv('TEST_CFG_LIST_OPT')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST_OPT', type: 'array' }
      })
      expect(config.list).toBeUndefined()
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

    it('should throw for missing required array vars', () => {
      clearEnv('TEST_CFG_REQ_LIST')
      expect(() =>
        loadConfig({
          list: { env: 'TEST_CFG_REQ_LIST', type: 'array', required: true }
        })
      ).toThrow(/TEST_CFG_REQ_LIST/)
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

    it('should validate array items per element against format allow-list', () => {
      setEnv('TEST_CFG_LIST_FMT', 'a,b')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST_FMT', type: 'array', format: ['a', 'b', 'c'] }
      })
      expect(config.list).toEqual(['a', 'b'])
    })

    it('should throw when array contains items outside format allow-list', () => {
      setEnv('TEST_CFG_LIST_FMT', 'a,bad')
      let caught: Error | null = null
      try {
        loadConfig({
          list: { env: 'TEST_CFG_LIST_FMT', type: 'array', format: ['a', 'b'] }
        })
      } catch (e) {
        caught = e as Error
      }
      expect(caught).not.toBeNull()
      expect(caught!.message).toContain('bad')
      expect(caught!.message).toContain('allowed')
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

    it('should render non-empty arrays YAML-block style, one item per line', () => {
      setEnv('TEST_CFG_LIST_PRINT', 'one,two,three')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST_PRINT', type: 'array' }
      })
      const lines = config.toString().split('\n')
      expect(lines).toContain('  list:')
      expect(lines).toContain('    - one')
      expect(lines).toContain('    - two')
      expect(lines).toContain('    - three')
      // Ensure the inline rendering is gone
      expect(config.toString()).not.toContain('[one, two, three]')
    })

    it('should render empty arrays inline as []', () => {
      setEnv('TEST_CFG_LIST_EMPTY', ',,')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST_EMPTY', type: 'array' }
      })
      expect(config.toString()).toContain('list: []')
    })

    it('should annotate default-sourced arrays on the header line only', () => {
      clearEnv('TEST_CFG_LIST_DEFAULTED')
      const config = loadConfig({
        list: { env: 'TEST_CFG_LIST_DEFAULTED', type: 'array', default: ['x', 'y'] }
      })
      const lines = config.toString().split('\n')
      expect(lines).toContain('  list: (default)')
      expect(lines).toContain('    - x')
      expect(lines).toContain('    - y')
      // The (default) marker must NOT appear on item lines
      expect(
        lines.filter((l) => l.startsWith('    -')).every((l) => !l.includes('(default)'))
      ).toBe(true)
    })

    it('should mask sensitive arrays with ***', () => {
      setEnv('TEST_CFG_SECRET_LIST', 'alpha,bravo,charlie')
      const config = loadConfig({
        tokens: { env: 'TEST_CFG_SECRET_LIST', type: 'array', sensitive: true }
      })
      const output = config.toString()
      expect(output).toContain('***')
      expect(output).not.toContain('alpha')
      expect(output).not.toContain('bravo')
      expect(output).not.toContain('charlie')
    })
  })
})
