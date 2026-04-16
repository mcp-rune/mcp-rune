/**
 * Smoke test for OAuth2 Reference Implementation
 *
 * Verifies that oauth2-ref can be imported and instantiated in this repo
 */

describe('OAuth2 Reference Implementation - Smoke Test', () => {
  let OAuth2ReferenceService

  beforeEach(async () => {
    const module = await import('#src/oauth2-ref/index.js')
    OAuth2ReferenceService = module.OAuth2ReferenceService
  })

  it('should export OAuth2ReferenceService', async () => {
    expect(OAuth2ReferenceService).toBeDefined()
    expect(typeof OAuth2ReferenceService).toBe('function')
  })

  it('should be instantiable with required config', () => {
    const config = {
      identityUrl: 'https://auth.example.com',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3456/callback',
      scopes: 'read write'
    }

    const service = new OAuth2ReferenceService(config)

    expect(service).toBeDefined()
    expect(service.identityUrl).toBe('https://auth.example.com')
  })

  it('should export core modules', async () => {
    const {
      OAuth2Orchestrator,
      OAuth2AuthorizationFlowService,
      OAuth2TokenManager,
      OAuth2DiscoveryService,
      OAuth2ClientRegistrationService,
      OAuth2Logger,
      OAUTH2_PHASES
    } = await import('#src/oauth2-ref/index.js')

    expect(OAuth2Orchestrator).toBeDefined()
    expect(OAuth2AuthorizationFlowService).toBeDefined()
    expect(OAuth2TokenManager).toBeDefined()
    expect(OAuth2DiscoveryService).toBeDefined()
    expect(OAuth2ClientRegistrationService).toBeDefined()
    expect(OAuth2Logger).toBeDefined()
    expect(OAUTH2_PHASES).toBeDefined()
  })

  it('should export adapter modules', async () => {
    const { OAuth2LocalFlowHandler, OAuth2UserInfoService } =
      await import('#src/oauth2-ref/index.js')

    expect(OAuth2LocalFlowHandler).toBeDefined()
    expect(OAuth2UserInfoService).toBeDefined()
  })

  it('should have interface compatibility with production OAuth2', async () => {
    const config = {
      identityUrl: 'https://auth.example.com',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3456/callback',
      scopes: 'read write'
    }

    const service = new OAuth2ReferenceService(config)

    // Verify interface methods exist
    expect(typeof service.getValidAccessToken).toBe('function')
    expect(typeof service.startLocalAuthFlow).toBe('function')
    expect(typeof service.getAuthorizationUrlForRemote).toBe('function')
    expect(typeof service.handleRemoteCallback).toBe('function')
    expect(typeof service.getUserInfo).toBe('function')
    expect(typeof service.refreshAccessToken).toBe('function')
  })
})
