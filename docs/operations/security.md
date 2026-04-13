# Security

This document describes security measures implemented in this MCP server codebase.

## Overview

MCP servers handle OAuth2 authentication and user data, requiring careful security hardening for production deployments.

## Transport Security

### HTTPS Enforcement

HTTPS is mandatory in production. The OAuth2 service throws an error if an HTTP URL is configured for the Identity server in production:

```javascript
// lib/oauth2/service.js
if (isHttpUrl && isProduction) {
  throw new Error(`Security Error: HTTPS is required for Identity server in production.`)
}
```

**Environment behavior:**

- `NODE_ENV=production` + HTTP URL → Error (blocked)
- `NODE_ENV=development` + HTTP URL → Allowed (local testing)

This follows OAuth 2.1 security requirements (draft-ietf-oauth-v2-1-13) which mandate TLS for all authorization server communications.

## HTTP Security Headers

The HTTP server adds security headers to all responses (`lib/mcp/http-server.js`):

| Header                      | Value              | Purpose                         |
| --------------------------- | ------------------ | ------------------------------- |
| `X-Frame-Options`           | `DENY`             | Prevent clickjacking            |
| `X-Content-Type-Options`    | `nosniff`          | Prevent MIME sniffing           |
| `X-XSS-Protection`          | `1; mode=block`    | Enable XSS filter               |
| `Strict-Transport-Security` | `max-age=31536000` | Enforce HTTPS (production only) |

## CORS Configuration

CORS is configurable via environment variable for production deployments:

```bash
# Restrict to specific origins in production
CORS_ORIGINS=https://editor.example.com,https://app.example.com
```

**Default behavior:**

- If `CORS_ORIGINS` is set → Only those origins allowed
- If `CORS_ORIGINS` is not set → All origins allowed (development mode)

**Security settings:**

- `credentials: false` - Cookies not sent in cross-origin requests
- Explicit `allowedHeaders` whitelist
- Explicit `methods` whitelist (GET, POST, DELETE, OPTIONS)

## Rate Limiting

Rate limiting protects the MCP endpoint from abuse:

- **Window:** 15 minutes
- **Limit:** 100 requests per user/IP
- **Key generation:** SHA-256 hash of Bearer token (per-user limiting)

Using SHA-256 instead of base64 prevents:

- Collision attacks on rate limit buckets
- Token reversal from rate limit keys

## Request Size Limits

Body parser limits prevent DoS via large payloads:

| Content Type | Limit | Rationale                            |
| ------------ | ----- | ------------------------------------ |
| JSON         | 100kb | Sufficient for MCP JSON-RPC requests |
| URL-encoded  | 10kb  | OAuth forms are small                |

## Dependency Management

### Automated Scanning

The CI/CD pipeline includes weekly security scans:

```yaml
# .github/workflows/security.yml
on:
  schedule:
    - cron: '0 9 * * 1' # Weekly Monday 9:00 UTC
```

### Manual Audit

```bash
# Check vulnerabilities
npm audit

# Fix automatically
npm audit fix

# Check high/critical only
npm audit --audit-level=high
```

### Known Vulnerability Handling

High/critical vulnerabilities in production dependencies are fixed immediately. Low/moderate vulnerabilities in dev dependencies are tracked and fixed when upstream updates are available.

## Environment Variables

Security-related environment variables:

| Variable       | Purpose                                                  | Required    |
| -------------- | -------------------------------------------------------- | ----------- |
| `NODE_ENV`     | Environment mode (production/development)                | Recommended |
| `IDENTITY_URL` | OAuth2 Identity server URL (must be HTTPS in production) | Yes         |
| `CORS_ORIGINS` | Comma-separated allowed CORS origins                     | Production  |

## Security Checklist

Before deploying to production:

- [ ] `NODE_ENV=production` is set
- [ ] `IDENTITY_URL` uses HTTPS
- [ ] `CORS_ORIGINS` is configured with specific domains
- [ ] `npm audit` shows no high/critical vulnerabilities
- [ ] TLS/SSL certificate is valid and not expired
- [ ] Rate limiting is enabled
- [ ] Logs don't contain sensitive data (tokens, passwords)

## Reporting Security Issues

If you discover a security vulnerability, please report it privately rather than opening a public issue.
