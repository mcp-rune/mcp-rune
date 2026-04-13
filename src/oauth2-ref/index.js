/**
 * OAuth2 Reference Implementation - Main Export
 *
 * This is a from-scratch OAuth2 implementation that demonstrates
 * RFC-compliant OAuth2 flows without external libraries.
 *
 * Exports:
 * - OAuth2ReferenceService: Main service (drop-in replacement for lib/oauth2/service.js)
 * - Core modules: For advanced use cases and customization
 * - Adapters: For extending functionality
 */

export { OAuth2ReferenceService } from './adapters/oauth-service-adapter.js'

// Export core modules for advanced usage
export { OAuth2Orchestrator } from './core/oauth2-orchestrator.js'
export { OAuth2AuthorizationFlowService } from './core/authorization-flow.js'
export { OAuth2TokenManager } from './core/token-manager.js'
export { OAuth2DiscoveryService } from './core/discovery.js'
export { OAuth2ClientRegistrationService } from './core/client-registration.js'
export { OAuth2Logger, OAUTH2_PHASES } from './core/logger.js'

// Export adapters for extension
export { OAuth2LocalFlowHandler } from './adapters/local-flow-handler.js'
export { OAuth2UserInfoService } from './adapters/user-info-service.js'
