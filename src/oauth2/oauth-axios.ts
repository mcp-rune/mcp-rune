/**
 * OAuth-specific instrumented axios instance.
 *
 * Built from the cross-cutting `createInstrumentedAxios` factory with
 * an allowlist of OAuth/OIDC endpoints we care to surface domain
 * context for. Used by the OAuth proxy router (`oauth-router.ts`) for
 * all outbound calls to the upstream authorization server.
 *
 * Each completed call emits one log line via the factory's response
 * interceptor (e.g. `→ POST .../oauth/token 200 (132ms) grantType=...`)
 * — handlers stay as plain `axios.post(...)` calls with no per-site
 * logging needed.
 */

import {
  createInstrumentedAxios,
  type EndpointLogConfig
} from '#src/services/instrumented-axios.js'

const OAUTH_ENDPOINT_LOGS: EndpointLogConfig[] = [
  {
    pattern: /\/oauth\/token$/,
    req: ['grant_type', 'resource'],
    res: ['token_type', 'expires_in']
  },
  {
    pattern: /\/oauth\/register$/,
    req: ['client_name']
  },
  // Well-known metadata endpoints get transport-only logging (empty allowlist).
  { pattern: /\/\.well-known\/oauth-authorization-server$/ },
  { pattern: /\/\.well-known\/openid-configuration$/ }
]

export const oauthAxios = createInstrumentedAxios({
  endpointLogs: OAUTH_ENDPOINT_LOGS,
  serviceTag: 'oauth'
})
