/**
 * Framework Config Schema Fragment
 *
 * The set of env vars the framework itself consumes — currently the logging
 * subsystem (`runtime/logger.ts`) plus the runtime environment flag. Consumers
 * spread this into their own schema so these vars flow through the same
 * `loadConfig()` pipeline (validation, masking, fail-fast, `toString()`) as
 * their app config, and so the resolved values can be injected into the logger
 * via `configureLogging()` instead of the logger reading `process.env` itself.
 *
 *   import { frameworkConfigSchema } from '@mcp-rune/mcp-rune/core'
 *   export const appConfigSchema = { ...frameworkConfigSchema, api: { ... } }
 *
 * Why a fragment rather than a base schema baked into `loadConfig()`: the loader
 * stays a pure pass-through (it validates exactly the schema it's handed), and
 * the consumer keeps a single flat schema object it owns end-to-end. The fields
 * here mirror the env vars the logger honors at bootstrap; declaring them makes
 * that surface explicit, documented, and overridable.
 */

import type { ConfigSchema } from './config.js'

export const frameworkConfigSchema: ConfigSchema = {
  logging: {
    level: {
      env: 'LOG_LEVEL',
      default: 'info',
      format: ['error', 'warn', 'info', 'debug'],
      doc: 'Minimum log level emitted (error < warn < info < debug)'
    },
    format: {
      env: 'LOG_FORMAT',
      format: ['text', 'json'],
      doc: 'Console (stderr) log format. Unset = text in dev; forced to json when runtime.environment is production. json suits Loki/Grafana ingestion.'
    },
    fileFormat: {
      env: 'LOG_FILE_FORMAT',
      format: ['text', 'json'],
      doc: 'File log format. Unset = inherits logging.format. Set json for structured file output while keeping text on stderr.'
    },
    fileEnabled: {
      env: 'LOG_FILE_ENABLED',
      type: 'boolean',
      default: false,
      doc: 'Write rotating daily log files under logs/. Enable for remote/HTTP deployments; must stay false for stdio hosts on a read-only filesystem (e.g. Claude Desktop).'
    }
  },
  runtime: {
    environment: {
      env: 'NODE_ENV',
      default: 'development',
      doc: 'Runtime environment. production forces JSON logs and is the conventional gate for prod-only behavior.'
    }
  }
}
