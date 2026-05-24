/**
 * Instrumented axios factory
 *
 * Cross-cutting primitive for outbound HTTP logging. Every axios
 * instance produced by `createInstrumentedAxios` emits one log line
 * per completed request:
 *
 *   → POST https://auth.example/oauth/token 200 (132ms) grantType=authorization_code
 *
 * Failures (4xx/5xx or network error) render as:
 *
 *   ✗ POST https://auth.example/oauth/token 401 — Unauthorized (132ms)
 *
 * Each instance carries its own `endpointLogs` allowlist describing
 * which request/response body fields to surface per endpoint. URLs not
 * matching any pattern log transport-only (method, url, status,
 * duration), so a new endpoint added without explicit config cannot
 * accidentally leak a sensitive field. A global redact set masks
 * widely-known secret keys regardless of allowlist.
 *
 * Each completed call also calls `addUpstreamDuration` so the inbound
 * request-logger middleware can render proxy overhead on `res.finish`.
 *
 * @example
 *   export const oauthAxios = createInstrumentedAxios({
 *     endpointLogs: [
 *       { pattern: /\/oauth\/token$/, req: ['grant_type'], res: ['token_type'] }
 *     ],
 *     serviceTag: 'oauth'
 *   })
 */

import { performance } from 'node:perf_hooks'

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from 'axios'

import * as logger from './logger.js'
import { addUpstreamDuration } from './request-context.js'

export interface EndpointLogConfig {
  /** Matched (with `RegExp.test`) against the full request URL. First match wins. */
  pattern: RegExp
  /** Request-body field names (snake_case as sent on the wire) to surface in the log. */
  req?: string[]
  /** Response-body field names to surface in the log. */
  res?: string[]
  /** Additional field names to mask with `<redacted>` (beyond GLOBAL_REDACT). */
  redact?: string[]
}

export interface InstrumentedAxiosOptions extends AxiosRequestConfig {
  endpointLogs?: EndpointLogConfig[]
  /** Service tag emitted with each log line (e.g. `oauth`, `engineer-api`). */
  serviceTag?: string
}

/**
 * Field names whose values are ALWAYS masked, in addition to per-endpoint
 * `redact` entries. Covers the well-known OAuth/HTTP secret vocabulary so
 * a misconfigured allowlist still can't leak them.
 */
export const GLOBAL_REDACT: ReadonlySet<string> = new Set([
  'client_secret',
  'access_token',
  'refresh_token',
  'id_token',
  'authorization',
  'password',
  'code'
])

const REDACTED = '<redacted>'

interface PhaseTiming {
  t0: number
}

type InstrumentedConfig = InternalAxiosRequestConfig & { metadata?: PhaseTiming }

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** Parse a possibly-stringified request/response body into a plain object. */
export function parseBody(data: unknown): Record<string, unknown> | null {
  if (data == null) return null
  if (typeof data === 'object' && !Buffer.isBuffer(data)) {
    return data as Record<string, unknown>
  }
  if (typeof data !== 'string') return null
  // Try JSON first, then form-encoded.
  try {
    const parsed = JSON.parse(data) as unknown
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    /* fall through to form-encoded */
  }
  try {
    const params = new URLSearchParams(data)
    const obj: Record<string, string> = {}
    params.forEach((v, k) => {
      obj[k] = v
    })
    return Object.keys(obj).length > 0 ? obj : null
  } catch {
    return null
  }
}

export function matchEndpointConfig(
  endpointLogs: readonly EndpointLogConfig[],
  url: string
): EndpointLogConfig | null {
  for (const cfg of endpointLogs) {
    if (cfg.pattern.test(url)) return cfg
  }
  return null
}

function maskValue(key: string, value: unknown, extraRedact: ReadonlySet<string>): unknown {
  if (GLOBAL_REDACT.has(key) || extraRedact.has(key)) return REDACTED
  return value
}

export function extractFields(
  cfg: EndpointLogConfig | null,
  reqData: unknown,
  resData: unknown
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  if (!cfg) return fields
  const extraRedact: ReadonlySet<string> = new Set(cfg.redact ?? [])
  if (cfg.req?.length) {
    const body = parseBody(reqData) ?? {}
    for (const key of cfg.req) {
      if (key in body) fields[snakeToCamel(key)] = maskValue(key, body[key], extraRedact)
    }
  }
  if (cfg.res?.length) {
    const body = parseBody(resData) ?? {}
    for (const key of cfg.res) {
      if (key in body) fields[snakeToCamel(key)] = maskValue(key, body[key], extraRedact)
    }
  }
  return fields
}

function methodOf(config: AxiosRequestConfig | undefined): string {
  return (config?.method ?? 'get').toUpperCase()
}

function urlOf(config: AxiosRequestConfig | undefined): string {
  return config?.url ?? '<unknown>'
}

function formatSuccessLine(config: AxiosRequestConfig, status: number, durationMs: number): string {
  return `→ ${methodOf(config)} ${urlOf(config)} ${status} (${formatDuration(durationMs)})`
}

function formatErrorLine(
  config: AxiosRequestConfig | undefined,
  status: number,
  durationMs: number,
  message: string
): string {
  const statusPart = status > 0 ? `${status}` : 'ERR'
  return `✗ ${methodOf(config)} ${urlOf(config)} ${statusPart} — ${message} (${formatDuration(durationMs)})`
}

export function createInstrumentedAxios(opts: InstrumentedAxiosOptions = {}): AxiosInstance {
  const { endpointLogs = [], serviceTag, ...axiosConfig } = opts
  const instance = axios.create(axiosConfig)

  instance.interceptors.request.use((config) => {
    ;(config as InstrumentedConfig).metadata = { t0: performance.now() }
    return config
  })

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const config = response.config as InstrumentedConfig
      const durationMs = config.metadata ? Math.round(performance.now() - config.metadata.t0) : 0
      const url = urlOf(config)
      const matched = matchEndpointConfig(endpointLogs, url)
      const fields = extractFields(matched, config.data, response.data)
      logger.info(formatSuccessLine(config, response.status, durationMs), {
        ...(serviceTag && { service: serviceTag }),
        durationMs,
        ...fields
      })
      addUpstreamDuration(durationMs)
      return response
    },
    (error: AxiosError) => {
      const config = error.config as InstrumentedConfig | undefined
      const durationMs = config?.metadata ? Math.round(performance.now() - config.metadata.t0) : 0
      const status = error.response?.status ?? 0
      const url = urlOf(config)
      const matched = matchEndpointConfig(endpointLogs, url)
      const fields = extractFields(matched, config?.data, error.response?.data)
      logger.error(formatErrorLine(config, status, durationMs, error.message), {
        ...(serviceTag && { service: serviceTag }),
        durationMs,
        status,
        ...fields
      })
      if (config?.metadata) addUpstreamDuration(durationMs)
      return Promise.reject(error)
    }
  )

  return instance
}
