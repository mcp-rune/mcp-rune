/**
 * Langfuse Tracing Vendor Implementation
 *
 * Provides Langfuse-specific initialization and configuration.
 * This module should only be imported by lib/services/tracing.js
 *
 * @see https://langfuse.com/docs/observability/sdk/typescript/instrumentation
 */

import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'

import * as logger from '../../logger.js'
import { setConfigured } from './mcp-integration.js'

// Re-export MCP-specific tracing functions
export {
  extractTraceContext,
  setSessionContext,
  traceApiCall,
  tracePromptGeneration,
  traceToolCall
} from './mcp-integration.js'

interface LangfuseOptions {
  publicKey?: string
  secretKey?: string
  serviceName?: string
  version?: string
}

let sdk: NodeSDK | null = null
let spanProcessor: LangfuseSpanProcessor | null = null
let _initialized = false

/** Check if Langfuse is configured and initialized */
export function isConfigured(): boolean {
  return _initialized
}

/**
 * Initialize Langfuse with OpenTelemetry SDK.
 * All config values come from the caller — no process.env reads (except VITEST).
 *
 * Note: The Langfuse SDK reads LANGFUSE_PUBLIC_KEY/SECRET_KEY from process.env
 * internally. We set them here so the SDK picks them up. This is the only
 * acceptable place to write to process.env — it's an SDK requirement, not a fallback.
 */
export function initialize({
  publicKey,
  secretKey,
  serviceName,
  version
}: LangfuseOptions = {}): boolean {
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

/** Flush pending traces (call before process exit) */
export async function flush(_timeout = 5000): Promise<void> {
  if (!spanProcessor) return
  await spanProcessor.forceFlush()
}

/** Close Langfuse SDK (call on shutdown) */
export async function close(_timeout = 5000): Promise<void> {
  if (!sdk) return
  await sdk.shutdown()
  sdk = null
  spanProcessor = null
  setConfigured(false)
}
