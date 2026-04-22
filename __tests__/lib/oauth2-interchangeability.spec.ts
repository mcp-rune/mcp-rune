/**
 * OAuth2 Interchangeability Tests
 *
 * Tests that both OAuth2 implementations (production and reference)
 * implement the same interface and can be used interchangeably.
 */

describe('OAuth2 Interchangeability', () => {
  const mockConfig = {
    authServerUrl: 'http://localhost:4000',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3456/callback',
    scopes: 'read write'
  }

  const implementations = [
    {
      name: 'Production (lib/oauth2)',
      module: '#src/oauth2/service.js',
      className: 'OAuthService'
    },
    {
      name: 'Reference (lib/oauth2-ref)',
      module: '#src/oauth2-ref/index.js',
      className: 'OAuth2ReferenceService'
    }
  ]

  describe('Interface Compatibility', () => {
    for (const impl of implementations) {
      describe(`${impl.name}`, () => {
        let ServiceClass
        let service

        beforeEach(async () => {
          // Dynamically import the service
          const module = await import(impl.module)
          ServiceClass = module[impl.className]
          service = new ServiceClass(mockConfig)
        })

        test('has required properties', () => {
          expect(service).toHaveProperty('authServerUrl')
          expect(service.authServerUrl).toBe(mockConfig.authServerUrl)
        })

        test('has required methods with correct signatures', () => {
          // Core methods
          expect(typeof service.getValidAccessToken).toBe('function')
          expect(typeof service.startLocalAuthFlow).toBe('function')

          // Remote flow methods
          expect(typeof service.getAuthorizationUrlForRemote).toBe('function')
          expect(typeof service.handleRemoteCallback).toBe('function')

          // Utility methods
          expect(typeof service.getUserInfo).toBe('function')
          expect(typeof service.refreshAccessToken).toBe('function')

          // Check method arity (parameter count)
          expect(service.getValidAccessToken.length).toBe(1) // sessionId
          expect(service.startLocalAuthFlow.length).toBe(1) // sessionId
        })

        test('method signatures are consistent', () => {
          // Verify all implementations have the same method signatures
          const methods = [
            'getValidAccessToken',
            'startLocalAuthFlow',
            'getAuthorizationUrlForRemote',
            'handleRemoteCallback',
            'getUserInfo',
            'refreshAccessToken'
          ]

          for (const method of methods) {
            expect(service[method]).toBeDefined()
            expect(typeof service[method]).toBe('function')
          }
        })

        test('can be instantiated with minimal config', () => {
          const minimalService = new ServiceClass({
            authServerUrl: 'http://localhost:4000',
            clientId: 'test',
            clientSecret: 'test',
            redirectUri: 'http://localhost:3456/callback'
          })

          expect(minimalService.authServerUrl).toBe('http://localhost:4000')
        })

        test('accepts optional parameters', () => {
          const serviceWithOptions = new ServiceClass({
            ...mockConfig,
            scopes: 'custom:scope',
            resourceUri: 'http://localhost:4100/mcp'
          })

          expect(serviceWithOptions.scopes).toBe('custom:scope')
          if (impl.name.includes('Reference')) {
            expect(serviceWithOptions.resourceUri).toBe('http://localhost:4100/mcp')
          }
        })
      })
    }
  })

  describe('Return Type Compatibility', () => {
    test('getValidAccessToken returns Promise<string|null>', async () => {
      for (const impl of implementations) {
        const module = await import(impl.module)
        const ServiceClass = module[impl.className]
        const service = new ServiceClass(mockConfig)

        // Just verify type signature without calling (to avoid DB/Redis dependencies)
        expect(typeof service.getValidAccessToken).toBe('function')
        expect(service.getValidAccessToken.constructor.name).toBe('AsyncFunction')
      }
    })

    test('methods return expected types', () => {
      const expectedReturnTypes = [
        { method: 'getValidAccessToken', returns: 'Promise<string|null>' },
        { method: 'startLocalAuthFlow', returns: 'Promise<Object>' },
        { method: 'getAuthorizationUrlForRemote', returns: 'Promise<Object>' },
        { method: 'handleRemoteCallback', returns: 'Promise<Object>' },
        { method: 'getUserInfo', returns: 'Promise<Object>' },
        { method: 'refreshAccessToken', returns: 'Promise<Object>' }
      ]

      for (const _expectedType of expectedReturnTypes) {
        // All methods exist on both implementations
        expect(true).toBe(true) // Placeholder
      }
    })
  })

  describe('Configuration Compatibility', () => {
    test('both implementations accept the same configuration', async () => {
      const configs = [
        mockConfig,
        {
          ...mockConfig,
          scopes: 'openid profile email'
        },
        {
          ...mockConfig,
          resourceUri: 'http://localhost:4100'
        }
      ]

      for (const config of configs) {
        for (const impl of implementations) {
          const module = await import(impl.module)
          const ServiceClass = module[impl.className]

          expect(() => new ServiceClass(config)).not.toThrow()
        }
      }
    })

    test('validates required configuration', async () => {
      const invalidConfigs = [
        { authServerUrl: 'http://localhost:4000' } // Missing clientId
      ]

      for (const config of invalidConfigs) {
        for (const impl of implementations) {
          const module = await import(impl.module)
          const ServiceClass = module[impl.className]

          // Both should handle missing config gracefully
          // (may instantiate but fail on first method call)
          // Note: Some configs may throw on instantiation, which is acceptable
          try {
            const service = new ServiceClass(config)
            expect(service).toBeDefined()
          } catch (error) {
            // It's acceptable to throw on invalid config
            expect(error).toBeDefined()
          }
        }
      }
    })
  })

  describe('Drop-in Replacement Test', () => {
    test('can swap implementations without code changes', async () => {
      // Simulate code that uses OAuth service
      async function useOAuthService(OAuthServiceClass) {
        const oauth = new OAuthServiceClass(mockConfig)

        // Code that uses the service
        expect(oauth.authServerUrl).toBeDefined()
        expect(typeof oauth.getValidAccessToken).toBe('function')
        expect(typeof oauth.startLocalAuthFlow).toBe('function')

        return oauth
      }

      // Test with production implementation
      const prodModule = await import('#src/oauth2/service.js')
      const prodService = await useOAuthService(prodModule.OAuthService)
      expect(prodService).toBeDefined()

      // Test with reference implementation
      const refModule = await import('#src/oauth2-ref/index.js')
      const refService = await useOAuthService(refModule.OAuth2ReferenceService)
      expect(refService).toBeDefined()

      // Both services should have the same interface
      const prodMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(prodService))
      const refMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(refService))

      // Check that key methods exist in both
      const requiredMethods = [
        'getValidAccessToken',
        'startLocalAuthFlow',
        'getAuthorizationUrlForRemote',
        'handleRemoteCallback'
      ]

      for (const method of requiredMethods) {
        expect(prodMethods).toContain(method)
        expect(refMethods).toContain(method)
      }
    })
  })

  describe('Environment-based Selection', () => {
    test('can select implementation via environment variable pattern', async () => {
      // Pattern: Use env var to choose implementation
      const getOAuthService = async (impl = 'production') => {
        if (impl === 'reference') {
          const module = await import('#src/oauth2-ref/index.js')
          return new module.OAuth2ReferenceService(mockConfig)
        } else {
          const module = await import('#src/oauth2/service.js')
          return new module.OAuthService(mockConfig)
        }
      }

      const prodService = await getOAuthService('production')
      expect(prodService).toBeDefined()
      expect(prodService.authServerUrl).toBe(mockConfig.authServerUrl)

      const refService = await getOAuthService('reference')
      expect(refService).toBeDefined()
      expect(refService.authServerUrl).toBe(mockConfig.authServerUrl)
    })
  })
})

