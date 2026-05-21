/**
 * Security Headers Middleware
 *
 * Sets a baseline of OWASP-recommended response headers. HSTS is only
 * emitted in production because dev environments typically run over plain
 * HTTP and a cached HSTS header on localhost can wedge a developer's
 * browser for months.
 */

import type { NextFunction, Request, Response } from 'express'

export interface SecurityHeadersOptions {
  isProduction: boolean
}

export function createSecurityHeadersMiddleware({
  isProduction
}: SecurityHeadersOptions): (req: Request, res: Response, next: NextFunction) => void {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-XSS-Protection', '1; mode=block')
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    next()
  }
}
