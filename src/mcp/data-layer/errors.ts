/**
 * Typed error taxonomy for the DataLayer seam.
 *
 * Adapters translate transport failures into these classes at the adapter
 * boundary, so projection code (tools, apps, prompts) branches on error
 * class instead of duck-typing transport shapes — and error-body parsing
 * happens exactly once, inside the adapter, with the failing model's
 * convention (the server-wide default only applies when no model does).
 */

import type { BaseConvention, ErrorResponse } from './api-conventions/base-convention.js'

/** Base class for every backend-failure error the DataLayer seam throws. */
export class DataLayerError extends Error {
  readonly model: string | undefined

  constructor(message: string, options: { model?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'DataLayerError'
    this.model = options.model
  }
}

/** A record lookup the backend answered with 404. */
export class RecordNotFoundError extends DataLayerError {
  readonly recordId: string | undefined

  constructor(options: { model: string; recordId?: string; cause?: unknown }) {
    super(
      options.recordId !== undefined
        ? `No ${options.model} found with id "${options.recordId}"`
        : `No matching ${options.model} found`,
      options
    )
    this.name = 'RecordNotFoundError'
    this.recordId = options.recordId
  }
}

/**
 * A backend failure other than a record-level 404, with `messages` already
 * parsed through the failing model's convention.
 */
export class ApiRequestError extends DataLayerError {
  readonly status: number | undefined
  readonly messages: string[]

  constructor(options: { model?: string; status?: number; messages: string[]; cause?: unknown }) {
    const text = options.messages.length > 0 ? options.messages.join('; ') : 'Unknown error'
    super(options.status !== undefined ? `${text} (${options.status})` : text, options)
    this.name = 'ApiRequestError'
    this.status = options.status
    this.messages = options.messages
  }
}

/**
 * The transport-failure shape `ApiClient` implementations reject with — the
 * declared contract lives on `ApiClientHttpError` in `src/core/api-client.ts`.
 */
interface TransportErrorLike {
  response?: { status?: number; data?: unknown }
}

/**
 * Translate an `ApiClient` rejection into the seam taxonomy. Rejections
 * without a `response` (network failures, timeouts, programming errors)
 * pass through untouched; a 404 on a record-scoped call becomes
 * `RecordNotFoundError`; everything else becomes `ApiRequestError` with the
 * body parsed through the given convention. The original rejection rides
 * along as `cause`.
 */
export function translateApiError(
  err: unknown,
  ctx: { convention: BaseConvention; model?: string; recordId?: string }
): unknown {
  const response = (err as TransportErrorLike | null)?.response
  if (!response) return err

  if (response.status === 404 && ctx.model !== undefined && ctx.recordId !== undefined) {
    return new RecordNotFoundError({ model: ctx.model, recordId: ctx.recordId, cause: err })
  }

  return new ApiRequestError({
    model: ctx.model,
    status: response.status,
    messages: ctx.convention.parseErrorResponse(response as ErrorResponse),
    cause: err
  })
}