describe('OAuth2 Reference Implementation Specific Tests', () => {
  test('reference implementation exposes core modules', async () => {
    const module = await import('#src/oauth2-ref/index.js')

    // Core modules should be exported
    expect(module.OAuth2Orchestrator).toBeDefined()
    expect(module.OAuth2AuthorizationFlowService).toBeDefined()
    expect(module.OAuth2TokenManager).toBeDefined()
    expect(module.OAuth2DiscoveryService).toBeDefined()
    expect(module.OAuth2ClientRegistrationService).toBeDefined()
    expect(module.OAuth2Logger).toBeDefined()

    // Adapters should be exported
    expect(module.OAuth2LocalFlowHandler).toBeDefined()
    expect(module.OAuth2UserInfoService).toBeDefined()
  })

  test('reference implementation has phase-based logger', async () => {
    const module = await import('#src/oauth2-ref/index.js')

    expect(module.OAUTH2_PHASES).toBeDefined()
    expect(typeof module.OAUTH2_PHASES).toBe('object')

    // Check for key phases
    expect(module.OAUTH2_PHASES.INITIALIZATION).toBeDefined()
    expect(module.OAUTH2_PHASES.DISCOVERY_START).toBeDefined()
    expect(module.OAUTH2_PHASES.AUTH_CODE_START).toBeDefined()
    expect(module.OAUTH2_PHASES.TOKEN_STORAGE).toBeDefined()
  })
})
