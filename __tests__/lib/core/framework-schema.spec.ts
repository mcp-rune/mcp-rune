import { loadConfig } from '#src/core/config.js'
import { frameworkConfigSchema } from '#src/core/framework-schema.js'

describe('lib/core/framework-schema', () => {
  const LOG_VARS = ['LOG_LEVEL', 'LOG_FORMAT', 'LOG_FILE_FORMAT', 'LOG_FILE_ENABLED', 'NODE_ENV']
  const saved = {}

  beforeEach(() => {
    for (const k of LOG_VARS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of LOG_VARS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('resolves declared defaults when env is unset', () => {
    const config = loadConfig(frameworkConfigSchema)
    expect(config.logging).toMatchObject({
      level: 'info',
      fileEnabled: false
    })
    // optional format vars have no default — undefined means "derive"
    expect(config.logging.format).toBeUndefined()
    expect(config.logging.fileFormat).toBeUndefined()
    expect(config.runtime).toMatchObject({ environment: 'development' })
  })

  it('reads env vars through the same loadConfig pipeline', () => {
    process.env.LOG_LEVEL = 'debug'
    process.env.LOG_FORMAT = 'json'
    process.env.LOG_FILE_ENABLED = 'true'
    process.env.NODE_ENV = 'production'
    const config = loadConfig(frameworkConfigSchema)
    expect(config.logging.level).toBe('debug')
    expect(config.logging.format).toBe('json')
    expect(config.logging.fileEnabled).toBe(true)
    expect(config.runtime.environment).toBe('production')
  })

  it('validates the log level enum (fails fast on a bad value)', () => {
    process.env.LOG_LEVEL = 'verbose'
    expect(() => loadConfig(frameworkConfigSchema)).toThrow(/LOG_LEVEL must be one of/)
  })

  it('validates the log format enum', () => {
    process.env.LOG_FORMAT = 'yaml'
    expect(() => loadConfig(frameworkConfigSchema)).toThrow(/LOG_FORMAT must be one of/)
  })

  it('spreads cleanly alongside an app schema', () => {
    process.env.TEST_APP_NAME = 'demo'
    const config = loadConfig({
      ...frameworkConfigSchema,
      app: { name: { env: 'TEST_APP_NAME' } }
    })
    delete process.env.TEST_APP_NAME
    expect(config.app.name).toBe('demo')
    expect(config.logging.level).toBe('info')
  })
})
