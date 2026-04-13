/**
 * Langfuse Tracing Vendor Implementation
 *
 * Provides Langfuse-specific initialization and configuration.
 * This module should only be imported by lib/services/tracing.js
 *
 * @see https://langfuse.com/docs/observability/sdk/typescript/instrumentation
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import * as logger from '../../logger.js'
import { setConfigured } from './mcp-integration.js'

// Re-export MCP-specific tracing functions
export {
  traceToolCall,
  traceApiCall,
  tracePromptGeneration,
  setSessionContext,
  extractTraceContext
} from './mcp-integration.js'

let sdk = null
let spanProcessor = null
let _initialized = false

/**
 * Check if Langfuse is configured and initialized
 * @returns {boolean}
 */
export function isConfigured() {
  return _initialized
}

/**
 * Initialize Langfuse with OpenTelemetry SDK.
 * All config values come from the caller — no process.env reads (except VITEST).
 *
 * Note: The Langfuse SDK reads LANGFUSE_PUBLIC_KEY/SECRET_KEY from process.env
 * internally. We set them here so the SDK picks them up. This is the only
 * acceptable place to write to process.env — it's an SDK requirement, not a fallback.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.publicKey - Langfuse public key
 * @param {string} options.secretKey - Langfuse secret key
 * @param {string} options.serviceName - Name of the MCP server
 * @param {string} options.version - Server version
 * @returns {boolean} True if initialized successfully
 */
export function initialize({ publicKey, secretKey, serviceName, version } = {}) {
  if (!publicKey || !secretKey) {
    if (!process.env.VITEST) {
      logger.warn('Langfuse keys not provided, tracing disabled', {
        service: 'langfuse'
      })
    }
    _initialized = false
    setConfigured(false)
    return false
  }

  // Set env vars for the Langfuse SDK (SDK requirement)
  process.env.LANGFUSE_PUBLIC_KEY = publicKey
  process.env.LANGFUSE_SECRET_KEY = secretKey

  spanProcessor = new LangfuseSpanProcessor()

  sdk = new NodeSDK({
    serviceName: `${serviceName}@${version}`,
    spanProcessors: [spanProcessor]
  })

  sdk.start()
  _initialized = true
  setConfigured(true)

  logger.info(`Initialized for ${serviceName}@${version}`, {
    service: 'langfuse',
    serviceName,
    version
  })

  return true
}

/**
 * Flush pending traces (call before process exit)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function flush(timeout = 5000) {
  if (!spanProcessor) return
  await spanProcessor.forceFlush(timeout)
}

/**
 * Close Langfuse SDK (call on shutdown)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function close(timeout = 5000) {
  if (!sdk) return
  await sdk.shutdown(timeout)
  sdk = null
  spanProcessor = null
  setConfigured(false)
}
