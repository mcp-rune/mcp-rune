/**
 * LoggingApiClient — Decorator that adds debug-level request/response
 * logging to any ApiClient implementation.
 *
 * Wraps the injected ApiClient and logs every outgoing call (method, URL,
 * params/body) and a truncated response summary via the ToolLogger.debug()
 * channel.  Activate by setting LOG_LEVEL=debug.
 *
 * Usage:
 *   const logged = new LoggingApiClient(apiClient, logger)
 *   // All calls through `logged` now emit debug logs
 */

import type { ApiClient, ToolLogger } from './base-tool.js'

type AnyFn = (...args: unknown[]) => Promise<unknown>

const MAX_LOG_LENGTH = 2000

/** Safely serialize and truncate a value for log output. */
function summarize(data: unknown): string {
  if (data === undefined) return 'undefined'
  if (data === null) return 'null'

  try {
    if (Array.isArray(data)) {
      const first = data.length > 0 ? JSON.stringify(data[0]).substring(0, 500) : ''
      return `[Array(${data.length})${first ? `: ${first}` : ''}${data.length > 1 ? ', ...' : ''}]`
    }

    const json = JSON.stringify(data)
    if (json.length <= MAX_LOG_LENGTH) return json
    return json.substring(0, MAX_LOG_LENGTH) + '...[truncated]'
  } catch {
    return '[Object — could not serialize]'
  }
}

export class LoggingApiClient implements ApiClient {
  private _inner: ApiClient
  private _logger: ToolLogger

  constructor(inner: ApiClient, logger: ToolLogger) {
    this._inner = inner
    this._logger = logger
  }

  get baseUrl(): string | undefined {
    return this._inner.baseUrl
  }

  async get(url: string, params?: Record<string, unknown>, ...rest: unknown[]): Promise<unknown> {
    this._logger.debug('[API Request] GET', { url, params })
    const result = await (this._inner.get as AnyFn).call(this._inner, url, params, ...rest)
    this._logger.debug('[API Response] GET', { url, body: summarize(result) })
    return result
  }

  async post(url: string, data?: unknown, ...rest: unknown[]): Promise<unknown> {
    this._logger.debug('[API Request] POST', { url, body: summarize(data) })
    const result = await (this._inner.post as AnyFn).call(this._inner, url, data, ...rest)
    this._logger.debug('[API Response] POST', { url, body: summarize(result) })
    return result
  }

  async put(url: string, data?: unknown, ...rest: unknown[]): Promise<unknown> {
    this._logger.debug('[API Request] PUT', { url, body: summarize(data) })
    const result = await (this._inner.put as AnyFn).call(this._inner, url, data, ...rest)
    this._logger.debug('[API Response] PUT', { url, body: summarize(result) })
    return result
  }

  async patch(url: string, data?: unknown, ...rest: unknown[]): Promise<unknown> {
    this._logger.debug('[API Request] PATCH', { url, body: summarize(data) })
    const result = await (this._inner.patch as AnyFn).call(this._inner, url, data, ...rest)
    this._logger.debug('[API Response] PATCH', { url, body: summarize(result) })
    return result
  }

  async delete(url: string, ...rest: unknown[]): Promise<unknown> {
    this._logger.debug('[API Request] DELETE', { url })
    const result = await (this._inner.delete as AnyFn).call(this._inner, url, ...rest)
    this._logger.debug('[API Response] DELETE', { url, body: summarize(result) })
    return result
  }
}
