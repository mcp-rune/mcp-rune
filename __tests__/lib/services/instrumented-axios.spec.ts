/**
 * Instrumented axios factory tests
 *
 * The factory builds an axios instance whose request/response
 * interceptors emit one `→` line per completed call, redact known
 * secrets, extract per-endpoint allowlisted fields, and accumulate
 * upstream durations into the active request context.
 */

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('#src/services/logger.js', () => mockLogger)

import {
  createInstrumentedAxios,
  type EndpointLogConfig,
  extractFields,
  GLOBAL_REDACT,
  matchEndpointConfig,
  parseBody
} from '#src/services/instrumented-axios.js'
import * as logger from '#src/services/logger.js'
import { getUpstream, runWithRequestId } from '#src/services/request-context.js'

describe('lib/services/instrumented-axios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GLOBAL_REDACT', () => {
    it('includes the well-known OAuth/HTTP secret keys', () => {
      for (const key of [
        'client_secret',
        'access_token',
        'refresh_token',
        'id_token',
        'authorization',
        'password',
        'code'
      ]) {
        expect(GLOBAL_REDACT.has(key)).toBe(true)
      }
    })
  })

  describe('parseBody', () => {
    it('returns null for null/undefined', () => {
      expect(parseBody(null)).toBeNull()
      expect(parseBody(undefined)).toBeNull()
    })

    it('returns plain objects as-is', () => {
      const obj = { grant_type: 'authorization_code' }
      expect(parseBody(obj)).toBe(obj)
    })

    it('parses JSON strings', () => {
      expect(parseBody('{"grant_type":"refresh_token"}')).toEqual({
        grant_type: 'refresh_token'
      })
    })

    it('parses form-encoded strings', () => {
      expect(parseBody('grant_type=authorization_code&resource=https%3A%2F%2Fa')).toEqual({
        grant_type: 'authorization_code',
        resource: 'https://a'
      })
    })

    it('returns null for unparseable strings', () => {
      expect(parseBody('')).toBeNull()
    })
  })

  describe('matchEndpointConfig', () => {
    const configs: EndpointLogConfig[] = [
      { pattern: /\/oauth\/token$/, req: ['grant_type'] },
      { pattern: /\/oauth\/register$/, req: ['client_name'] }
    ]

    it('returns the first matching config', () => {
      expect(matchEndpointConfig(configs, 'https://x.example/oauth/token')).toBe(configs[0])
    })

    it('returns null when no pattern matches', () => {
      expect(matchEndpointConfig(configs, 'https://x.example/other')).toBeNull()
    })
  })

  describe('extractFields', () => {
    const cfg: EndpointLogConfig = {
      pattern: /\/oauth\/token$/,
      req: ['grant_type', 'resource', 'code'], // `code` is in GLOBAL_REDACT
      res: ['token_type', 'access_token', 'expires_in'] // `access_token` is in GLOBAL_REDACT
    }

    it('returns empty when config is null', () => {
      expect(extractFields(null, { x: 1 }, { y: 2 })).toEqual({})
    })

    it('camelCases extracted req field names', () => {
      const fields = extractFields(cfg, { grant_type: 'authorization_code' }, undefined)
      expect(fields).toMatchObject({ grantType: 'authorization_code' })
    })

    it('redacts globally-blacklisted field values even when in the allowlist', () => {
      const fields = extractFields(
        cfg,
        { grant_type: 'authorization_code', code: 'SECRET_AUTH_CODE' },
        { token_type: 'Bearer', access_token: 'SECRET_BEARER', expires_in: 3600 }
      )
      expect(fields.code).toBe('<redacted>')
      expect(fields.accessToken).toBe('<redacted>')
      expect(fields.grantType).toBe('authorization_code')
      expect(fields.tokenType).toBe('Bearer')
      expect(fields.expiresIn).toBe(3600)
    })

    it('honors per-config redact list', () => {
      const cfg2: EndpointLogConfig = {
        pattern: /./,
        req: ['custom_secret'],
        redact: ['custom_secret']
      }
      const fields = extractFields(cfg2, { custom_secret: 'hush' }, undefined)
      expect(fields.customSecret).toBe('<redacted>')
    })
  })

  describe('createInstrumentedAxios — response interceptor', () => {
    it('emits a → info line on 2xx with allowlisted fields and durationMs in meta', async () => {
      const instance = createInstrumentedAxios({
        serviceTag: 'test',
        endpointLogs: [{ pattern: /\/oauth\/token$/, req: ['grant_type'], res: ['token_type'] }]
      })

      instance.defaults.adapter = async (config) => ({
        data: { token_type: 'Bearer', access_token: 'redact-me', expires_in: 3600 },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        request: {}
      })

      await instance.post('https://auth.example/oauth/token', { grant_type: 'authorization_code' })

      expect(logger.info).toHaveBeenCalledTimes(1)
      const [message, meta] = logger.info.mock.calls[0]
      expect(message).toMatch(/^→ POST https:\/\/auth\.example\/oauth\/token 200 \(\d+ms\)$/)
      expect(meta).toMatchObject({
        service: 'test',
        durationMs: expect.any(Number),
        grantType: 'authorization_code',
        tokenType: 'Bearer'
      })
      // access_token must never leak even though we didn't list it for redaction explicitly
      expect(meta).not.toHaveProperty('accessToken')
    })

    it('emits a ✗ error line and includes the status on 4xx', async () => {
      const instance = createInstrumentedAxios({ serviceTag: 'test' })
      instance.defaults.adapter = async () => {
        const err = new Error('Request failed with status code 401')
        ;(err as any).response = {
          data: { error: 'invalid_grant' },
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config: {}
        }
        ;(err as any).config = { url: 'https://auth.example/oauth/token', method: 'post' }
        ;(err as any).isAxiosError = true
        throw err
      }

      await expect(
        instance.post('https://auth.example/oauth/token', { grant_type: 'x' })
      ).rejects.toThrow()

      expect(logger.error).toHaveBeenCalledTimes(1)
      const [message, meta] = logger.error.mock.calls[0]
      expect(message).toMatch(/^✗ POST https:\/\/auth\.example\/oauth\/token 401 — .* \(\d+ms\)$/)
      expect(meta).toMatchObject({ service: 'test', status: 401, durationMs: expect.any(Number) })
    })

    it('falls back to status="ERR" when there is no HTTP response (network error)', async () => {
      const instance = createInstrumentedAxios({ serviceTag: 'test' })
      instance.defaults.adapter = async () => {
        const err = new Error('Network down')
        ;(err as any).config = { url: 'https://auth.example/oauth/token', method: 'post' }
        ;(err as any).isAxiosError = true
        throw err
      }

      await expect(instance.post('https://auth.example/oauth/token', {})).rejects.toThrow()

      const [message] = logger.error.mock.calls[0]
      expect(message).toMatch(/^✗ POST .* ERR — Network down \(\d+ms\)$/)
    })

    it('accumulates upstream duration inside a request scope', async () => {
      const instance = createInstrumentedAxios()
      instance.defaults.adapter = async (config) => ({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        request: {}
      })

      await runWithRequestId('req-1', async () => {
        await instance.get('https://x.example/a')
        await instance.get('https://x.example/b')
        const upstream = getUpstream()
        expect(upstream?.calls).toBe(2)
        expect(upstream?.totalMs).toBeGreaterThanOrEqual(0)
      })
    })

    it('logs transport-only (no domain fields) for unmatched URLs', async () => {
      const instance = createInstrumentedAxios({
        endpointLogs: [{ pattern: /\/oauth\/token$/, req: ['grant_type'] }]
      })
      instance.defaults.adapter = async (config) => ({
        data: { whatever: 'returned' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        request: {}
      })

      await instance.post('https://x.example/some/other/endpoint', { grant_type: 'x' })

      const [, meta] = logger.info.mock.calls[0]
      expect(meta).not.toHaveProperty('grantType')
      expect(meta).not.toHaveProperty('whatever')
    })
  })
})
